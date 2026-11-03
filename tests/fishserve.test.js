'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, readdirSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'fishserve-'));
  process.env.FISHSERVE_CATCHES = join(dir, 'catches.csv');
  process.env.FISHSERVE_SESSIONS = join(dir, 'sessions.csv');
  process.env.FISHSERVE_SHOTS = join(dir, 'shots');
  delete require.cache[require.resolve('../fishserve.js')];
  const { createServer } = require('../fishserve.js');
  const server = createServer();
  return new Promise((res) =>
    server.listen(0, '127.0.0.1', () => res({ server, dir, port: server.address().port })));
}

function post(port, route, body) {
  return fetch('http://127.0.0.1:' + port + route, { method: 'POST', body: JSON.stringify(body) });
}

test('POST /session appends a row and GET /sessions totals the day', async () => {
  const { server, dir, port } = await boot();
  try {
    const r = await post(port, '/session', { started_at: '2026-10-27T08:00:00.000Z', minutes: 12, catches: 5, reason: 'duration' });
    assert.equal(r.status, 200);
    const body = await (await fetch('http://127.0.0.1:' + port + '/sessions?day=2026-10-27')).json();
    assert.equal(body.minutes, 12);
    assert.equal(body.rows.length, 1);
    assert.match(readFileSync(join(dir, 'sessions.csv'), 'utf8'), /,12,5,duration/);
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
