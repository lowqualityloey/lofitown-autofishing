'use strict';
// The 2026-11-24 zombie: the panel read `running` while the core had stopped and `fishingMs` no
// longer moved. Nothing recorded the failure and nothing revived the core. The guard has two pieces:
// a pure predicate (session.coreGuard) and a panel watchdog on a timer of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../session.js');

const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const T0 = 1_800_000_000_000;

test('a running phase with a stopped core is a zombie the guard revives', () => {
  assert.equal(S.coreGuard({ phase: 'running' }, { running: false }), 'revive');
  assert.equal(S.coreGuard({ phase: 'running' }, { running: true }), null);
});

test('the guard leaves every phase it does not own alone', () => {
  assert.equal(S.coreGuard({ phase: 'paused' }, { running: false }), null, 'a pause owns its core');
  assert.equal(S.coreGuard({ phase: 'cooldown' }, { running: false }), null);
  assert.equal(S.coreGuard({ phase: 'waiting' }, { running: false }), null);
  assert.equal(S.coreGuard({ phase: 'idle' }, { running: false }), null);
});

test('no core status is not evidence of a zombie', () => {
  assert.equal(S.coreGuard({ phase: 'running' }, null), null);
  assert.equal(S.coreGuard(null, { running: false }), null);
  assert.equal(S.coreGuard({ phase: 'running' }, { running: 'yes' }), null);
});

test('the watchdog runs on its own timer and survives a dead tick loop', () => {
  assert.ok(PANEL.includes('guardTimer = setInterval(health, TICK_GUARD_MS)'), 'a second timer, not the tick loop');
  assert.ok(PANEL.includes('if (guardTimer) clearInterval(guardTimer)'), 'unmount stops it');
  assert.ok(PANEL.includes("window.AutoFishSession.coreGuard(state, status) === 'revive'"), 'asks the shared predicate');
  assert.ok(PANEL.includes('zombieRevives++'), 'a revive is counted');
  assert.ok(PANEL.includes("banner = 'the fishing core had stopped — restarted'"), 'the revive is said out loud');
});

test('a throwing tick is recorded instead of dying silently', () => {
  assert.match(PANEL, /function tick\(\) \{\s*lastTickAt = Date\.now\(\);\s*try \{ tickOnce\(\); \} catch \(e\) \{ noteTickError\('tick', e\); \}/);
  assert.ok(PANEL.includes('tickErrors++'), 'the error is counted');
  assert.ok(PANEL.includes("lastTickError = where + ': '"), 'the error is kept');
});

test('a stopped core is not charged, and the watchdog re-enters a silent loop', () => {
  assert.ok(PANEL.includes('stalled: !!(status && (!status.running || status.stalled))'), 'a stopped core is not fishing time');
  const health = PANEL.slice(PANEL.indexOf('function health()'), PANEL.indexOf('function tickOnce()'));
  assert.ok(health.includes("document.visibilityState === 'visible'"), 'a throttled background tab is not a panel error');
  assert.match(health, /noteTickError\('watchdog'[\s\S]{0,200}tick\(\);/, 'a silent loop is re-entered, not only reported');
  const revive = health.slice(health.indexOf("coreGuard(state, status) === 'revive'"));
  assert.ok(revive.indexOf('RUNNERS.startCore') < revive.indexOf('zombieRevives++'), 'a revive is counted after the core was asked to start');
});

test('the crash cap allows three revives in ten minutes and refuses the fourth', () => {
  let times = [];
  for (let i = 0; i < 3; i++) {
    const g = S.reviveGate(times, T0 + i * 1000);
    assert.equal(g.allow, true, 'revive ' + (i + 1) + ' is inside the cap');
    times = g.times;
  }
  const fourth = S.reviveGate(times, T0 + 4000);
  assert.equal(fourth.allow, false, 'the fourth restart in the window stops the session');
  assert.equal(fourth.times.length, 3, 'a refused restart is not recorded');
});

test('the crash window rolls: revives older than ten minutes do not count', () => {
  const old = T0 - 11 * 60 * 1000;
  const g = S.reviveGate([old, old + 1000, old + 2000], T0);
  assert.equal(g.allow, true, 'three stale restarts leave the window open');
  assert.deepEqual(g.times, [T0], 'stale entries are pruned, the new one is kept');

  const exact = T0 - 10 * 60 * 1000;
  const edge = S.reviveGate([exact, exact, exact], T0);
  assert.equal(edge.allow, true, 'exactly one window old is already stale');
  assert.deepEqual(edge.times, [T0]);
});

test('a core-crash stop carries its guard diagnostics into the session row', () => {
  const { state } = S.reduce(S.createState(), { type: 'start', at: T0 });
  const diag = { revives: 3, windowRevives: 3, tickErrors: 1, lastTickError: 'tick: boom', doctor: 'detector-blind', tickAgoMs: 9000 };
  const r = S.reduce(state, { type: 'stop', at: T0 + 60_000, reason: 'core-crash', diag });
  assert.equal(r.state.stopReason, 'core-crash');
  assert.equal(r.state.phase, 'cooldown', 'a crash-loop stop rests like any other stop');
  const row = r.actions.find((a) => a.type === 'sessionRow');
  assert.equal(row.reason, 'core-crash');
  assert.deepEqual(row.diag, diag, 'the row keeps the guard counters');
});

test('the panel asks the cap before reviving and stops with a diag row', () => {
  assert.ok(PANEL.includes('window.AutoFishSession.reviveGate(reviveTimes, Date.now())'), 'the cap is asked before every restart');
  assert.ok(PANEL.includes("reason: 'core-crash'"), 'the stop has its own reason');
  assert.ok(PANEL.includes('diag: guardDiag()'), 'the stop carries the guard diagnostics');
  assert.ok(PANEL.includes('guardNote(a.diag)'), 'the row runner formats them');
  assert.ok(PANEL.includes("note: note || ''"), 'the POST carries the note');
  assert.ok(PANEL.includes("fact.type === 'start' && out.state.startedAt !== startedAt"), 'only an accepted Start clears the window');
  const guardAt = PANEL.indexOf("coreGuard(state, status) === 'revive'");
  const revive = PANEL.slice(guardAt, PANEL.indexOf('zombieRevives++', guardAt));
  assert.ok(revive.indexOf('reviveGate') < revive.indexOf('RUNNERS.startCore'), 'the cap is asked before the core is restarted');
});

test('focus and capture work cannot stop the session clock', () => {
  const start = PANEL.indexOf('function tickOnce()');
  const end = PANEL.indexOf('async function mount()');
  assert.ok(start > 0 && end > start, 'the tick body is where the test found it');
  const body = PANEL.slice(start, end);
  assert.match(body, /try \{ focusTick\(\); \} catch \(e\) \{ noteTickError\('focus', e\); \}/);
  assert.match(body, /try \{ healCapture\(\); \} catch \(e\) \{ noteTickError\('capture', e\); \}/);
});
