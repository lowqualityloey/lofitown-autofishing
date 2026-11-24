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

test('focus and capture work cannot stop the session clock', () => {
  const start = PANEL.indexOf('function tickOnce()');
  const end = PANEL.indexOf('async function mount()');
  assert.ok(start > 0 && end > start, 'the tick body is where the test found it');
  const body = PANEL.slice(start, end);
  assert.match(body, /try \{ focusTick\(\); \} catch \(e\) \{ noteTickError\('focus', e\); \}/);
  assert.match(body, /try \{ healCapture\(\); \} catch \(e\) \{ noteTickError\('capture', e\); \}/);
});
