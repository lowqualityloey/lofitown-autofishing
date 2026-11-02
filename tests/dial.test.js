'use strict';
/**
 * The dial's circle is the one piece of geometry a fresh run cannot learn without a prompt, so it
 * is remembered across reloads. The pure block lives in autofish.js and is extracted here by its
 * sentinels, like the timing core and the ledger.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const OPEN = '// <dial-memory>';
const CLOSE = '// </dial-memory>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('dial-memory sentinels are missing from autofish.js');
const CODE = SRC.slice(a + OPEN.length, b);
const EXPORTS = ['dialGeoFit', 'loadDialMemory', 'saveDialMemory', 'sameDial', 'DIAL_KEY', 'DIAL_R_MIN', 'DIAL_R_MAX'];

function store(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    data,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
  };
}

function load(opts) {
  const o = opts || {};
  const st = o.store || store();
  const canvas = o.canvas === undefined ? { width: 1600, height: 1000 } : o.canvas;
  const api = new Function('window', 'uiCanvas', CODE + '\nreturn { ' + EXPORTS.join(', ') + ' };')(
    { localStorage: st },
    canvas
  );
  api.store = st;
  return api;
}

const T = load();

test('a remembered circle is reused unchanged on the canvas it was measured on', () => {
  assert.deepEqual(
    T.dialGeoFit({ cx: 840, cy: 411, R: 96, cw: 1680, ch: 1031 }, 1680, 1031),
    { cx: 840, cy: 411, R: 96 }
  );
});

test('a remembered circle scales with a proportionally resized canvas', () => {
  assert.deepEqual(
    T.dialGeoFit({ cx: 840, cy: 411, R: 96, cw: 1680, ch: 1031 }, 1260, 773.25),
    { cx: 630, cy: 308, R: 72 }
  );
});

test('a circle from a different aspect, or junk, is not trusted', () => {
  const good = { cx: 840, cy: 411, R: 96, cw: 1680, ch: 1031 };
  assert.equal(T.dialGeoFit(good, 1680, 800), null, 'a different aspect is a different camera');
  assert.equal(T.dialGeoFit(good, 0, 0), null);
  assert.equal(T.dialGeoFit(null, 1680, 1031), null);
  assert.equal(T.dialGeoFit({ cx: 'x', cy: 411, R: 96, cw: 1680, ch: 1031 }, 1680, 1031), null);
  assert.equal(T.dialGeoFit({ cx: 10, cy: 411, R: 400, cw: 1680, ch: 1031 }, 1680, 1031), null, 'R out of range');
  assert.equal(T.dialGeoFit({ cx: -5, cy: 411, R: 96, cw: 1680, ch: 1031 }, 1680, 1031), null);
});

test('the memory round-trips, and a broken store is not fatal', () => {
  const one = load();
  assert.equal(one.saveDialMemory({ cx: 840.4, cy: 411.2, R: 96 }), true);
  assert.deepEqual(one.loadDialMemory(), { cx: 840, cy: 411, R: 96, cw: 1600, ch: 1000 });
  assert.equal(one.saveDialMemory(null), false, 'no canvas means no write');
  assert.equal(load({ canvas: null }).saveDialMemory({ cx: 1, cy: 1, R: 90 }), false);

  const bad = load({ store: store({ [T.DIAL_KEY]: '{not json' }) });
  assert.equal(bad.loadDialMemory(), null);
  const wrong = load({ store: store({ [T.DIAL_KEY]: JSON.stringify({ v: 2, cx: 1, cy: 1, R: 90, cw: 1, ch: 1 }) }) });
  assert.equal(wrong.loadDialMemory(), null, 'an unknown version is not read');
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const blocked = load({ store: hostile });
  assert.equal(blocked.loadDialMemory(), null);
  assert.equal(blocked.saveDialMemory({ cx: 1, cy: 1, R: 90 }), false);
});

test('sameDial only treats a small move as the same widget', () => {
  assert.equal(T.sameDial({ cx: 800, cy: 400, R: 96 }, { cx: 802, cy: 401, R: 97 }), true);
  assert.equal(T.sameDial({ cx: 800, cy: 400, R: 96 }, { cx: 810, cy: 400, R: 96 }), false);
  assert.equal(T.sameDial(null, { cx: 1, cy: 1, R: 90 }), false);
});

test('a fresh start seeds the hint from memory or the play area, never a literal', () => {
  const from = SRC.indexOf('F.start = function');
  const to = SRC.indexOf('F.stop = function', from);
  const start = SRC.slice(from, to > from ? to : from + 6000);
  assert.match(start, /dialGeoFit\(loadDialMemory\(\)/);
  assert.match(start, /if \(!F\.lastGeo\)/);
  assert.doesNotMatch(start, /x: 861, y: 372/);
});

test('the dial search can widen, and a blind run has a whole-surface recovery', () => {
  assert.match(SRC, /F\.lockDial = function \(hintX, hintY, span\)/);
  assert.match(SRC, /function dialAnywhere\(\)/);
  assert.match(SRC, /dialFallbackMs: \d+/, 'the fallback needs a default');
  const at = SRC.indexOf('let g = F.lockDial(F.hint.x, F.hint.y);');
  assert.ok(at > 0, 'the hinted search is missing');
  const step = SRC.slice(at, at + 500);
  assert.match(step, /dialAnywhere\(\)/, 'step must fall back when the hint is wrong');
  assert.match(step, /F\.opts\.dialFallbackMs/);
});

test('a new dial opens the press gate, and an accepted press re-arms the next rotation', () => {
  // Live 2026-11-02, narrow band 9/12: one lost attempt locked seven dials and pressed three times
  // with nothing rejected. The gate (F.armed) was never opened on arrival at a new spawn.
  assert.match(SRC, /g\._armed0 = !!F\.armed;\s+F\.armed = true;/, 'a new spawn must open the gate');
  assert.match(SRC, /const spawnProven = newTriangle\(F\.pressStamp, s, F\.dialBlinks, F\.opts\) \|\|/);
  assert.match(SRC, /F\.acceptedAt != null && t - F\.acceptedAt <=/, 'an accepted press is proof of a spawn');
  assert.match(SRC, /locksDisarmed = \(F\.stats\.locksDisarmed \|\| 0\) \+ 1/, 'a dial that dies unpressed must be countable');
  assert.match(SRC, /!F\.geo\._armed0 && presses === 0/, 'and only that case: arriving shut is normal now');
  assert.match(SRC, /F\.attempt\.dialLog\.push/, 'a dial that passed untouched must be visible per attempt');
});

test('a prompt found anywhere is a hint, never a click target', () => {
  // Live 2026-11-02: the whole-surface scan matched players' name tags - the same white blob, text
  // included - and tapping one opened that player's profile in the middle of a session.
  assert.match(SRC, /via: 'anywhere'/);
  assert.match(SRC, /via: 'box'/);
  assert.match(SRC, /const clickable = b\.via !== 'anywhere';/);
  assert.match(SRC, /if \(rec\.tap && clickable\) tap\(b\.cx, b\.cy\);/);
  // A name tag is one size smaller than the prompt: the box scan refuses anything under 28 px tall
  // and anything that is not mostly solid white.
  assert.match(SRC, /bh >= 28 && bh < 95/);
  assert.match(SRC, /fill >= 0\.45/);
});

test('the recovery pass reuses the shared grab and the same validation', () => {
  const fn = SRC.slice(SRC.indexOf('const GREEN_LOOSE'), SRC.indexOf('F.sample = function'));
  assert.match(fn, /function greenBlobs\(\)/);
  assert.match(fn, /snapshot\(\)/);
  assert.match(fn, /finishLock\(r, mask, fine\)/, 'the recovery must prove its circle with the same validator');
  assert.ok(fn.indexOf('downscale()') < 0, 'no second copy of the layer');
  assert.match(fn, /dialFallbackWait\(F\.dialAnyFail, F\.opts\)/, 'the recovery is throttled and backs off');
  assert.match(fn, /F\.dialAnyFail = \(F\.dialAnyFail \|\| 0\) \+ 1/, 'a fruitless pass must raise the wait');
});

test('a lock is written back only when the widget actually moved', () => {
  assert.match(SRC, /if \(!sameDial\(F\.lastGeo, g\)\) saveDialMemory\(g\);/);
});

// The first recovery shipped with a guessed size window that capped a wedge's height at 90 px.
// The real wedge is a ~165-degree sector, so its bbox is ~1.8R tall (~215 px at the largest dial)
// and the cap rejected the very thing it was looking for. These are the dimensions a live probe
// measured, not invented ones.
test('the whole-surface wedge finder accepts the real sector and rejects specks and washes', () => {
  const at = SRC.indexOf('function wedgeBoxOk');
  assert.ok(at > 0, 'wedgeBoxOk is missing');
  const ok = new Function(SRC.slice(at, SRC.indexOf('\n  }', at) + 4) + '\nreturn wedgeBoxOk;')();
  assert.equal(ok(216, 216), true, 'a 165-degree sector at R=120 must pass');
  assert.equal(ok(60, 108), true, 'the tall bbox the live probe measured must pass');
  assert.equal(ok(115, 60), true, 'a small window painting a real arc must pass');
  assert.equal(ok(30, 30), true, 'the smallest plausible wedge must pass');
  assert.equal(ok(12, 12), false, 'antialiasing speckle is not a wedge');
  assert.equal(ok(1000, 800), false, 'a green wash over the layer is not a wedge');
  assert.equal(ok(60, 4), false, 'a thin horizontal streak is not a wedge');
});
