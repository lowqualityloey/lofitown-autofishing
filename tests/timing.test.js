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
const OPEN = '// <timing-core>';
const CLOSE = '// </timing-core>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('timing-core sentinels are missing from autofish.js');
const code = SRC.slice(a + OPEN.length, b);
const T = new Function(code + '\nreturn { wrap180, fitOmega, planPress, sweepBias };')();

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
  for (const k of ['wrap180', 'fitOmega', 'planPress', 'sweepBias']) {
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

