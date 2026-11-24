'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function boot(seed) {
  const dir = mkdtempSync(join(tmpdir(), 'fishserve-'));
  process.env.FISHSERVE_CATCHES = join(dir, 'catches.csv');
  process.env.FISHSERVE_SESSIONS = join(dir, 'sessions.csv');
  process.env.FISHSERVE_SHOTS = join(dir, 'shots');
  process.env.FISHSERVE_RUNS = join(dir, 'runs');
  // An existing file, for the upgrade path: boot() would otherwise create a fresh header.
  if (seed && seed.sessions) writeFileSync(join(dir, 'sessions.csv'), seed.sessions);
  delete require.cache[require.resolve('../fishserve.js')];
  const { createServer } = require('../fishserve.js');
  const server = createServer();
  return new Promise((res) =>
    server.listen(0, '127.0.0.1', () => res({ server, dir, port: server.address().port })));
}

function post(port, route, body) {
  return fetch('http://127.0.0.1:' + port + route, { method: 'POST', body: JSON.stringify(body) });
}

/** The wall-clock day of an ISO stamp, the same rule the server uses to bucket rows. */
function localDay(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

test('POST /session appends a row and GET /sessions totals the day', async () => {
  const { server, dir, port } = await boot();
  try {
    const r = await post(port, '/session', { started_at: '2026-10-27T08:00:00.000Z', minutes: 12, catches: 5, reason: 'duration' });
    assert.equal(r.status, 200);
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=2026-10-27')).json();
    assert.equal(body.minutes, 12);
    assert.equal(body.rows.length, 1);
    assert.match(readFileSync(join(dir, 'sessions.csv'), 'utf8'), /,12,5,duration,default/);
  } finally { server.close(); }
});

test('GET /sessions without day uses the local day, not the UTC date', async () => {
  // Local noon is the previous UTC day at UTC+13, so the old UTC default would miss this row.
  const now = new Date();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const line = [noon.toISOString(), noon.toISOString(), 7, 3, 'user', 'default'].join(',');
  const { server, port } = await boot({ sessions: 'time,started_at,minutes,catches,reason,profile\n' + line + '\n' });
  try {
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions')).json();
    assert.equal(body.day, localDay(noon.toISOString()), 'the default follows the wall clock');
    assert.equal(body.minutes, 7, "today's row is included");
    assert.equal(body.rows.length, 1);
  } finally { server.close(); }
});

test("a named profile's session row is kept apart from the default total", async () => {
  const { server, dir, port } = await boot();
  try {
    const day = localDay();
    await post(port, '/session', { minutes: 10, catches: 1, reason: 'user' });
    await post(port, '/session', { minutes: 25, catches: 4, reason: 'duration', profile: 'nepchur' });

    const def = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + day)).json();
    assert.equal(def.minutes, 10, 'the default total does not include another profile');
    assert.equal(def.rows.length, 1);
    assert.equal(def.rows[0].profile, 'default');

    const nep = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + day + '&profile=nepchur')).json();
    assert.equal(nep.minutes, 25);
    assert.equal(nep.rows.length, 1);
    assert.equal(nep.rows[0].profile, 'nepchur', 'the row names the account it belongs to');
    assert.match(readFileSync(join(dir, 'sessions.csv'), 'utf8'), /,duration,nepchur/);
  } finally { server.close(); }
});

test('a profile is stored as the safe token the panel writes', async () => {
  const { server, dir, port } = await boot();
  try {
    await post(port, '/session', { minutes: 4, catches: 1, reason: 'user', profile: 'nep, chur\n!' });
    const text = readFileSync(join(dir, 'sessions.csv'), 'utf8');
    assert.match(text, /,user,nep chur,\n/, 'a comma and a newline cannot add a column or a row');
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + localDay() + '&profile=nep%20chur')).json();
    assert.equal(body.minutes, 4);
    assert.equal(body.rows[0].profile, 'nep chur');
  } finally { server.close(); }
});

test('a five-column sessions.csv is read as default and upgraded without rewriting its rows', async () => {
  const when = '2026-10-27T08:00:00.000Z';
  const old = 'time,started_at,minutes,catches,reason\n' + when + ',,12,5,duration\n';
  const { server, dir, port } = await boot({ sessions: old });
  try {
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + localDay(when) + '&profile=default')).json();
    assert.equal(body.minutes, 12, 'an old row still counts for the default profile');
    assert.equal(body.rows[0].profile, 'default');

    const text = readFileSync(join(dir, 'sessions.csv'), 'utf8');
    assert.equal(text.split('\n')[0], 'time,started_at,minutes,catches,reason,profile,note');
    assert.match(text, new RegExp(when.replace(/\./g, '\\.') + ',,12,5,duration'), 'the old row is untouched');

    await post(port, '/session', { minutes: 3, catches: 1, reason: 'user', profile: 'alt' });
    const alt = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + localDay() + '&profile=alt')).json();
    assert.equal(alt.minutes, 3, 'a new row is written with its profile');
  } finally { server.close(); }
});

test('a six-column sessions.csv from 3.9.60 gains the note column without rewriting its rows', async () => {
  const when = '2026-11-23T09:00:00.000Z';
  const old = 'time,started_at,minutes,catches,reason,profile\n' + when + ',,7,3,duration,default\n';
  const { server, dir, port } = await boot({ sessions: old });
  try {
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + localDay(when) + '&profile=default')).json();
    assert.equal(body.minutes, 7, 'the old row still counts');
    assert.equal(body.rows[0].note, '', 'an old row simply has no note');
    const text = readFileSync(join(dir, 'sessions.csv'), 'utf8');
    assert.equal(text.split('\n')[0], 'time,started_at,minutes,catches,reason,profile,note');
    assert.match(text, new RegExp(when.replace(/\./g, '\\.') + ',,7,3,duration,default'), 'the old row is untouched');
  } finally { server.close(); }
});

test('a session note is its own column, on one line, without smuggling a comma', async () => {
  const { server, dir, port } = await boot();
  try {
    await post(port, '/session', { minutes: 2, catches: 1, reason: 'core-crash', note: 'guard revives=3 tickErrors=1,\nboom' });
    const text = readFileSync(join(dir, 'sessions.csv'), 'utf8');
    assert.equal(text.split('\n')[0], 'time,started_at,minutes,catches,reason,profile,note');
    assert.match(text, /,core-crash,default,guard revives=3 tickErrors=1 boom\n/, 'the note is one column and one line');
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=' + localDay())).json();
    assert.equal(body.rows[0].note, 'guard revives=3 tickErrors=1 boom');
  } finally { server.close(); }
});

test('POST /export stores one snapshot of a run and refuses a body without attempts', async () => {
  const { server, dir, port } = await boot();
  try {
    const ok = await post(port, '/export', { version: '3.9.43', profile: 'default', attempts: [{ id: 'a-1', n: 1, v: 'caught', t: 1700000000000 }] });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.match(body.file, /^export-.*\.json$/);
    const saved = JSON.parse(readFileSync(join(dir, 'runs', body.file), 'utf8'));
    assert.equal(saved.attempts.length, 1);
    assert.equal(saved.version, '3.9.43');

    const bad = await post(port, '/export', { version: '3.9.43' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).e, /attempts array/);
    assert.equal(readdirSync(join(dir, 'runs')).length, 1, 'a refused export writes no file');
  } finally { server.close(); }
});

test('GET /overnight.js serves the sampler to the game page', async () => {
  const { server, port } = await boot();
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/overnight.js', { headers: { Origin: 'https://app.lofi.town' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://app.lofi.town', 'the page fetches it cross-origin');
    const body = await r.text();
    assert.match(body, /window\.__overnight/);
    assert.match(body, /\/export/);
  } finally { server.close(); }
});

test('a foreign Origin cannot write, and only allowed origins get CORS headers', async () => {
  const { server, dir, port } = await boot();
  try {
    const evil = await fetch('http://127.0.0.1:' + port + '/catch', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
      body: JSON.stringify({ species: 'Nope', t: Date.now() }),
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.ok(!readFileSync(join(dir, 'catches.csv'), 'utf8').includes('Nope'), 'nothing was appended');

    const good = await fetch('http://127.0.0.1:' + port + '/catch', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://app.lofi.town' },
      body: JSON.stringify({ species: 'Guppy', t: Date.now() }),
    });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('access-control-allow-origin'), 'https://app.lofi.town');
    assert.equal(good.headers.get('vary'), 'Origin');
    assert.ok(readFileSync(join(dir, 'catches.csv'), 'utf8').includes('Guppy'));
  } finally { server.close(); }
});

test('GET /sessions only counts the requested day', async () => {
  const { server, port } = await boot();
  try {
    await post(port, '/session', { started_at: '2026-10-27T08:00:00.000Z', minutes: 12, catches: 5, reason: 'duration' });
    await post(port, '/session', { started_at: '2026-10-26T08:00:00.000Z', minutes: 40, catches: 9, reason: 'user' });
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=2026-10-27')).json();
    assert.equal(body.minutes, 12);
    assert.equal(body.rows.length, 1);
  } finally { server.close(); }
});

test('POST /session rejects a body without a numeric minutes field', async () => {
  const { server, port } = await boot();
  try {
    assert.equal((await post(port, '/session', { reason: 'user' })).status, 400);
    assert.equal((await post(port, '/session', { minutes: 'lots' })).status, 400);
  } finally { server.close(); }
});

test('POST /catch still records a catch and /recent reads it back', async () => {
  const { server, port } = await boot();
  try {
    const r = await post(port, '/catch', { t: '2026-10-27T02:24:49.324Z', species: 'Sardine', rarity: '', quality: '', weight: '0.4 kg', value: '12' });
    assert.equal(r.status, 200);
    const body = await (await fetch('http://127.0.0.1:' + port + '/recent?n=3')).json();
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].species, 'Sardine');
    assert.equal(body.rows[0].value, '12');
  } finally { server.close(); }
});

test('POST /diag stores the frame and the stats that came with it', async () => {
  const { server, dir, port } = await boot();
  try {
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const r = await post(port, '/diag', { png, note: 'no-prompt-after-20s', stats: { bubbles: 0 }, viewport: [800, 600], dpr: 1 });
    assert.equal(r.status, 200);
    const out = join(dir, 'shots', 'diag');
    const files = readdirSync(out);
    const shot = readFileSync(join(out, files.find((f) => f.endsWith('.png'))));
    assert.equal(shot.length, 4);
    const meta = JSON.parse(readFileSync(join(out, files.find((f) => f.endsWith('.json'))), 'utf8'));
    assert.equal(meta.note, 'no-prompt-after-20s');
    assert.deepEqual(meta.viewport, [800, 600]);
  } finally { server.close(); }
});

test('POST /diag refuses a body without a png', async () => {
  const { server, port } = await boot();
  try {
    assert.equal((await post(port, '/diag', { note: 'x' })).status, 400);
  } finally { server.close(); }
});

test('GET /autofish.user.js serves the standalone build, and the build in dist is current', async () => {
  const { server, port } = await boot();
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/autofish.user.js');
    assert.equal(res.status, 200);
    const body = await res.text();
    // The installable file must be the build (bot + chip), not the server-dependent loader.
    assert.ok(body.includes('__autofishInstalled'), 'this is the standalone userscript');
    assert.doesNotMatch(body, /__FISHSERVE__/);
    // A committed dist that no longer matches autofish.js would install a stale bot.
    assert.equal(body, require('../build-userscript.js').build(), 'dist/autofish.user.js is up to date');
  } finally { server.close(); }
});

test('GET /install pins the release URL and the Import-from-URL fallback', async () => {
  const { server, port } = await boot();
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/install');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^text\/html/);
    const html = await res.text();
    const release = 'https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/latest/download/autofish.user.js';
    assert.ok(html.includes('href="' + release + '"'), 'the release build is the linked install path');
    assert.ok(html.includes('Import from URL'), 'the local fallback is Import from URL');
    assert.ok(html.includes("For a local build, don't open the raw URL directly"), 'the page warns against opening the raw local URL');
    assert.match(html, /<code id="userscript">\/autofish\.user\.js<\/code>/, 'the local address is a code snippet');
    assert.doesNotMatch(html, /<a[^>]*id="userscript"/, 'the local address is not a clickable link');
    assert.ok(html.includes('If importing from URL also fails, use the release URL above.'), 'the final fallback points back at the release build');
    assert.ok(html.indexOf(release) < html.indexOf('Import from URL'), 'the release URL is presented before the local fallback');
    assert.ok(!html.includes('only the direct handoff stalls'), 'the page does not promise the local handoff');
  } finally { server.close(); }
});

test('GET /panel.user.js still points the legacy panel loader at the serving port', async () => {
  const { server, port } = await boot();
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/panel.user.js');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.doesNotMatch(body, /__FISHSERVE__/);
    assert.ok(body.includes('127.0.0.1:' + port), 'the injected origin is the request host');
  } finally { server.close(); }
});

test('GET /session.js serves the reducer with no-store', async () => {
  const { server, port } = await boot();
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/session.js');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /AutoFishSession/);
  } finally { server.close(); }
});

test('a missing static asset is a 404, not a 500', async () => {
  const { server, port } = await boot();
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/nope.js');
    assert.equal(res.status, 404);
  } finally { server.close(); }
});
