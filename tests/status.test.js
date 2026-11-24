'use strict';
/**
 * The numbers the panel and a console export quote. These functions are closure-bound to the core,
 * so they are compiled out of the source with their free variables supplied - the same technique
 * renderhook.test.js uses. The catch counter gets its own test because the display ring is capped
 * at 400 and the session's no-catch clock reads this fact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const CORE = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');

/** One `F.name = function () { ... };` assignment, collected by its matching close. */
function extract(name) {
  const start = CORE.indexOf('  F.' + name + ' = function () {');
  assert.ok(start >= 0, 'F.' + name + ' is missing');
  const end = CORE.indexOf('\n  };', start);
  assert.ok(end > start, 'F.' + name + ' has no close');
  return CORE.slice(start, end + '\n  };'.length);
}

function statsCore() {
  const a = CORE.indexOf('// <stats-core>');
  const b = CORE.indexOf('// </stats-core>');
  assert.ok(a >= 0 && b > a, 'stats-core sentinels are missing');
  return new Function(CORE.slice(a, b) + '\nreturn { pressVerdictReport };')();
}

const { pressVerdictReport } = statsCore();

function mkStatus(F) {
  return new Function('F', 'loadLedger', 'uiFrame', 'now', 'pressVerdictReport',
    extract('status') + '\nreturn F.status;'
  )(F, () => ({ total: 0, species: {} }), () => null, () => 5000, pressVerdictReport);
}

function mkAccuracy(F) {
  return new Function('F', 'now', 'pressVerdictReport',
    extract('accuracy') + '\nreturn F.accuracy;'
  )(F, () => 5000, pressVerdictReport);
}

test('catchCount is a sequence, not the length of the 400-row display ring', () => {
  const F = {
    stats: { catchSeq: 401 },
    catches: new Array(400).fill({ species: 'x' }),
    events: [], widthReport: () => [],
  };
  assert.equal(mkStatus(F)().catchCount, 401, 'the 401st catch must still read as a catch');
});

test('an old stats object with no catchSeq reports nothing rather than the ring', () => {
  const F = {
    stats: {},
    catches: new Array(400).fill({ species: 'x' }),
    events: [], widthReport: () => [],
  };
  assert.equal(mkStatus(F)().catchCount, 0, 'a missing sequence must not impersonate a catch');
});

test('press verdicts are reported by their evidence', () => {
  const v = pressVerdictReport({
    observed: { accepted: 3, rejected: 1 },
    assumed: { accepted: 2, rejected: 0 },
  });
  assert.deepEqual(v.observed, { accepted: 3, rejected: 1, total: 4, rate: 0.75 });
  assert.equal(v.assumed.rate, 1);
  assert.equal(v.timing.total, 0);
  assert.equal(v.timing.rate, null, 'no evidence is a null rate, not a perfect one');
});

test('status exposes the current core run age for the blind warning', () => {
  const F = {
    running: true, startedAt: 4000,
    stats: {}, events: [], widthReport: () => [],
  };
  assert.equal(mkStatus(F)().runAgeMs, 1000, 'a reload restarts this clock with the new core');
});

test('accuracy is a whole-session number even when the attempts ring is capped', () => {
  const F = {
    stats: {
      attempts: 300, caught: 240, lost: 60, presses: 480,
      pressAccepted: 200, pressRejected: 0,
      pressVerdicts: {
        observed: { accepted: 100, rejected: 5 },
        assumed: { accepted: 90, rejected: 0 },
        timing: { accepted: 10, rejected: 0 },
      },
    },
    attempts: new Array(200).fill({ verdict: 'caught' }),
    bandReport: () => [], armReport: () => [], widthReport: () => [], rarityReport: () => [],
  };
  const a = mkAccuracy(F)();
  assert.equal(a.attempts, 300, 'the capped ring must not shrink the denominator');
  assert.equal(a.caught, 240);
  assert.equal(a.lost, 60);
  assert.equal(a.pressesPerCatch, 2, 'session presses over session catches');
  assert.equal(a.pressVerdicts.observed.rate, 0.952);
  assert.equal(a.pressAcceptRateObserved, 0.952);
  assert.equal(a.pressAcceptRate, 1, 'the legacy counter still quotes all verdicts');
});
