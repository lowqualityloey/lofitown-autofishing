/**
 * fishserve - serves the AutoFish files to the lofi.town tab and owns the records.
 *
 *   GET  /autofish.js      the in-page bot module        (no-store, CORS open)
 *   GET  /panel.js         the panel HUD                 (no-store, CORS open)
 *   GET  /session.js       the session reducer           (no-store, CORS open)
 *   GET  /layout.js        the placement math            (no-store, CORS open)
 *   GET  /autofish.user.js the standalone userscript (dist/, no server needed after install)
 *   GET  /panel.user.js    the loader userscript: mounts panel.js from this server
 *   GET  /install          the bookmarklet page          (text/html)
 *   GET  /overnight.js     the overnight export sampler, so it can be loaded with one <script> tag
 *                          instead of pasted (it posts exportRun() to /export every five minutes)
 *   POST /catch            { t, species, rarity, quality, weight, value } -> a catches.csv row
 *   POST /session          { started_at, minutes, catches, reason, profile } -> a sessions.csv row
 *   POST /diag             { png: data:image/png;base64,... , note, stats } -> shots/diag/ui-<time>.png
 *                          (a run that never sees a prompt uploads one frame so the detector can be fixed)
 *   POST /export           __fish.exportRun() JSON -> data/runs/export-<time>.json, one snapshot per post
 *                          (the page store holds 250 attempts, so an overnight run has to be sampled)
 *   GET  /sessions?day=    { day, rows, minutes }        minutes = total logged that day
 *   GET  /recent?n=5       the last n catches as JSON
 *
 * Run:  node fishserve.js     (listens on 127.0.0.1:8731)
 *
 * The card is canvas-drawn, but its strings go through CanvasRenderingContext2D.fillText, so the
 * page module reads species / rarity / weight / value as text and posts them here. Nothing is
 * inferred from pixels: rarity is blank only when the card printed none (common fish).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.FISHSERVE_PORT) || 8731;
const CATCH_HEAD = ['time', 'species', 'rarity', 'quality', 'weight', 'value'];
const SESSION_HEAD = ['time', 'started_at', 'minutes', 'catches', 'reason', 'profile'];
// The game page and this server's own install page are the only origins that need to talk to it.
// A wildcard let any page the user visited read the history, append CSV rows, or write PNGs - and
// CORS alone never stopped a write, so a foreign Origin is rejected outright on POST.
const CORS_HEADERS = { 'Access-Control-Allow-Headers': '*' };
const isAllowedOrigin = (origin, port) => !origin ||
  origin === 'https://lofi.town' || origin === 'https://app.lofi.town' ||
  origin === 'https://www.lofi.town' ||
  origin === 'http://localhost:' + port || origin === 'http://127.0.0.1:' + port;
const corsFor = (origin, port) => {
  if (!origin) return CORS_HEADERS;
  return isAllowedOrigin(origin, port)
    ? Object.assign({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }, CORS_HEADERS)
    : {};
};
const JS_HEAD = { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' };

// Resolved per request so tests can point the server at a temp dir.
const fileOf = (env, fallback) => process.env[env] || path.join(__dirname, fallback);
const CATCHES = () => fileOf('FISHSERVE_CATCHES', 'catches.csv');
const SESSIONS = () => fileOf('FISHSERVE_SESSIONS', 'sessions.csv');
const SHOTS = () => fileOf('FISHSERVE_SHOTS', 'shots');
const RUNS = () => fileOf('FISHSERVE_RUNS', path.join('data', 'runs'));

// url -> file on disk, all siblings of this script
const STATIC = {
  '/autofish.js': 'autofish.js',
  '/panel.js': 'panel.js',
  '/session.js': 'session.js',
  '/layout.js': 'layout.js',
  // The installable userscript is the BUILD (bot + chip, no server at runtime).
  // The old loader, which needs this server for the panel, stays reachable but is no longer
  // the thing to install: pointing Tampermonkey at a server-dependent file is the confusion
  // this split removes.
  '/autofish.user.js': 'dist/autofish.user.js',
  '/panel.user.js': 'autofish.user.js',
  '/install': 'install.html',
  '/overnight.js': 'scripts/overnight-export.js'
};

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/**
 * Session fields are tokens, not free text. The panel already reduces a profile to this shape;
 * doing it here too means a hand-written POST cannot inject a comma, quote or newline (or forge
 * extra columns), so the report can read the file with a plain comma split.
 */
const sessionToken = (v, fallback, max) =>
  String(v == null ? '' : v).trim().replace(/[^A-Za-z0-9 _-]/g, '').slice(0, max) || fallback;

const ensure = (file, head) => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, head.join(',') + '\n');
};

/**
 * sessions.csv used to have five columns and another build's file may already be on disk. The
 * profile column is appended to the header, never backfilled into rows: a row without it is the
 * default profile, so the history keeps the values the old build wrote and only the header line
 * changes, once, at startup.
 */
const ensureSessionHead = (file) => {
  ensure(file, SESSION_HEAD);
  const rows = readRows(file);
  if (rows.length && !splitRow(rows[0].replace(/\r$/, '')).includes('profile')) {
    rows[0] = SESSION_HEAD.join(',');
    fs.writeFileSync(file, rows.join('\n') + '\n');
  }
};

/** Split one CSV line, honouring the quoting written by cell(). */
function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);

/** Local calendar day (YYYY-MM-DD) of an ISO timestamp, so day totals match the wall clock. */
function localDay(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const json = (res, code, obj) => {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, res._cors || CORS_HEADERS));
  res.end(JSON.stringify(obj));
};

function readBody(req, done) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => done(body));
}

/** Same, but large enough for a full-window PNG (a 1600x1000 screenshot base64s to a few MB). */
function readBigBody(req, done) {
  let body = '';
  let over = false;
  req.on('data', (c) => {
    body += c;
    if (body.length > 1.2e7) { over = true; body = ''; req.destroy(); }
  });
  req.on('end', () => done(over ? null : body));
  req.on('error', () => done(null));
}

/** Fill __FISHSERVE__ in the userscript with the address the browser actually reached us on. */
function withHost(text, host) {
  const safe = String(host || '').replace(/[^A-Za-z0-9.:[\]-]/g, '') || ('127.0.0.1:' + PORT);
  return text.replace(/__FISHSERVE__/g, safe);
}

function createServer() {
  ensure(CATCHES(), CATCH_HEAD);
  ensureSessionHead(SESSIONS());

  return http.createServer((req, res) => {
    const url = req.url.split('?');
    const route = url[0];
    const query = new URLSearchParams(url[1] || '');
    const origin = req.headers.origin;
    const cors = corsFor(origin, PORT);
    res._cors = cors;
    if (req.method === 'POST' && origin && !isAllowedOrigin(origin, PORT)) {
      res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, cors));
      return res.end('forbidden origin');
    }

    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    const file = STATIC[route];
    if (req.method === 'GET' && file) {
      const full = path.join(__dirname, file);
      fs.readFile(full, (e, d) => {
        if (e) { res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, cors)); return res.end('not found'); }
        res.writeHead(200, route === '/install' ? Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, cors) : Object.assign({}, JS_HEAD, cors));
        // The userscript has to inject the panel from whichever host:port served it, and only the
        // request knows that (8731 is often already taken on Windows by an older copy).
        res.end(route.slice(-8) === '.user.js' ? withHost(d.toString('utf8'), req.headers.host) : d);
      });
      return;
    }

    if (req.method === 'POST' && route === '/catch') {
      readBody(req, (body) => {
        try {
          const rec = JSON.parse(body);
          if (!rec.species) throw new Error('no species in payload');
          const when = new Date(rec.t || Date.now());
          const row = [when.toISOString(), rec.species, rec.rarity, rec.quality, rec.weight, rec.value];
          fs.appendFileSync(CATCHES(), row.map(cell).join(',') + '\n');
          console.log(['catch', when.toISOString().slice(11, 19), rec.species,
            rec.rarity || '-', rec.quality || '-', rec.weight || '-', rec.value || '-'].join('  '));
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 400, { ok: false, e: String((e && e.message) || e) });
        }
      });
      return;
    }

    if (req.method === 'POST' && route === '/session') {
      readBody(req, (body) => {
        try {
          const rec = JSON.parse(body);
          if (!Number.isFinite(Number(rec.minutes))) throw new Error('minutes must be a number');
          const profile = sessionToken(rec.profile, 'default', 24);
          const reason = sessionToken(rec.reason, 'user', 32);
          const row = [new Date().toISOString(), rec.started_at || '', Number(rec.minutes), Number(rec.catches) || 0, reason, profile];
          fs.appendFileSync(SESSIONS(), row.map(cell).join(',') + '\n');
          console.log(['session', profile, row[4], row[2] + ' min', row[3] + ' catches'].join('  '));
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 400, { ok: false, e: String((e && e.message) || e) });
        }
      });
      return;
    }

    if (req.method === 'POST' && route === '/diag') {
      readBigBody(req, (body) => {
        if (!body) return json(res, 413, { ok: false, e: 'payload too large or unreadable' });
        try {
          const rec = JSON.parse(body);
          const m = /^data:image\/png;base64,(.+)$/.exec(String(rec.png || ''));
          if (!m) throw new Error('png must be a data:image/png;base64 URL');
          const dir = path.join(SHOTS(), 'diag');
          fs.mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const file = path.join(dir, 'ui-' + stamp + '.png');
          fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
          fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({
            note: rec.note || '', stats: rec.stats || null, viewport: rec.viewport || null, dpr: rec.dpr || null
          }, null, 2));
          const rel = path.relative(__dirname, file);
          console.log('diag  saved ' + rel + (rec.note ? '  (' + rec.note + ')' : ''));
          json(res, 200, { ok: true, file: rel });
        } catch (e) {
          json(res, 400, { ok: false, e: String((e && e.message) || e) });
        }
      });
      return;
    }

    if (req.method === 'POST' && route === '/export') {
      readBigBody(req, (body) => {
        if (!body) return json(res, 413, { ok: false, e: 'payload too large or unreadable' });
        try {
          const rec = JSON.parse(body);
          if (!rec || !Array.isArray(rec.attempts)) throw new Error('an export must carry an attempts array');
          const dir = RUNS();
          fs.mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const name = 'export-' + stamp + '.json';
          fs.writeFileSync(path.join(dir, name), JSON.stringify(rec));
          console.log(['export', rec.attempts.length + ' attempts', rec.profile || '-', name].join('  '));
          json(res, 200, { ok: true, file: name });
        } catch (e) {
          json(res, 400, { ok: false, e: String((e && e.message) || e) });
        }
      });
      return;
    }

    if (req.method === 'GET' && route === '/sessions') {
      // The rows are bucketed by localDay(), and the panel asks with its own local dayKey(); the
      // default must agree with both, or a NSW morning would query yesterday's UTC date.
      const day = query.get('day') || localDay(new Date().toISOString());
      // Every profile writes its own rows; a caller that does not say which profile it is asking
      // for gets the default one, never the sum of every account in the file.
      const profile = query.get('profile') || 'default';
      const rows = readRows(SESSIONS()).slice(1)
        .map(splitRow)
        .filter((r) => localDay(r[1] || r[0]) === day && (r[5] || 'default') === profile)
        .map((r) => ({
          time: r[0], started_at: r[1], minutes: Number(r[2]) || 0, catches: Number(r[3]) || 0,
          reason: r[4], profile: r[5] || 'default',
        }));
      json(res, 200, { day, profile, rows, minutes: rows.reduce((a, r) => a + r.minutes, 0) });
      return;
    }

    if (req.method === 'GET' && route === '/recent') {
      const n = Math.max(1, Math.min(200, Number(query.get('n')) || 5));
      const rows = readRows(CATCHES()).slice(1).map(splitRow)
        .map((r) => ({ time: r[0], species: r[1], rarity: r[2], quality: r[3], weight: r[4], value: r[5] }))
        .slice(-n);
      json(res, 200, { rows });
      return;
    }

    res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, cors));
    res.end('not found');
  });
}

module.exports = { createServer, PORT };

if (require.main === module) {
  createServer().listen(PORT, '127.0.0.1', () => console.log('fishserve on ' + PORT));
}
