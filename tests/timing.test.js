'use strict';
/**
 * The press-timing maths lives inside autofish.js (it has to ship as one injected file), so
 * it is marked with sentinels and extracted here. One source, tested where it is used.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const TIMING_SRC = readFileSync(join(__dirname, '..', 'src', 'timing.js'), 'utf8');
const LOOP_SRC = readFileSync(join(__dirname, '..', 'src', 'loop.js'), 'utf8');
const T = require('../src/timing.js');
const { refreshLossDiagnostic } = require('../src/loop.js');

/** Frames at a fixed cadence: build returns [{t, mid}] with mid = start + rate*ms/1000. */
function frames(rate, n, opts) {
  const o = opts || {};
  const step = o.step || 16.7;
  const t0 = o.t0 != null ? o.t0 : 1000;
  const start = o.start != null ? o.start : 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step;
    pts.push({ t, mid: T.wrap180(start + rate * (t - t0) / 1000) + 180 });
  }
  return pts.map((p) => ({ t: p.t, mid: p.mid - 180 }));
}

test('timing core is present and exports the helpers', () => {
  for (const k of ['wrap180', 'deltaOmega', 'fitOmega', 'fitStable', 'firstPressGate', 'planPress', 'sweepBias', 'omegaBand', 'widthBand', 'cardShapeOk', 'newTriangle', 'pressOutcome', 'castRecovery', 'perfRates', 'firstPressBudget', 'firstPressCanMature', 'markFirstPressForced', 'rearmReady', 'dialFallbackWait', 'dialGhost', 'dialStalled', 'ghostBlocked', 'spinAlive', 'lossDiagnostics']) {
    assert.equal(typeof T[k], 'function', k);
  }
});

test('wrap180 folds into (-180, 180]', () => {
  assert.equal(T.wrap180(0), 0);
  assert.equal(T.wrap180(180), -180);
  assert.equal(T.wrap180(181), -179);
  assert.equal(T.wrap180(-181), 179);
  assert.equal(T.wrap180(725), 5);
  assert.equal(T.wrap180(-365), -5);
});

test('fitOmega reads a constant fast spin, including wrapping through 0', () => {
  const pts = frames(600, 5);
  const fit = T.fitOmega(pts, { now: pts[pts.length - 1].t });
  assert.ok(Math.abs(fit.omega - 600) < 1, 'omega ' + fit.omega);
  assert.equal(fit.clamped, false);
  // 350, 355, 0, 5 deg at 16.7 ms is +300 deg/s, not a -355 deg/s jump.
  const wrap = [
    { t: 0, mid: 350 }, { t: 16.7, mid: 355 }, { t: 33.4, mid: 0 }, { t: 50.1, mid: 5 },
  ];
  const f2 = T.fitOmega(wrap, { now: 50.1 });
  assert.ok(Math.abs(f2.omega - 300) < 20, 'omega ' + f2.omega);
});

test('fitOmega resolves a slow spin the old 0.5 deg deadband reported as zero', () => {
  const pts = frames(20, 6);                       // ~0.33 deg per frame
  const fit = T.fitOmega(pts, { now: pts[pts.length - 1].t, minSpanMs: 12 });
  assert.ok(fit, 'fit should exist');
  assert.ok(Math.abs(fit.omega - 20) < 2, 'omega ' + fit.omega);
});

test('fitOmega drops one mis-tracked frame instead of believing it', () => {
  const pts = frames(120, 6);
  pts[3] = { t: pts[3].t, mid: T.wrap180(pts[3].mid + 40) };
  const clean = T.fitOmega(frames(120, 6), { now: pts[pts.length - 1].t });
  const fit = T.fitOmega(pts, { now: pts[pts.length - 1].t });
  assert.equal(fit.dropped, 1);
  assert.ok(Math.abs(fit.omega - clean.omega) < 5, 'omega ' + fit.omega);
});

test('fitOmega refuses stale frames, single frames and clamped nonsense', () => {
  const old = frames(120, 4, { t0: 0, step: 50 });   // last at 150
  assert.equal(T.fitOmega(old, { now: 500, maxAgeMs: 200 }), null);
  assert.equal(T.fitOmega([{ t: 10, mid: 3 }], { now: 10 }), null);
  assert.equal(T.fitOmega([{ t: 10, mid: 3 }, { t: 10, mid: 4 }], { now: 10 }), null);
  const fast = frames(2000, 5);
  const fit = T.fitOmega(fast, { now: fast[fast.length - 1].t });
  assert.equal(fit.omega, 1500);
  assert.equal(fit.clamped, true);
});

test('fitStable demands a mature fit before a first press on a hard dial', () => {
  const pts = frames(300, 10);
  const clean = T.fitOmega(pts, { now: pts[pts.length - 1].t, minSpanMs: 12 });
  assert.ok(clean, 'the synthetic spin fits');
  assert.equal(T.fitStable(clean, {}), true, '10 points over 150 ms is enough');
  assert.equal(T.fitStable(clean, { firstPressMinN: 11 }), false, 'too few points');
  assert.equal(T.fitStable(clean, { firstPressMinSpanMs: 200 }), false, 'too short a window');
  assert.equal(T.fitStable(Object.assign({}, clean, { rms: 5 }), {}), false, 'a noisy fit is not trusted');
  assert.equal(T.fitStable(Object.assign({}, clean, { clamped: true }), {}), false, 'a clamped rate is not trusted');
  assert.equal(T.fitStable(null, {}), false);
});

test('deltaOmega gives the planner the rate of delta, not the tracker midpoint rate', () => {
  assert.equal(T.deltaOmega(142), -142);
  assert.equal(T.deltaOmega(-142), 142);
  assert.equal(T.deltaOmega(0), 0);
  assert.equal(T.deltaOmega(null), null);
  // Live 2026-11-03, The Bloop (Legendary): a 40 deg dial at a mid rate of -116..-142 deg/s.
  // delta = pin - mid, so its rate is the negation. At delta -16 inside a 40 deg arc (win 16) the
  // converted rate is inside-now; the raw mid rate waits for the opposite crossing.
  const contain = { trigger: 'contain', midDeg: 6, marginDeg: 4, leadMs: 25, horizonMs: 40 };
  const fixed = T.planPress({ t: 1000, width: 40, armed: true, delta: -16, omega: T.deltaOmega(-142) }, contain);
  assert.equal(fixed.reason, 'inside-now');
  assert.equal(fixed.press, true);
  const raw = T.planPress({ t: 1000, width: 40, armed: true, delta: -16, omega: -142 }, contain);
  assert.equal(raw.press, false, 'the raw midpoint rate waits for the opposite crossing');
  assert.notEqual(raw.reason, 'inside-now');
  // Conversion happens once at the source; the tracker keeps the midpoint rate for tracking.
  assert.match(SRC, /const omega = deltaOmega\(midOmega\)/);
  assert.match(SRC, /geo\._om = midOmega/);
});

test('a short shrinking narrow dial is a ghost, not a skipped fish', () => {
  const ghost = { presses: 0, heldMs: 2743, width: 30, widthShrink: 10, travel: 35 };
  assert.equal(T.dialGhost(ghost, {}), true, 'the live 30-40 deg fade is a ghost');
  assert.equal(T.dialGhost(Object.assign({}, ghost, { travel: 0 }), {}), true, 'the old static ghost stays a ghost');
  assert.equal(T.dialGhost(Object.assign({}, ghost, { heldMs: 15900 }), {}), false, 'a real dial timing out is not a ghost');
  assert.equal(T.dialGhost(Object.assign({}, ghost, { width: 70 }), {}), false, 'a wide real dial is not a ghost');
  assert.equal(T.dialGhost(Object.assign({}, ghost, { widthShrink: 2 }), {}), false, 'without a fade it is a skipped dial');
  assert.equal(T.dialGhost(Object.assign({}, ghost, { presses: 1 }), {}), false, 'a pressed dial is never a ghost');
  assert.equal(T.dialGhost(ghost, { ghostMaxMs: 2000 }), false, 'the lifetime is configurable');
  assert.match(LOOP_SRC, /const ghost = dialGhost\(\{ presses, heldMs, width, widthShrink, travel: F\.dialTravel \}, F\.opts\)/);
  assert.match(LOOP_SRC, /F\.ghostGeo = \{/);
  assert.match(LOOP_SRC, /F\.lastLockAt = 0/, 'the memo must be cleared on a ghost');
  assert.match(LOOP_SRC, /const last = presses > 0 \? F\.dialLastPress : null/, 'zero-press telemetry must not reuse the previous press');
});

test('a narrow dial with a fresh spin holds the lock through blind frames', () => {
  // Live 85%: two 40 deg dials, spin 50-140 deg/s, ring lost just before the pin arrived,
  // zero presses, both fish gone. A fade sits still, so fresh spin tells them apart. The
  // witness is the sampler's own frozen _om/_mt: no new state, and the certified fade below
  // (still ring, no spin) still ghosts on schedule because the hold never engages for it.
  assert.equal(T.spinAlive({ width: 40, _om: 120, _mt: 900 }, 1000), true);
  assert.equal(T.spinAlive({ width: 40, _om: 0, _mt: 900 }, 1000), false, 'a still fade never holds');
  assert.equal(T.spinAlive({ width: 40, _om: null, _mt: 900 }, 1000), false, 'unmeasured spin never holds');
  assert.equal(T.spinAlive({ width: 40, _om: 120, _mt: 0 }, 1000), false, 'stale spin expires on its own');
  assert.equal(T.spinAlive({ width: 70, _om: 120, _mt: 900 }, 1000), false, 'wide dials keep the old path');
  assert.equal(T.spinAlive(null, 1000), false);
  assert.match(LOOP_SRC, /spinAlive\(F\.geo, t\)/);
  assert.doesNotMatch(SRC, /lastSpinAt/, 'the witness lives on the lock, not in new state');
});

test('a ghost cooldown blocks the same fading circle but allows a wider real dial', () => {
  const ghost = { cx: 840, cy: 411, R: 96, width: 35, until: 5000 };
  assert.equal(T.ghostBlocked({ cx: 842, cy: 412, R: 96 }, 35, 4000, ghost, {}), true);
  assert.equal(T.ghostBlocked({ cx: 842, cy: 412, R: 96 }, 70, 4000, ghost, {}), false, 'a width jump is a new triangle');
  assert.equal(T.ghostBlocked({ cx: 842, cy: 412, R: 96 }, 35, 6000, ghost, {}), false, 'the cooldown expires');
  assert.equal(T.ghostBlocked({ cx: 900, cy: 411, R: 96 }, 35, 4000, ghost, {}), false, 'only the same circle is blocked');
  assert.equal(T.ghostBlocked(null, 35, 4000, ghost, {}), false);
  assert.match(SRC, /ghostBlocked\(g, g\.width, tNow, F\.ghostGeo, F\.opts\)/);
  assert.match(SRC, /ghostBlocked\(locked, locked\.width, tNow, F\.ghostGeo, F\.opts\)/);
  assert.match(SRC, /ghostBlocked\(geo, geo\.width, t, F\.ghostGeo, F\.opts\)/);
});

test('fast first press is an opt-in bypass of the first-press gate', () => {
  // The default is unchanged: a narrow or fast dial still gets the stable-fit hold.
  assert.equal(T.firstPressGate(45, 700, {}), true, 'a narrow, fast dial is gated');
  assert.equal(T.firstPressGate(100, 320, {}), true, 'a wide, fast dial is gated');
  assert.equal(T.firstPressGate(45, 120, {}), true, 'a narrow, slow dial is gated');
  assert.equal(T.firstPressGate(90, 120, {}), false, 'a wide, slow dial is not gated');
  assert.equal(T.firstPressGate(60, 299, {}), false, 'the boundary is width < 60 or omega >= 300');
  assert.equal(T.firstPressGate(59.9, 299, {}), true);
  assert.equal(T.firstPressGate(90, 300, {}), true);
  // Opting in bypasses the gate without changing the crossing planner.
  assert.equal(T.firstPressGate(45, 700, { fastFirstPress: true }), false);
  assert.equal(T.firstPressGate(45, null, { fastFirstPress: true }), false);
  assert.equal(T.firstPressGate(null, 700, { fastFirstPress: true }), false);
  assert.match(LOOP_SRC, /firstPressGate\(s\.width, s\.omega, F\.opts\)/, 'step() uses the shared gate');
  assert.match(SRC, /fastFirstPress: false/, 'the mode is off by default');
  assert.match(SRC, /if \(patch\.fastFirstPress != null\) F\.opts\.fastFirstPress = !!patch\.fastFirstPress/,
    'tune() can switch the live run without a restart');
  assert.match(SRC, /fastFirstPress: !!opts\.fastFirstPress/, 'calibration reports the opt-in state');
});

test('a stalled ring can be named instead of charged as a miss or a ghost, opt-in only', () => {
  // 2026-11-24 ledger: all 167 narrow first-dial misses and 245 of 282 narrow ghosts came from
  // 3.9.55's stuck result sessions (34 s attempts, 10-13 s rings); 3.9.56/57 had none in 1,277
  // narrow dials. closeDial scored those rings as aiming errors. stallDialMs names them instead.
  const on = { stallDialMs: 9000 };
  const cases = [
    ['off by default: the old miss verdict is unchanged', { presses: 2, heldMs: 13000, sincePress: 12500, width: 55 }, {}, false],
    ['a press the game never settled, on a long-held narrow ring, is a stall', { presses: 2, heldMs: 13000, sincePress: 12500, width: 55 }, on, true],
    ['a fresh press is not a stall, however long the ring has lived', { presses: 2, heldMs: 13000, sincePress: 500, width: 55 }, on, false],
    ['a normal 15.9 s dial with a miss is not a stall before the threshold', { presses: 2, heldMs: 5000, sincePress: 4500, width: 55 }, on, false],
    ['a genuine wide miss keeps its miss verdict', { presses: 2, heldMs: 13000, sincePress: 12500, width: 100 }, on, false],
    ['a long still ring is a stall, not the ~2.7 s fade the ghost rule is for', { presses: 0, heldMs: 10000, ghost: true, width: 45 }, on, true],
    ['a real fade stays a ghost', { presses: 0, heldMs: 2000, ghost: true, width: 45 }, on, false],
    ['an unpressed fish that is not ghost-shaped is untouched', { presses: 0, heldMs: 10000, ghost: false, width: 45 }, on, false],
  ];
  for (const [why, st, opts, want] of cases) assert.equal(T.dialStalled(st, opts), want, why);
  assert.match(LOOP_SRC, /const stalled = dialStalled\(\{ presses, heldMs, sincePress, ghost, width \}, F\.opts\)/,
    'closeDial asks the helper');
  assert.match(LOOP_SRC, /F\.stats\[DIAL_COUNTER\[verdict\]\]\+\+/, 'the verdict names its counter through one map');
  assert.match(LOOP_SRC, /const verdict = stalled \? 'stalled'/, 'the verdict is named before ghost/miss');
  assert.match(LOOP_SRC, /if \(ghost && !stalled && F\.geo\)/, 'a stall must not start the ghost cooldown');
  assert.match(SRC, /stalled: 0/, 'the counter is initialized');
  assert.match(SRC, /stallDialMs: 0/, 'the option is off in the shipped defaults');
});

test('the first-press hold is a fraction of one pass, not a fixed ceiling', () => {
  // A 45 deg arc at 700 deg/s is under the pin for 64 ms. The old 2500 ms ceiling skipped ~4 passes
  // of exactly the fish the player is watching; that is the reported "it did a round turn".
  const fast = T.firstPressBudget(45, 700, {});
  assert.ok(fast > 20 && fast < 30, 'budget ' + fast);
  assert.ok(T.firstPressBudget(60, 1100, {}) < 25);
  const slow = T.firstPressBudget(165, 120, {});
  assert.ok(slow > 400 && slow < 600, 'the slow dial keeps a long, useful fit: ' + slow);
  assert.equal(T.firstPressBudget(90, null, {}), 2500, 'no rate: keep the ceiling');
  assert.equal(T.firstPressBudget(90, 0, {}), 2500, 'a static dial cannot be waited on');
  assert.equal(T.firstPressBudget(0, 300, {}), 2500, 'no width: keep the ceiling');
  assert.equal(T.firstPressBudget(90, 10, { firstPressMaxWaitMs: 800 }), 800, 'the ceiling still caps');
  assert.equal(T.firstPressBudget(45, -700, {}), fast, 'spin direction does not matter');
  // the step() gate has to use the budget, not the raw ceiling
  assert.match(LOOP_SRC, /firstPressBudget\(Number\(s\.width\)/);
  assert.match(TIMING_SRC, /firstPressMaxTransitFrac/);
});

test('the first-press hold is skipped when its budget cannot fit the fit it waits for', () => {
  // Live 2026-11-18: firstPressHeld and firstPressForced were both 37 - every dial the gate held
  // was forced anyway, so a short budget only delayed the press on the same two-point fit.
  assert.equal(T.firstPressCanMature(150, {}), true, 'exactly the 150 ms fit is enough');
  assert.equal(T.firstPressCanMature(149, {}), false, 'one ms short cannot mature');
  assert.equal(T.firstPressCanMature(0, {}), false);
  assert.equal(T.firstPressCanMature(NaN, {}), false);
  assert.equal(T.firstPressCanMature(120, { firstPressMinSpanMs: 100 }), true,
    'the fit span is configurable');
  // A 45 deg dial at 700 deg/s budgets ~26 ms, far below the fit: press on the open frame instead.
  assert.equal(T.firstPressCanMature(T.firstPressBudget(45, 700, {}), {}), false);
  // A 165 deg dial at 120 deg/s keeps its long, useful fit.
  assert.equal(T.firstPressCanMature(T.firstPressBudget(165, 120, {}), {}), true);
  assert.match(LOOP_SRC, /firstPressCanMature\(budget, F\.opts\)/, 'the gate consults the budget test');
});

test('a narrow dial with no spin estimate releases the first press promptly', () => {
  const narrow = T.firstPressBudget(35, null, {});
  assert.ok(narrow > 30 && narrow < 60,
    'a 35 deg dial with no rate must release in one pass, not 2.5 s: ' + narrow);
  assert.equal(T.firstPressBudget(35, 0, {}), narrow, 'a static estimate is still no estimate');
  assert.equal(T.firstPressBudget(35, null, { firstPressMaxWidthDeg: 30 }), 2500,
    'only a narrow dial gets the assumed rate');
});

test('the recovery scan backs off instead of running every second', () => {
  // One whole-surface pass is a ~257k-test annulus sweep (250-300 ms measured); at a fixed 900 ms
  // cadence that was a stall every second while the character waited for a bite.
  assert.equal(T.dialFallbackWait(0, {}), 900);
  assert.equal(T.dialFallbackWait(1, {}), 1800);
  assert.equal(T.dialFallbackWait(2, {}), 3600);
  assert.equal(T.dialFallbackWait(3, {}), 6000, 'capped');
  assert.equal(T.dialFallbackWait(9, {}), 6000, 'never unbounded');
  assert.equal(T.dialFallbackWait(null, {}), 900, 'a fresh run starts prompt');
  assert.equal(T.dialFallbackWait(-1, {}), 900);
  assert.equal(T.dialFallbackWait(4, { dialFallbackMaxMs: 1200 }), 1200);
  // the scan must use the backoff, and a cast must reset it
  assert.match(SRC, /dialFallbackWait\(F\.dialAnyFail, F\.opts\)/);
  assert.match(LOOP_SRC, /F\.dialAnyFail = 0; F\.dialAnyAt = 0/);
});

test('the first press on a narrow or fast dial waits for a mature fit, only when the budget can pay', () => {
  assert.match(LOOP_SRC, /fitStable\(s\.fit, F\.opts\)/);
  assert.match(LOOP_SRC, /F\.pressesThisDial === 0/);
  assert.match(LOOP_SRC, /firstPressGate\(s\.width, s\.omega, F\.opts\)/);
  assert.match(TIMING_SRC, /Number\(width\) < \(cfg\.firstPressMaxWidthDeg \|\| 60\)/);
  assert.match(TIMING_SRC, /Math\.abs\(Number\(omega\) \|\| 0\) >= \(cfg\.firstPressFastOmega \|\| 300\)/);
  assert.match(LOOP_SRC, /firstPressCanMature\(budget, F\.opts\)/, 'a budget too short for the fit is skipped');
  assert.match(LOOP_SRC, /if \(heldMs < budget\)/, 'the hold must not starve a dial');
  assert.match(LOOP_SRC, /F\.stats\.firstPressHeld/);
  assert.match(LOOP_SRC, /markFirstPressForced\(F\.stats, F\.geo\)/);
  assert.match(LOOP_SRC, /L\('first press held'/);
  assert.match(LOOP_SRC, /L\('first press forced'/);
});

test('a held first press that later forces is counted once per dial', () => {
  const held = { _firstHeld: true };
  const stats = { firstPressForced: 0, firstPressHeldForced: 0 };
  assert.equal(T.markFirstPressForced(stats, held), true);
  assert.equal(stats.firstPressForced, 1);
  assert.equal(stats.firstPressHeldForced, 1);
  assert.equal(T.markFirstPressForced(stats, held), false, 'one force event per dial');
  assert.equal(stats.firstPressForced, 1);
  assert.equal(stats.firstPressHeldForced, 1);

  const unheld = {};
  const unheldStats = { firstPressForced: 0, firstPressHeldForced: 0 };
  assert.equal(T.markFirstPressForced(unheldStats, unheld), true);
  assert.equal(unheldStats.firstPressForced, 1);
  assert.equal(unheldStats.firstPressHeldForced, 0);

  assert.match(LOOP_SRC, /markFirstPressForced\(F\.stats, F\.geo\)/);
  assert.match(SRC, /firstPressHeldForced: 0/);
  assert.match(SRC, /firstPressHeldForced: s\.firstPressHeldForced \|\| 0/);
});

test('cast-prompt loss diagnostics are read-only and explicit', () => {
  const b = { cx: 104, cy: 250, w: 90, h: 40, via: 'box', glyph: true };
  const prev = { x: 100, y: 245, at: 1000, n: 1, blockedUntil: 0 };
  assert.deepEqual(T.lossDiagnostics(b, 1100, prev, true), {
    promptChannel: 'box', glyph: true, confirmed: true,
    x: 104, y: 250, w: 90, h: 40, catchCardPending: true,
  });
  assert.equal(T.lossDiagnostics(Object.assign({}, b, { via: 'anywhere' }), 1100, prev, false).confirmed, false);
  assert.equal(T.lossDiagnostics(Object.assign({}, b, { glyph: false }), 1100, prev, false).confirmed, false);
  assert.equal(T.lossDiagnostics(b, 1100, null, false).confirmed, false);
  assert.equal(T.lossDiagnostics(b, 4001, prev, false).confirmed, false, 'stale sighting');
  assert.equal(T.lossDiagnostics(b, 1100, Object.assign({}, prev, { blockedUntil: 1200 }), false).confirmed, false);
  assert.equal(T.lossDiagnostics(null, 1100, prev, true).promptChannel, null);
  assert.match(LOOP_SRC, /const diag = refreshLossDiagnostic\(F\.attempt, b, t, F\.bubblePrev, awaitingCard\)/);
  const branch = LOOP_SRC.slice(LOOP_SRC.indexOf('// 1. a bubble'), LOOP_SRC.indexOf('// 1. a bubble') + 1800);
  assert.ok(branch.indexOf('refreshLossDiagnostic') < branch.indexOf('if (!F.attempt.pendingLoss)'),
    'the diagnostic must refresh before the pending-only decision guard');
  assert.match(SRC, /lossDiag: a\.lossDiag \|\| null/);
  assert.match(LOOP_SRC, /L\('attempt loss pending', Object\.assign\(\{ n: F\.attempt\.n \}, diag\)\)/);
});

test('a pending loss refreshes lossDiag on a later prompt sighting', () => {
  const attempt = { pendingLoss: 1000, lossDiag: null };
  const firstBubble = { cx: 104, cy: 250, w: 90, h: 40, via: 'box', glyph: true };
  const first = refreshLossDiagnostic(attempt, firstBubble, 1100, null, false);
  assert.equal(first.confirmed, false);
  assert.equal(first.catchCardPending, false);
  assert.equal(attempt.lossDiag, first);
  assert.equal(attempt.pendingLoss, 1000);

  const prev = { x: 104, y: 250, at: 1100, n: 1, blockedUntil: 0 };
  const later = refreshLossDiagnostic(attempt, firstBubble, 1300, prev, true);
  assert.equal(later.confirmed, true);
  assert.equal(later.catchCardPending, true);
  assert.notEqual(later, first, 'a later sighting must produce a fresh diagnostic');
  assert.equal(attempt.lossDiag, later, 'the later diagnostic must replace the first one');
  assert.equal(attempt.pendingLoss, 1000, 'refreshing must not resolve or clear the pending loss');
});

test('planPress presses only inside the window, and schedules the crossing', () => {
  const base = { t: 1000, width: 90, armed: true };
  const opt = { trigger: 'angle', midDeg: 6, leadMs: 25, horizonMs: 40 };
  // 300 deg/s, midpoint 9.6 deg short of the pin: the crossing is 32 ms out, press 7 ms out.
  const sched = T.planPress(Object.assign({}, base, { delta: -9.6, omega: 300 }), opt);
  assert.equal(sched.reason, 'schedule');
  assert.equal(sched.press, false);
  assert.ok(Math.abs(sched.at - (1000 + std(-9.6, 300, 25))) < 0.01, 'at ' + sched.at);
  assert.ok(Math.abs(sched.at - 1007) < 0.01, 'at ' + sched.at);
  // Already inside the lead time and still inside the window: press now.
  const now = T.planPress(Object.assign({}, base, { delta: -6, omega: 300 }), opt);
  assert.equal(now.press, true);
  assert.equal(now.reason, 'now-inside');
  // Crossing is far away: no timer, no press.
  const wait = T.planPress(Object.assign({}, base, { delta: -60, omega: 300 }), opt);
  assert.equal(wait.press, false);
  assert.equal(wait.armAt, null);
  // Disarmed: nothing happens at all.
  const off = T.planPress(Object.assign({}, base, { delta: -6, omega: 300, armed: false }), opt);
  assert.equal(off.press, false);
  assert.equal(off.armAt, null);
});

test('contain takes an open window whichever side the arc is passing on', () => {
  // Live 2026-11-02: a 30 deg dial produced 279 consecutive 'wait' frames and no press, because the
  // open-window branch also demanded delta * omega > 0. Inside is inside.
  const contain = { trigger: 'contain', midDeg: 6, marginDeg: 4, leadMs: 25 };
  const toward = T.planPress({ t: 1000, width: 30, armed: true, delta: 5, omega: -30 }, contain);
  assert.equal(toward.reason, 'inside-now');
  assert.equal(toward.press, true);
  const away = T.planPress({ t: 1000, width: 30, armed: true, delta: 5, omega: 30 }, contain);
  assert.equal(away.reason, 'inside-now');
  // ... but never from outside the window.
  const outside = T.planPress({ t: 1000, width: 30, armed: true, delta: 20, omega: -30 }, contain);
  assert.notEqual(outside.reason, 'inside-now');
  assert.equal(outside.press, false);
});

function std(delta, omega, leadMs) {
  const period = 360 / Math.abs(omega / 1000);
  let toJudge = -delta / (omega / 1000);
  toJudge = ((toJudge % period) + period) % period;
  return toJudge - leadMs;
}

test('planPress keeps an armed timer that is still on plan, and re-aims a drifted one', () => {
  const opt = { trigger: 'angle', midDeg: 6, leadMs: 25, horizonMs: 40, replanMs: 8 };
  const at = 1000 + std(-9.6, 300, 25);
  const keep = T.planPress({ t: 1000, width: 90, armed: true, delta: -9.6, omega: 300, pendingAt: at + 2 }, opt);
  assert.equal(keep.cancel, false);
  assert.equal(keep.armAt, null);
  const again = T.planPress({ t: 1000, width: 90, armed: true, delta: -9.6, omega: 300, pendingAt: at + 20 }, opt);
  assert.equal(again.cancel, true);
  assert.ok(again.armAt != null);
});

test('containment accepts a late press the angle rule would drop', () => {
  // 746 deg/s: 18.7 deg of travel in the 25 ms lead. The drawn arc is 90 deg wide.
  const st = { t: 1000, width: 90, armed: true, delta: -2, omega: 746 };
  const angle = T.planPress(st, { trigger: 'angle', midDeg: 6, leadMs: 25 });
  const contain = T.planPress(st, { trigger: 'contain', marginDeg: 4, leadMs: 25 });
  assert.equal(angle.press, false, 'midpoint rule sees 16.7 deg of overshoot');
  assert.equal(contain.press, true, 'containment still sees the arc under the pin');
  // Outside the arc, containment must refuse just as hard.
  const out = T.planPress({ t: 1000, width: 90, armed: true, delta: -30, omega: 746 },
    { trigger: 'contain', marginDeg: 4, leadMs: 25 });
  assert.equal(out.press, false);
});

test('contain takes an open window after the midpoint instead of waiting a turn', () => {
  // 300 deg/s, 90 deg arc (win 41 after the 4 deg margin): the pin is 30 deg past the midpoint,
  // still inside, and the next midpoint crossing is ~1.1 s away.
  const contain = { trigger: 'contain', marginDeg: 4, leadMs: 25 };
  const past = T.planPress({ t: 1000, width: 90, armed: true, delta: 30, omega: 300 }, contain);
  assert.equal(past.press, true);
  assert.equal(past.reason, 'inside-now');
  assert.equal(past.cancel, true, 'an early press must drop a pending midpoint timer');
  // Approaching the midpoint: also an open window, so it is taken. The old rule waited for the
  // crossing on one sign only, which on a narrow dial meant waiting a whole rotation and pressing
  // nothing (live 2026-11-02: 279 'wait' frames on a 30 deg dial).
  const coming = T.planPress({ t: 1000, width: 90, armed: true, delta: -30, omega: 300 }, contain);
  assert.equal(coming.press, true);
  assert.equal(coming.reason, 'inside-now');
  // Past the midpoint but outside the window: nothing to take.
  const outside = T.planPress({ t: 1000, width: 90, armed: true, delta: 60, omega: 300 }, contain);
  assert.equal(outside.press, false);
  // Inside now but the lead carries the pin out of the window: wait for the next crossing.
  const edge = T.planPress({ t: 1000, width: 90, armed: true, delta: 38, omega: 300 }, contain);
  assert.equal(edge.press, false);
  assert.notEqual(edge.reason, 'inside-now');
  // 'angle' never takes an early edge; it keeps the midpoint rule.
  const angle = T.planPress({ t: 1000, width: 90, armed: true, delta: 30, omega: 300 },
    { trigger: 'angle', midDeg: 6, leadMs: 25 });
  assert.equal(angle.press, false);
  // Disarmed stays disarmed even when the window is open.
  const off = T.planPress({ t: 1000, width: 90, armed: false, delta: 30, omega: 300 }, contain);
  assert.equal(off.press, false);
  assert.equal(off.reason, 'disarmed');
});

test('planPress follows the spin direction and never fires backwards', () => {
  const opt = { trigger: 'angle', midDeg: 6, leadMs: 25, horizonMs: 40 };
  // Spinning the other way, 30 deg past the pin: the next crossing is nearly a whole turn out.
  const far = T.planPress({ t: 1000, width: 90, armed: true, delta: 30, omega: -300 }, opt);
  assert.equal(far.press, false);
  assert.equal(far.armAt, null);
  // Approaching from the other side, inside the lead: press.
  const near = T.planPress({ t: 1000, width: 90, armed: true, delta: 5, omega: -300 }, opt);
  assert.equal(near.press, true);
});

test('planPress falls back to the angle rule when a static dial is all we have', () => {
  const st = { t: 1000, width: 90, armed: true, delta: 3, omega: null };
  assert.equal(T.planPress(st, { trigger: 'contain', leadMs: 25 }).press, true);
  // 60 deg is outside a 90 deg arc (half-width 45) even with containment.
  assert.equal(T.planPress({ t: 1000, width: 90, armed: true, delta: 60, omega: 0 }, { trigger: 'contain' }).press, false);
});

test('sweepBias cycles the probe offsets in order', () => {
  assert.equal(T.sweepBias(null, 0), 0);
  const cfg = { min: -30, max: 30, step: 15 };
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => T.sweepBias(cfg, i)), [-30, -15, 0, 15, 30, -30]);
  assert.deepEqual([0, 1].map((i) => T.sweepBias({ biases: [10, -10] }, i)), [10, -10]);
});


test('cardShapeOk accepts a measured catch card and rejects the reel panel', () => {
  // Measured live: real cards 296-336 wide, ink 0.12-0.23. The 204x272 reel panel: ink 0.47-0.59.
  assert.deepEqual(T.cardShapeOk({ w: 300, h: 440, ink: 0.18 }), { card: true, why: 'ok' });
  assert.deepEqual(T.cardShapeOk({ w: 336, h: 436, ink: 0.12 }), { card: true, why: 'ok' });
  assert.equal(T.cardShapeOk({ w: 204, h: 272, ink: 0.5 }).card, false);
  assert.equal(T.cardShapeOk({ w: 204, h: 272, ink: 0.5 }).why, 'narrow');
});

test('cardShapeOk separates on ink once the panel is wide enough', () => {
  assert.equal(T.cardShapeOk({ w: 300, h: 440, ink: 0.5 }).card, false);
  assert.equal(T.cardShapeOk({ w: 300, h: 440, ink: 0.5 }).why, 'inky');
  assert.equal(T.cardShapeOk({ w: 300, h: 440, ink: 0.47 }).card, false);
  assert.equal(T.cardShapeOk({ w: 300, h: 440, ink: 0.3 }).card, false);   // strictly under 0.3
  assert.equal(T.cardShapeOk({ w: 300, h: 440, ink: 0.29 }).card, true);
});

test('cardShapeOk thresholds are overridable and a missing match is not a card', () => {
  assert.equal(T.cardShapeOk({ w: 100, h: 400, ink: 0.1 }, { minW: 90 }).card, true);
  assert.equal(T.cardShapeOk({ w: 300, h: 400, ink: 0.4 }, { maxInk: 0.5 }).card, true);
  assert.equal(T.cardShapeOk(null).card, false);
  assert.equal(T.cardShapeOk(null).why, 'none');
  assert.equal(T.cardShapeOk(undefined).card, false);
});

test('omegaBand splits presses into the four speed bands', () => {
  assert.equal(T.omegaBand(0), 'slow');
  assert.equal(T.omegaBand(120), 'slow');
  assert.equal(T.omegaBand(149.9), 'slow');
  assert.equal(T.omegaBand(150), 'mid');
  assert.equal(T.omegaBand(-260), 'mid');
  assert.equal(T.omegaBand(300), 'fast');
  assert.equal(T.omegaBand(746), 'blur');
  assert.equal(T.omegaBand(null), 'slow');
  assert.equal(T.omegaBand(undefined), 'slow');
});

test('widthBand separates the narrow dials rare fish paint from the wide ones', () => {
  assert.equal(T.widthBand(30), 'narrow');
  assert.equal(T.widthBand(59.9), 'narrow');
  assert.equal(T.widthBand(60), 'mid');
  assert.equal(T.widthBand(99.9), 'mid');
  assert.equal(T.widthBand(100), 'wide');
  assert.equal(T.widthBand(139.9), 'wide');
  assert.equal(T.widthBand(140), 'full');
  assert.equal(T.widthBand(200), 'full');
  assert.equal(T.widthBand(null), 'unknown');
  assert.equal(T.widthBand(undefined), 'unknown');
  assert.equal(T.widthBand(0), 'unknown');
});

test('an attempt records dial width and the reports expose width and rarity', () => {
  // The rare-fish complaint needs a number, not a hunch: attempts are scored per width band, and
  // caught fish are also grouped by rarity. Both feed the panel's accuracy line.
  assert.match(SRC, /a\.avgWidth = a\.widthN \?/, 'resolveAttempt computes the average dial width');
  assert.match(SRC, /F\.widths\[a\.widthBand\]/, 'attempts land in a width bucket');
  assert.match(SRC, /F\.rarities\[a\.rarity\]/, 'caught fish land in a rarity bucket');
  assert.match(SRC, /F\.widthReport = function/, 'the width report exists');
  assert.match(SRC, /F\.rarityReport = function/, 'the rarity report exists');
  assert.match(SRC, /F\.calibration = function/, 'the calibration surface exists');
  assert.match(SRC, /F\.tune = function/, 'the timing knobs are adjustable from the console');
  assert.match(SRC, /byWidth: F\.widthReport\(\), byRarity: F\.rarityReport\(\)/, 'accuracy carries both reports');
});

test('newTriangle: the first press of a lock is always allowed', () => {
  assert.equal(T.newTriangle(null, { delta: 3, width: 120, t: 2000, omega: 300 }, 0, {}), true);
});

test('newTriangle: the same triangle still under the pin is not a new spawn', () => {
  // 300 deg/s: 250 ms later the wedge moved 75 deg, exactly what the fit predicts.
  const press = { delta: 0, width: 120, t: 1000 };
  const s = { delta: 75, width: 121, t: 1250, omega: 300 };
  assert.equal(T.newTriangle(press, s, 1, {}), false, 'a second press here would subtract the last gain');
});

test('newTriangle: a thickness jump means the game spawned a new triangle', () => {
  const press = { delta: 0, width: 120, t: 1000 };
  const s = { delta: 75, width: 126, t: 1250, omega: 300 };
  assert.equal(T.newTriangle(press, s, 0, {}), true);
});

test('newTriangle: a delta jump beyond the predicted rotation is a new spawn', () => {
  const press = { delta: 0, width: 120, t: 1000 };
  const s = { delta: -120, width: 120, t: 1250, omega: 300 };   // predicted +75, seen -120
  assert.equal(T.newTriangle(press, s, 0, {}), true);
});

test('newTriangle: the ring blinking out twice is a new spawn', () => {
  const press = { delta: 0, width: 120, t: 1000 };
  const s = { delta: 10, width: 120, t: 1100, omega: 300 };
  assert.equal(T.newTriangle(press, s, 2, {}), true);
});

test('a proven new triangle under the pin re-arms and presses now; an unchanged one does not', () => {
  // The frame loop used to demand the wedge leave the window before re-arming, so a new triangle
  // that spawned with the pin already inside waited a full leave-and-return (live 2026-11-18:
  // 61% of non-final slow dials got one press). The decision is spawnProven alone; planPress then
  // takes the open window on the next frame.
  assert.equal(T.rearmReady(false, 1, 12), false, 'an unchanged triangle must not re-arm');
  assert.equal(T.rearmReady(true, 1, 12), true, 'a proven spawn re-arms');
  assert.equal(T.rearmReady(true, 11, 12), true);
  assert.equal(T.rearmReady(true, 12, 12), false, 'the per-dial cap still stops a runaway');
  assert.equal(T.rearmReady(true, 0, 0), true, 'a missing cap falls back to 12');

  const opts = { trigger: 'contain', insideNowMs: 60, leadMs: 25, midDeg: 6, marginDeg: 4, horizonMs: 40, replanMs: 8 };
  const press = { delta: 40, width: 120, t: 992 };
  const same = { delta: 37.6, width: 120, t: 1000, omega: -300 };   // exactly the predicted rotation
  const proven = T.newTriangle(press, same, 0, {});
  assert.equal(proven, false);
  const held = T.planPress({ t: 1000, width: 120, delta: 40, omega: -300, armed: T.rearmReady(proven, 1, 12) }, opts);
  assert.equal(held.reason, 'disarmed', 'no spawn, no press');
  assert.equal(held.press, false);

  const spawned = { delta: 37.6, width: 126, t: 1000, omega: -300 };   // a thickness jump proves it
  assert.equal(T.newTriangle(press, spawned, 0, {}), true);
  assert.equal(Math.abs(40) > 59 + 12, false, 'the pin is already inside the new window');
  const planned = T.planPress({ t: 1000, width: 126, delta: 40, omega: -300, armed: T.rearmReady(true, 1, 12) }, opts);
  assert.equal(planned.reason, 'inside-now');
  assert.equal(planned.press, true, 'pressed on the next plan, with no rotation wait');
});

test('newTriangle: continuous rotation with no jump stays one triangle', () => {
  const press = { delta: 10, width: 90, t: 1000 };
  let s = { delta: 10, width: 90, t: 1000, omega: 420 };
  for (let i = 1; i <= 6; i++) {
    const t = 1000 + i * 16.7;
    s = { delta: T.wrap180(10 + 420 * (t - 1000) / 1000), width: 90, t, omega: 420 };
    assert.equal(T.newTriangle(press, s, 0, {}), false, 'frame ' + i);
  }
});


test('castRecovery walks up a bounded ladder: tap, then the keybind as well', () => {
  // Rung 1 is the normal path: click the bubble and nothing else.
  assert.deepEqual(T.castRecovery(1), { tap: true, space: false, walk: false });
  // A click that changed nothing buys the game's own keybind as well.
  assert.deepEqual(T.castRecovery(2), { tap: true, space: true, walk: false });
  // The click is NEVER dropped: a prompt is a button. Dropping it turned the ladder into a
  // one-way door (measured live 2026-10-29: 140 cast retries, rungs 14-36, every one tap:false,
  // while a REEL! prompt sat on screen for twenty minutes).
  assert.deepEqual(T.castRecovery(3), { tap: true, space: true, walk: false });
  assert.deepEqual(T.castRecovery(9), { tap: true, space: true, walk: false });
});

test('perfRates reports calls/second, ms/call, ms/s and share of wall time', () => {
  const r = T.perfRates({ sample: 600, findCatch: 0 }, { sample: 1200, findCatch: 0 }, 10_000);
  assert.equal(r.sample.callsPerSec, 60);
  assert.equal(r.sample.msPerCall, 2);
  assert.equal(r.sample.msPerSec, 120);
  assert.equal(r.sample.share, 0.12);
  assert.equal(r.findCatch.msPerCall, null);
  assert.equal(r.findCatch.msPerSec, 0);
  assert.deepEqual(T.perfRates({}, {}, 0), {}, 'nothing measured is an empty report, not NaN');
  // no uptime yet: rates are unknown, but a per-call average is still knowable
  const cold = T.perfRates({ sample: 10 }, { sample: 5 }, 0);
  assert.equal(cold.sample.callsPerSec, null);
  assert.equal(cold.sample.msPerSec, null);
  assert.equal(cold.sample.msPerCall, 0.5);
});

test('castRecovery never walks - a walk would stand the character out of the fishing seat', () => {
  // Seat-based fishing: the cast prompt only exists while seated, so walking cannot recover a cast
  // and can strand the character somewhere unfishable (measured live 2026-10-28).
  for (let n = 0; n < 40; n++) assert.equal(T.castRecovery(n).walk, false, 'rung ' + n);
  // Bounded: the last rung repeats, and it still taps.
  assert.deepEqual(T.castRecovery(5), { tap: true, space: true, walk: false });
  assert.deepEqual(T.castRecovery(39), { tap: true, space: true, walk: false });
  // Junk input must not crash.
  assert.deepEqual(T.castRecovery(0), { tap: true, space: false, walk: false });
  assert.deepEqual(T.castRecovery(null), { tap: true, space: false, walk: false });
  assert.equal(T.castRecovery(2.7).tap, true);
});

// A press is not a win. The game either spawns a fresh triangle (accepted) or keeps the same one
// (rejected), and only the finishing press ever closes the dial - so the dial's "ended soon after"
// verdict cannot score timing. These are the press's own verdicts.

test('a press is accepted when the game spawns a new triangle', () => {
  const press = { delta: 0, width: 85, t: 1000 };
  // a thickness jump is the new triangle
  assert.deepEqual(T.pressOutcome({ press, s: { t: 1016, delta: 5, width: 92, omega: 300 }, blinks: 0 }), { verdict: 'accepted' });
  // the ring blinking out twice is a new spawn too
  assert.deepEqual(T.pressOutcome({ press, s: { t: 1016, delta: 5, width: 85, omega: 300 }, blinks: 2 }), { verdict: 'accepted' });
  // and a delta jump the rotation cannot explain
  assert.deepEqual(T.pressOutcome({ press, s: { t: 1016, delta: 40, width: 85, omega: 300 }, blinks: 0 }), { verdict: 'accepted' });
});

test('a press is rejected when the same triangle survives the grace', () => {
  const press = { delta: 0, width: 85, t: 1000 };
  const same = (t) => ({ t, delta: 300 * (t - 1000) / 1000, width: 85, omega: 300 });
  assert.deepEqual(T.pressOutcome({ press, s: same(1100), blinks: 0, graceMs: 250 }), { verdict: 'pending' });
  assert.deepEqual(T.pressOutcome({ press, s: same(1260), blinks: 0, graceMs: 250 }), { verdict: 'rejected' });
});

test('pressOutcome has no verdict without a press or a sample', () => {
  assert.deepEqual(T.pressOutcome({}), { verdict: 'none' });
  assert.deepEqual(T.pressOutcome({ press: { t: 1, width: 85, delta: 0 } }), { verdict: 'pending' });
});

test('per-attempt wedge telemetry: accepted presses and dial outcomes are per fish and per band', () => {
  // The rare-fish question is "how many presses landed inside the wedge", not "how many dials
  // closed". An accepted press is the game spawning a fresh triangle; a rejected one is not.
  const need = [
    'F.attempt.pressAccepted = (F.attempt.pressAccepted || 0) + 1',
    'F.attempt.pressRejected = (F.attempt.pressRejected || 0) + 1',
    'pressAccepted: 0, pressRejected: 0, dialHits: 0, dialMisses: 0',
    'a.pressHitRate = a.pressAccepted + a.pressRejected',
    'wb.accepted += a.pressAccepted; wb.rejected += a.pressRejected;',
    'pressHitRate: accepted + rejected ?',
    'dialHitRate: dialHits + dialMisses ?',
    'recent: (F.attempts || []).slice(-10)',
    'dialMisses: a.dialMisses || 0',
  ];
  const combined = SRC + '\n' + LOOP_SRC;
  for (const snip of need) assert.ok(combined.includes(snip), 'missing telemetry: ' + snip);
});

test('widthReport computes the per-band wedge rate from the counters', () => {
  const a = SRC.indexOf('  F.widthReport = function () {');
  const b = SRC.indexOf('  /**', a);
  assert.ok(a > 0 && b > a, 'widthReport block not found');
  const F = { widths: { narrow: { band: 'narrow', attempts: 5, caught: 4, lost: 1, presses: 29, accepted: 27, rejected: 2, dialHits: 3, dialMisses: 2 } } };
  new Function('F', SRC.slice(a, b))(F);
  const row = F.widthReport()[0];
  assert.equal(row.pressHitRate, 0.931, '27 of 29 presses landed inside the wedge');
  assert.equal(row.dialHitRate, 0.6, '3 of 5 dials ended on a hit');
  assert.equal(row.pressesPerAttempt, 5.8);
  assert.equal(row.catchRate, 0.8);
});

test('doPress resets triangle tracking so >90 deg spawns stay locked and re-arm before planPress', () => {
  const pressStart = LOOP_SRC.indexOf('function doPress(');
  const pressEnd = LOOP_SRC.indexOf('function armPress(', pressStart);
  assert.ok(pressStart > 0 && pressEnd > pressStart);
  const dp = LOOP_SRC.slice(pressStart, pressEnd);
  assert.match(dp, /F\.geo\._mid = null/, 'doPress must clear _mid so >90 deg spawns are not rejected as tracking jumps');

  const loopStart = LOOP_SRC.indexOf('// 2. a locked dial: play it');
  const loopEnd = LOOP_SRC.indexOf('// 3. nothing on screen:', loopStart);
  assert.ok(loopStart > 0 && loopEnd > loopStart);
  const loop = LOOP_SRC.slice(loopStart, loopEnd);
  const rearmIdx = loop.indexOf('const spawnProven = newTriangle(');
  const planIdx = loop.indexOf('const plan = planPress(');
  assert.ok(rearmIdx > 0 && planIdx > 0 && rearmIdx < planIdx, 're-arm must run before planPress so a new spawn fires on the same frame');
});

test('maxPressPerDial defaults above 12 so high-tier fish do not stall on press 13', () => {
  const m = SRC.match(/maxPressPerDial:\s*(\d+)/);
  assert.ok(m, 'maxPressPerDial default is missing');
  assert.ok(Number(m[1]) >= 25, 'maxPressPerDial must allow >12 presses on a dial, got ' + m[1]);
  assert.match(LOOP_SRC, /F\.dialRejected/, 'consecutive rejected presses must still guard against a broken dial');
});

test('isCardSettled rejects white-flash and transparent frames and padCardBox adds headroom within canvas bounds', () => {
  const w = 10, h = 10, n = w * h;
  // Pure white pop-in flash (opaque RGBA 255,255,255,255)
  const whiteFlash = new Uint8Array(n * 4);
  whiteFlash.fill(255);
  assert.equal(T.isCardSettled({ w, h, d: whiteFlash }), false, 'white flash must not count as settled');

  // Empty transparent buffer
  const blank = new Uint8Array(n * 4);
  assert.equal(T.isCardSettled({ w, h, d: blank }), false, 'transparent buffer must not count as settled');

  // Settled catch card: cream parchment (249,238,208) + dark border/text pixels
  const settled = new Uint8Array(n * 4);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dark = p < 15; // 15% dark art/typography ink
    settled[i] = dark ? 40 : 249;
    settled[i + 1] = dark ? 35 : 238;
    settled[i + 2] = dark ? 30 : 208;
    settled[i + 3] = 255;
  }
  const metrics = T.cardInkMetrics({ w, h, d: settled });
  assert.ok(metrics && metrics.opaqueFrac === 1 && metrics.dark >= 0.1);
  assert.equal(T.isCardSettled(metrics), true, 'cream parchment + ink card is settled');

  const padded = T.padCardBox({ x: 400, y: 200, w: 300, h: 400 }, 1280, 720);
  assert.deepEqual(padded, { x: 325, y: 72, w: 450, h: 576 }, 'adds left/right 25%, top 32%, bottom 12% headroom');
  const clamped = T.padCardBox({ x: 20, y: 10, w: 300, h: 400 }, 350, 420);
  assert.deepEqual(clamped, { x: 0, y: 0, w: 350, h: 420 }, 'clamps cleanly to canvas boundaries');
});
