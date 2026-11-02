'use strict';
/**
 * The run statistics a long session is quoted from. The fixtures are the repo's own published
 * interval (103 of 112 -> 85.4-95.7%), so the arithmetic that writes a headline is checked against
 * the headline that already exists instead of being trusted.
 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const OPEN = '// <stats-core>';
const CLOSE = '// </stats-core>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('stats-core sentinels are missing from autofish.js');
const S = new Function(SRC.slice(a + OPEN.length, b) + '\nreturn { wilson, runSummary, pressErrorSummary };')();

const near = (x, y, eps) => Math.abs(x - y) <= (eps == null ? 0.001 : eps);

test('the interval reproduces the one this repo already published', () => {
  // README: 103 caught / 112 attempts, 92.0%, Wilson 95% CI 85.4-95.7%.
  const w = S.wilson(103, 112);
  assert.ok(w, 'the interval must exist for a real sample');
  assert.ok(near(w.p, 0.9196, 0.0002), 'p ' + w.p);
  assert.ok(near(w.lo, 0.8543), 'lo ' + w.lo);
  assert.ok(near(w.hi, 0.9571), 'hi ' + w.hi);
});

test('degenerate samples give honest bounds instead of NaN', () => {
  assert.equal(S.wilson(0, 0), null, 'an empty sample has no interval');
  assert.equal(S.wilson(1, 0), null, 'impossible counts are refused');
  const zero = S.wilson(0, 10);
  assert.ok(near(zero.lo, 0), 'nothing caught starts at zero: ' + zero.lo);
  assert.ok(zero.hi > 0 && zero.hi < 0.4, 'hi ' + zero.hi);
  const all = S.wilson(10, 10);
  assert.ok(all.lo > 0.6 && all.lo < 0.8, 'lo ' + all.lo);
  assert.ok(near(all.hi, 1));
});

test('a summary counts attempts, not presses', () => {
  const rows = [
    { verdict: 'caught', presses: 10, pressAccepted: 9, pressRejected: 1, dials: 3, avgWidth: 90, widthBand: 'mid', band: 'slow', ms: 30000, startAt: 1000 },
    { verdict: 'lost', presses: 5, pressAccepted: 5, pressRejected: 0, dials: 2, avgWidth: 45, widthBand: 'narrow', band: 'fast', ms: 20000, startAt: 40000 },
    { verdict: 'caught', presses: 4, pressAccepted: 4, pressRejected: 0, dials: 1, avgWidth: 160, widthBand: 'wide', band: 'slow', ms: 25000, startAt: 70000 },
  ];
  const s = S.runSummary(rows);
  assert.equal(s.attempts, 3);
  assert.equal(s.caught, 2);
  assert.equal(s.lost, 1);
  assert.ok(near(s.catchRate, 2 / 3, 1e-9));
  assert.ok(s.catchCi && s.catchCi.lo < s.catchRate && s.catchCi.hi > s.catchRate, 'the rate sits inside its interval');
  assert.equal(s.presses, 19);
  assert.equal(s.accepted, 18);
  assert.equal(s.rejected, 1);
  assert.ok(near(s.pressAcceptRate, 18 / 19, 1e-9));
  assert.equal(s.pressesPerAttempt, 6.33);
  assert.equal(s.pressesPerCatch, 9.5);
  assert.equal(s.meanAttemptMs, 25000);
  assert.equal(s.meanWidth, 98.3);
  assert.equal(s.widths.length, 3);
  assert.equal(s.bands.length, 2);
  assert.equal(s.firstAt, 1000);
  assert.equal(s.lastAt, 70000);
});

test('an empty run is nulls, never NaN - it has to survive JSON', () => {
  const s = S.runSummary([]);
  assert.equal(s.attempts, 0);
  assert.equal(s.catchRate, null);
  assert.equal(s.catchCi, null);
  assert.equal(s.pressAcceptRate, null);
  assert.equal(s.pressesPerAttempt, null);
  assert.equal(s.meanAttemptMs, null);
  assert.ok(JSON.parse(JSON.stringify(s)), 'the summary must serialise');
});

test('the run survives a reload: store, cap and a caught failure', () => {
  assert.match(SRC, /autofish:run:v1/);
  assert.match(SRC, /RUN_CAP = 250/);
  assert.match(SRC, /function saveRunRow/);
  assert.match(SRC, /saveRunRow\(a\);/, 'every resolved attempt is written');
  const fn = SRC.slice(SRC.indexOf('function saveRunRow'), SRC.indexOf('F.exportRun = function'));
  assert.match(fn, /try \{/, 'a storage failure must not take the loop down');
  assert.match(fn, /catch \(e\)/);
  assert.match(SRC, /F\.exportRun = function/);
  assert.match(SRC, /F\.runStoreError/);
});

test('the press probe reports where a press landed, in degrees', () => {
  // The narrow band's remaining loss is press quality, so the export has to say how far outside
  // the window a press landed - not just that the fish got away.
  const log = [
    { inside: true, win: 18.5, res: 3.2, via: 'settled' },
    { inside: true, win: 18.5, res: -6.1, via: 'settled' },
    { inside: false, win: 18.5, res: 21.4, via: 'assumed' },
    { inside: true, win: 22, res: null, via: 'settled' },
  ];
  const s = S.pressErrorSummary(log);
  assert.equal(s.presses, 4);
  assert.equal(s.settled, 3);
  assert.equal(s.assumed, 1);
  assert.equal(s.measured, 3);
  assert.equal(s.insidePredicted, 3);
  assert.equal(s.judged, 4);
  assert.equal(s.insideRate, 0.75);
  assert.equal(s.maxAbsResidual, 21.4);
  assert.ok(s.meanAbsResidual > 9 && s.meanAbsResidual < 11, 'mean ' + s.meanAbsResidual);
  assert.ok(s.meanWindowDeg > 19 && s.meanWindowDeg < 21, 'window ' + s.meanWindowDeg);
  assert.equal(S.pressErrorSummary([]).presses, 0);
  assert.equal(S.pressErrorSummary([]).insideRate, null);
  assert.equal(S.pressErrorSummary([]).meanAbsResidual, null);
});

test('the probe is wired into the press path and the export', () => {
  assert.match(SRC, /function probePressStart/);
  assert.match(SRC, /probePressStart\(s\);/);
  assert.match(SRC, /probePressSample\(s\);/);
  assert.match(SRC, /presses: pressErrorSummary\(F\.pressLog\)/);
  assert.match(SRC, /F\.pressProbe\.via = 'settled'/);
  assert.match(SRC, /atJudge = wrap180\(Number\(s\.delta\) - om \* \(tNow - judgeAt\) \/ 1000\)/);
});

