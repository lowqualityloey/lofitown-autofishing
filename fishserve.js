/**
 * fishserve - serves the AutoFish files to the lofi.town tab and owns the records.
 *
 *   GET  /autofish.js      the in-page bot module        (no-store, CORS open)
 *   GET  /panel.js         the panel HUD                 (no-store, CORS open)
 *   GET  /session.js       the session reducer           (no-store, CORS open)
 *   GET  /layout.js        the placement math            (no-store, CORS open)
 *   GET  /autofish.user.js the userscript                (no-store, CORS open)
 *   GET  /install          the bookmarklet page          (text/html)
 *   POST /catch            { t, species, rarity, quality, weight, value } -> a catches.csv row
 *   POST /session          { started_at, minutes, catches, reason }      -> a sessions.csv row
 *   POST /diag             { png: data:image/png;base64,... , note, stats } -> shots/diag/ui-<time>.png
 *                          (a run that never sees a prompt uploads one frame so the detector can be fixed)
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
const SESSION_HEAD = ['time', 'started_at', 'minutes', 'catches', 'reason'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const JS = Object.assign({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }, CORS);

// Resolved per request so tests can point the server at a temp dir.
const fileOf = (env, fallback) => process.env[env] || path.join(__dirname, fallback);
const CATCHES = () => fileOf('FISHSERVE_CATCHES', 'catches.csv');
const SESSIONS = () => fileOf('FISHSERVE_SESSIONS', 'sessions.csv');
const SHOTS = () => fileOf('FISHSERVE_SHOTS', 'shots');

// url -> file on disk, all siblings of this script
const STATIC = {
  '/autofish.js': 'autofish.js',
  '/panel.js': 'panel.js',
  '/session.js': 'session.js',
  '/layout.js': 'layout.js',
  '/autofish.user.js': 'autofish.user.js',
  '/install': 'install.html'
};

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const ensure = (file, head) => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, head.join(',') + '\n');
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
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, CORS));
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

function createServer() {
  ensure(CATCHES(), CATCH_HEAD);
  ensure(SESSIONS(), SESSION_HEAD);

  return http.createServer((req, res) => {
    const url = req.url.split('?');
    const route = url[0];
    const query = new URLSearchParams(url[1] || '');

    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    const file = STATIC[route];
    if (req.method === 'GET' && file) {
      const full = path.join(__dirname, file);
      fs.readFile(full, (e, d) => {
        if (e) { res.writeHead(404, CORS); return res.end('not found'); }
        res.writeHead(200, route === '/install' ? Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) : JS);
        res.end(d);
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
          const row = [new Date().toISOString(), rec.started_at || '', Number(rec.minutes), Number(rec.catches) || 0, rec.reason || 'user'];
          fs.appendFileSync(SESSIONS(), row.map(cell).join(',') + '\n');
          console.log(['session', row[4], row[2] + ' min', row[3] + ' catches'].join('  '));
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

    if (req.method === 'GET' && route === '/sessions') {
      const day = query.get('day') || new Date().toISOString().slice(0, 10);
      const rows = readRows(SESSIONS()).slice(1)
        .map(splitRow)
        .filter((r) => localDay(r[1] || r[0]) === day)
        .map((r) => ({ time: r[0], started_at: r[1], minutes: Number(r[2]) || 0, catches: Number(r[3]) || 0, reason: r[4] }));
      json(res, 200, { day, rows, minutes: rows.reduce((a, r) => a + r.minutes, 0) });
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

    res.writeHead(404, CORS);
    res.end('not found');
  });
}

module.exports = { createServer, PORT };

if (require.main === module) {
  createServer().listen(PORT, '127.0.0.1', () => console.log('fishserve on ' + PORT));
}
