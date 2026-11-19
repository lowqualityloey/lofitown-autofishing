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
const S = new Function(SRC.slice(a + OPEN.length, b) + '\nreturn { wilson, runSummary, pressAcceptSummary, predictionSummary };')();

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

test('the overnight export carries the held-first-press counters', () => {
  const s = S.runSummary([], {
    firstPressHeld: 17,
    firstPressForced: 25,
    firstPressHeldForced: 6,
  });
  assert.equal(s.firstPressHeld, 17);
  assert.equal(s.firstPressForced, 25);
  assert.equal(s.firstPressHeldForced, 6);

  const older = S.runSummary([]);
  assert.equal(older.firstPressHeld, null, 'an older export is not fabricated as zero');
  assert.equal(older.firstPressForced, null);
  assert.equal(older.firstPressHeldForced, null);

  assert.match(SRC, /firstPressHeld: \(F\.stats && F\.stats\.firstPressHeld\) \|\| 0/);
  assert.match(SRC, /firstPressForced: \(F\.stats && F\.stats\.firstPressForced\) \|\| 0/);
  assert.match(SRC, /firstPressHeldForced: \(F\.stats && F\.stats\.firstPressHeldForced\) \|\| 0/);
});

test('a cast-prompt loss diagnostic survives into the exported run row', () => {
  const start = SRC.indexOf('F.exportRun = function');
  const end = SRC.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start, 'F.exportRun must be present');
  const rs = SRC.indexOf('function runRowOf');
  const re = SRC.indexOf('function loadRunRows');
  assert.ok(rs >= 0 && re > rs, 'runRowOf must be present');
  const runRowOf = new Function(SRC.slice(rs, re) + '\nreturn runRowOf;')();
  const diag = {
    promptChannel: 'box', glyph: true, confirmed: true,
    x: 104, y: 250, w: 90, h: 40, catchCardPending: false,
  };
  const F = {
    version: '3.9.52',
    attempts: [{
      n: 444, verdict: 'lost', why: 'cast prompt', ms: 5522,
      presses: 2, wallAt: 1760000000000, lossDiag: diag,
    }],
    perf: () => ({
      fps: null, p50: null, p95: null, worst: null, longtasks: null,
      snapshot: null, readback: null, rates: null,
    }),
    opts: {}, runStoreError: null, cutReason: null, stats: {},
  };
  const exportRun = new Function(
    'F', 'loadRunRows', 'runRowOf', 'runSummary', 'pressAcceptSummary', 'predictionSummary', 'logProfile',
    SRC.slice(start, end + 5) + '\nreturn F.exportRun;'
  )(F, () => [], runRowOf, () => ({}), () => ({}), () => ({}), 'test');
  const out = JSON.parse(exportRun());
  assert.equal(out.attempts.length, 1);
  assert.deepEqual(out.attempts[0].lossDiag, diag);
});

test('prediction error is reported in degrees and in milliseconds', () => {
  // The number that decides a marginal narrow press. Measured without pressing: a press makes the
  // game spawn a new triangle, and the frame after one jumps for a reason that is not model error.
  const log = [
    { err: 2, om: 300, w: 45 },
    { err: -4, om: 200, w: 45 },
    { err: 10, om: 100, w: 45 },
    { err: 1, om: null, w: 45 },
  ];
  const s = S.predictionSummary(log);
  assert.equal(s.samples, 4);
  assert.equal(s.p95Deg, 10);
  assert.equal(s.maxDeg, 10);
  // 2 deg at 300 deg/s is 6.7 ms; 10 deg at 100 deg/s is 100 ms.
  assert.ok(s.p50Ms > 10 && s.p50Ms < 30, 'p50 ms ' + s.p50Ms);
  assert.equal(s.over50ms, 1);
  assert.equal(s.over50msRate, 0.333);
  assert.equal(S.predictionSummary([]).samples, 0);
  assert.equal(S.predictionSummary([]).p95Ms, null);
});

test('press acceptance separates observed from assumed', () => {
  const log = [
    { inside: true, win: 18.5, via: 'settled' },
    { inside: true, win: 18.5, via: 'settled' },
    { inside: false, win: 22, via: 'assumed' },
    { inside: true, win: 22, via: 'assumed' },
  ];
  const s = S.pressAcceptSummary(log);
  assert.equal(s.presses, 4);
  assert.equal(s.settled, 2);
  assert.equal(s.assumed, 2);
  assert.equal(s.assumedRate, 0.5);
  assert.equal(s.insideRate, 0.75);
  assert.equal(s.meanWindowDeg, 20.3);
  assert.equal(S.pressAcceptSummary([]).assumedRate, null);
});

test('the instruments are wired into the dial path and the export', () => {
  assert.match(SRC, /function probePressStart/);
  assert.match(SRC, /probePressStart\(s\);/);
  assert.match(SRC, /presses: pressAcceptSummary\(F\.pressLog\)/);
  assert.match(SRC, /prediction: predictionSummary\(F\.predLog\)/);
  assert.match(SRC, /F\.pressProbe\.via = 'settled'/);
  // The prediction sample must skip any frame a press landed between.
  assert.match(SRC, /!\(F\.lastPress && F\.lastPress > pp\.t\)/);
  // And the spawn-poisoned measurement must be gone for good.
  assert.doesNotMatch(SRC, /probePressSample/);
  assert.doesNotMatch(SRC, /atJudge/);
});

