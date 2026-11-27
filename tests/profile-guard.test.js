'use strict';
/**
 * v3.9.33: a tap must never be the thing that opens a profile.
 *
 * Two layers: (1) a boxed blob carrying opaque-dark tag text never taps - the real prompt's
 * text is soft/translucent (measured live: prompt opaque 0.002, tag 0.265, line at 0.05);
 * (2) an open profile dialog pauses the clock with a named reason (and the core tries
 * Escape) instead of fishing behind it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');
const LOOP_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'loop.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const { createState, reduce } = require('../session.js');

const T0 = 1_800_000_000_000;
const tick = (state, at, over) => reduce(state, Object.assign({ type: 'tick', at, visible: true, catches: 0, errors: 0, todayMs: 0 }, over || {}));

const { glyphMetrics } = require('../src/vision.js');
const glyphIs = (d, w, s, e, y0, y1) => glyphMetrics(d, w, s, e, y0, y1).ok;

/** White RGBA field with a painter (full-res detector buffer). Ink defaults to opaque dark. */
function buf(w, h, paint, ink) {
  const c = ink || [20, 20, 20, 255];
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { d[p * 4] = 255; d[p * 4 + 1] = 255; d[p * 4 + 2] = 255; d[p * 4 + 3] = 255; }
  paint((x, y) => { const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; });
  return d;
}
function bars(set, xs, y0, y1, bw) {
  for (const gx of xs) for (let x = gx; x < gx + bw; x++) for (let y = y0; y <= y1; y++) set(x, y);
}
const SOFT = [140, 140, 140, 80]; // prompt-like: translucent grey, as captured live

test('soft prompt text may tap, opaque tag text never may', () => {
  // Prompt-like: soft bars covering ~17% of the inset, almost nothing opaque.
  const prompt = glyphMetrics(
    buf(108, 50, (set) => bars(set, [10, 24, 38, 52, 66, 80], 12, 30, 8), SOFT), 108, 0, 108, 0, 50);
  assert.equal(prompt.ok, true);
  assert.ok(prompt.dark < 0.01, 'no opaque ink, dark ' + prompt.dark);
  assert.ok(prompt.soft > 0.1, 'soft text present, soft ' + prompt.soft);
  // Tag-like: the same bars in opaque dark - the measured 0.265 class.
  const tag = glyphMetrics(
    buf(108, 50, (set) => bars(set, [10, 24, 38, 52, 66, 80], 12, 30, 8)), 108, 0, 108, 0, 50);
  assert.equal(tag.ok, false);
  assert.ok(tag.dark > 0.05, 'opaque share ' + tag.dark + ' trips the line');
});

test('a blank bubble reads as tappable - only tag text blocks', () => {
  assert.equal(glyphIs(buf(100, 48, () => {}), 100, 0, 100, 0, 48), true);
  const d = buf(100, 48, (set) => {
    for (let x = 0; x < 100; x++) { set(x, 0); set(x, 47); }
    for (let y = 0; y < 48; y++) { set(0, y); set(99, y); }
  });
  assert.equal(glyphIs(d, 100, 0, 100, 0, 48), true, 'the 2px inset ignores the bubble outline');
});

test('the opaque line stands between the measured prompt and tag', () => {
  // Fill shares of the inset with opaque ink: 4% passes, 6% blocks (line at 5%).
  const fill = (frac) => {
    const W = 100, H = 40;
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    const n = Math.floor((W - 4) * (H - 4) * frac);
    for (let p = 0; p < n; p++) {
      const q = p + 2 * W + 2; // start inside the 2px inset the metric reads
      d[q * 4] = 20; d[q * 4 + 1] = 20; d[q * 4 + 2] = 20;
    }
    return glyphMetrics(d, W, 0, W, 0, H);
  };
  assert.equal(fill(0.04).ok, true, 'prompt 0.002 and blank 0.004 clear it');
  assert.equal(fill(0.06).ok, false, 'tag 0.265 trips it');
});

test('every bubble logs its glyph verdict for the live watch', () => {
  assert.match(LOOP_SRC, /gdark: typeof b\.gdark === 'number' \? b\.gdark : null, gsoft: typeof b\.gsoft === 'number' \? b\.gsoft : null/);
  assert.doesNotMatch(CORE, /capture-core/, 'the pixel instrument shipped out; verdict telemetry stays');
});

test('a blob carrying tag text never reaches the tap gate', () => {
  assert.match(CORE, /if \(b\.glyph === false\) return false;/);
  assert.match(CORE, /var gm = glyphMetrics\(d, w, s, x, y0, y1\);/);
  assert.match(CORE, /best\.glyph = gm\.ok; best\.gdark = \+gm\.dark\.toFixed\(3\); best\.gsoft = \+gm\.soft\.toFixed\(3\);/);
});

test('the core spots an open profile from its buttons, not pixels', () => {
  const start = CORE.indexOf('  F.profileOpen = function () {');
  assert.ok(start >= 0, 'F.profileOpen is missing');
  const fn = CORE.slice(start, CORE.indexOf('\n  };', start));
  assert.match(fn, /tx === 'Send DM' \|\| tx === 'Burrows'/);
  assert.doesNotMatch(fn, /closest/, 'the panel lives in closed shadow DOM, invisible to the scan');
});

test('the dial lock records whether tap or Space summoned it', () => {
  // The tail is too short to prove the cause later, so it persists on status.
  assert.match(LOOP_SRC, /F\.lastBubbleCause = \{ tap: tapOk, space: !!rec\.space, glyph: b\.glyph === true, at: t \};/);
  assert.match(LOOP_SRC, /F\.lastDialCause = \{ tap: /);
  assert.match(LOOP_SRC, /cause: dcCause/);
  assert.match(CORE, /lastDialCause: F\.lastDialCause \|\| null,/);
});

test('the narrow hold counts its engagements', () => {
  assert.match(LOOP_SRC, /F\.stats\.narrowHolds = \(F\.stats\.narrowHolds \|\| 0\) \+ 1;/);
});

test('a lost attempt persists its reason on status', () => {
  // The tail holds 8 entries; the loss reason must survive it like the dial cause does.
  assert.match(CORE, /F\.lastAttemptLoss = \{ n: a\.n, why: a\.why,/);
  assert.match(CORE, /dialHits: a\.dialHits, dialMisses: a\.dialMisses/);
  assert.match(CORE, /lastAttemptLoss: F\.lastAttemptLoss \|\| null,/);
});

test('the core tries Escape when a profile is open', () => {
  assert.match(CORE, /function tryEscapeProfile\(t\)/);
  assert.match(LOOP_SRC, /tryEscapeProfile\(t\)/);
  assert.match(CORE, /L\('escape profile', \{\}\);/);
});

test('status() reports profileOpen without needing a DOM', () => {
  assert.match(CORE, /profileOpen: typeof F\.profileOpen === 'function' \? !!F\.profileOpen\(\) : false,/);
  const start = CORE.indexOf('  F.status = function () {');
  const end = CORE.indexOf('\n  };', start);
  const status = new Function('F', 'loadLedger', 'uiFrame', 'now', 'pressVerdictReport',
    CORE.slice(start, end + '\n  };'.length) + '\nreturn F.status;'
  )({ stats: {}, catches: [], events: [], widthReport: () => [] },
    () => ({ total: 0, species: {} }), () => null, () => 5000,
    () => ({ observed: { rate: null }, assumed: { rate: null }, timing: { rate: null } }));
  assert.equal(status().profileOpen, false, 'no document in scope reads closed, not throws');
});

const D = require('../src/diagnostics.js');

test('doctor() names the open profile instead of waiting for a no-catch', () => {
  const base = { running: true, paused: false, hidden: false, stalled: false, postRender: true,
    snapshot: { gl: 100, canvas2d: 0 }, readback: { canvas2d: 0 }, longtasks: { inLast10s: 0, maxMs: 10 },
    worstFrameMs: 50, needsSeat: false, sincePromptMs: 5000, sinceDialMs: 60000,
    accepted: 0, rejected: 0, dials: 0, held: 0, forced: 0, holdPassesMax: 0 };
  assert.equal(D.doctor(Object.assign({}, base, { profileOpen: true })).verdict, 'profile-open');
  assert.equal(D.doctor(base).verdict, 'waiting-bite');
});

test('an open profile pauses the clock with a named reason and bounded retries', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  const r = tick(state, T0 + 120_000, { profileOpen: true });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'profile-open');
  assert.deepEqual(r.actions.map(a => a.type), ['pauseCore', 'persist']);
  // retry resumes, a still-open profile re-pauses, exhaustion stops as profile-open
  let at = T0 + 120_000;
  let s = r.state;
  for (let i = 0; i < 3; i++) {
    at += 61_000;
    const back = tick(s, at, { profileOpen: false });
    assert.equal(back.state.phase, 'running', 'retry ' + i);
    s = back.state;
    at += 1000;
    const held = tick(s, at, { profileOpen: true });
    assert.equal(held.state.pauseReason, 'profile-open');
    s = held.state;
  }
  const stop = tick(s, at + 61_000, { profileOpen: false });
  assert.equal(stop.state.stopReason, 'profile-open');
});

test('the panel passes profileOpen through and reuses the move-spots banner', () => {
  assert.match(PANEL, /profileOpen: !!\(status && status\.profileOpen\)/);
  assert.match(PANEL, /state\.pauseReason === 'profile-open'/);
  assert.match(PANEL, /host\.dataset\.profileOpen = '1'/);
});
