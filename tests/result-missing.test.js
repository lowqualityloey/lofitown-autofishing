'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');
const LOOP_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'loop.js'), 'utf8');
const DIAG = fs.readFileSync(path.join(__dirname, '..', 'src', 'diagnostics.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const SESSION = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');
const { resultMissingDue, createResultMissing } = require('../src/diagnostics.js');

function slice(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, from + ' is missing');
  const b = source.indexOf(to, a);
  assert.ok(b > a, to + ' is missing after ' + from);
  return source.slice(a, b);
}

function resultMissingCore(F, log) {
  const ctrl = createResultMissing(F, log);
  return { resultMissingDue, clearResultMissing: ctrl.clear, markResultMissing: ctrl.mark };
}

const resultMissingApi = resultMissingCore({}, function () {});

function resultFixture(over) {
  return Object.assign({
    resultMissing: false,
    geo: null,
    pendingWin: { verdict: 'hit', closedAt: 1000 },
    attempt: { presses: 1, dialHits: 1 },
    opts: { resultMissingMs: 8000 },
  }, over || {});
}

test('the pure detector waits out the full threshold and only fires on a win-like attempt', () => {
  const due = resultMissingApi.resultMissingDue;
  assert.equal(due(resultFixture(), 9000), false, 'exactly 8000 ms is not past the threshold');
  assert.equal(due(resultFixture(), 9001), true, 'past the threshold is a missing result');
  assert.equal(due(resultFixture({ opts: {} }), 9001), true, 'the default threshold is 8000 ms');

  assert.equal(due(resultFixture({ resultMissing: true }), 9001), false, 'the latch is one-shot');
  assert.equal(due(resultFixture({ geo: {} }), 9001), false, 'a live dial means the result is not missing');
  assert.equal(due(resultFixture({ pendingWin: { verdict: 'miss', closedAt: 1000 } }), 9001), false,
    'a missed dial is not a win-like attempt');
  assert.equal(due(resultFixture({ pendingWin: { verdict: 'hit', shapeSeen: true, closedAt: 1000 } }), 9001), false,
    'a card that was seen is not missing');
  assert.equal(due(resultFixture({ pendingWin: { verdict: 'hit', landed: true, closedAt: 1000 } }), 9001), false,
    'a parsed catch is not missing');
  assert.equal(due(resultFixture({ attempt: { presses: 0, dialHits: 0 } }), 9001), false,
    'a stale pending win cannot fire against a fresh attempt');
  assert.equal(due(resultFixture({ pendingWin: { verdict: 'hit', closedAt: null } }), 9001), false);
});

test('a late result clears the latch and its evidence', () => {
  const F = {
    resultMissing: true, resultMissingAt: 9001, resultMissingAttempt: { n: 3 },
    pendingWin: { closedAt: 1000 }, attempt: { n: 3, presses: 2, dials: 1, dialHits: 2 },
    stats: { resultMissing: 1 },
  };
  const logs = [];
  const api = resultMissingCore(F, function () { logs.push(Array.prototype.slice.call(arguments)); });

  assert.equal(api.clearResultMissing('catch card'), true);
  assert.equal(F.resultMissing, false);
  assert.equal(F.resultMissingAt, 0);
  assert.equal(F.resultMissingAttempt, null);
  assert.deepEqual(logs[0], ['result missing cleared', { why: 'catch card' }]);
  assert.equal(api.clearResultMissing('again'), false, 'clearing an unset latch is a no-op');

  F.resultMissing = false;
  F.stats = {};
  assert.equal(api.markResultMissing(9002, 'test'), true);
  assert.equal(F.resultMissing, true);
  assert.equal(F.resultMissingAttempt.n, 3);
  assert.equal(F.stats.resultMissing, 1);
  assert.equal(api.markResultMissing(9003, 'again'), false, 'the latch is not re-counted');
  assert.equal(api.clearResultMissing('cast prompt'), true);
});

test('step uses the pure detector after the card and prompt checks', () => {
  assert.match(CORE, /resultMissingMs: 8000/);
  const detect = slice(LOOP_SRC, '// 3b. A pressed dial', 'const seatProbe');
  assert.match(detect, /resultMissingDue\(F, t\)/);
  assert.match(detect, /markResultMissing\(t, 'no catch card or cast prompt'\)/);
});

test('status exposes the latch and every cast retry stops while it is set', () => {
  const status = slice(CORE, 'F.status = function () {', 'accuracy: {');
  assert.match(status, /resultMissing: !!F\.resultMissing/);
  assert.match(status, /resultMissingAt:/);
  assert.match(status, /resultMissingAttempt:/);
  assert.match(LOOP_SRC, /if \(!F\.resultMissing && \(!F\.castHold \|\| seatProbe\)/);
  assert.match(LOOP_SRC, /seatWatch && !F\.geo && !F\.needsSeat && !F\.resultMissing/);
  assert.match(DIAG, /if \(st\.resultMissing\) return o\('result-missing', 'high'/);
});

test('a late prompt, dial or catch card clears the latch', () => {
  assert.match(LOOP_SRC, /clearResultMissing\('cast prompt'\)/);
  assert.match(LOOP_SRC, /clearResultMissing\('dial'\)/);
  assert.match(LOOP_SRC, /clearResultMissing\('catch card'\)/);
});

test('the session uses a distinct, non-retryable reason and refuses Resume', () => {
  assert.match(SESSION, /paused\(s, at, 'result-missing'\)/);
  assert.match(SESSION, /pauseReason === 'result-missing'/);
  assert.match(SESSION, /refuse', reason: 'result-missing'/);
  assert.ok(!/result-missing/.test(slice(SESSION, 'function retryable', 'var RETRY_DELAY_MS')),
    'result-missing must not enter the bounded retry cycle');
});

test('the panel names the state and makes it observable', () => {
  assert.match(PANEL, /resultMissing: !!\(status && status\.resultMissing\)/);
  assert.match(PANEL, /'no fishing result — the game is input-locked/);
  assert.match(PANEL, /banner\.result/);
  assert.match(PANEL, /a\.reason === 'result-missing'/);
  assert.match(PANEL, /primary\.textContent = 'Reload game'/);
  assert.match(PANEL, /if \(resultMissingNow\(\)\)[\s\S]{0,180}window\.location\.reload\(\)/);
  assert.match(PANEL, /function resultMissingNow\(\)/);
  assert.match(PANEL, /host\.dataset\.resultMissing = '1'/);
});
