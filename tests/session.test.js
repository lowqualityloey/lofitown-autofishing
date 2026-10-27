'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, reduce } = require('../session.js');

const T0 = 1_800_000_000_000;

test('start moves idle to running and asks the core to start with a backstop', () => {
  const { state, actions } = reduce(createState(), { type: 'start', at: T0 });
  assert.equal(state.phase, 'running');
  assert.deepEqual(actions.map(a => a.type), ['startCore', 'wakeLock', 'persist']);
  assert.equal(actions[0].maxMinutes, 62);
});

test('only running time counts toward the session length', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'tick', at: T0 + 60_000, visible: true, catches: 1, errors: 0, todayMs: 0 }));
  assert.equal(state.fishingMs, 60_000);
});

test('stop enters cooldown and logs the session', () => {
  const { state } = reduce(createState(), { type: 'start', at: T0 });
  const r = reduce(state, { type: 'stop', at: T0 + 600_000, reason: 'user' });
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.cooldownUntil, T0 + 600_000 + 1_800_000);
  assert.deepEqual(r.actions.map(a => a.type), ['stopCore', 'releaseWakeLock', 'sessionRow', 'persist']);
  assert.equal(r.actions[2].reason, 'user');
  assert.equal(r.actions[2].minutes, 10);
});

test('start during cooldown is refused, not started', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'stop', at: T0, reason: 'user' }));
  const r = reduce(state, { type: 'start', at: T0 + 60_000 });
  assert.equal(r.state.phase, 'cooldown');
  assert.deepEqual(r.actions, [{ type: 'refuse', reason: 'cooldown' }]);
});

test('config merges without mutating the previous state', () => {
  const before = createState();
  const { state } = reduce(before, { type: 'config', at: T0, patch: { durationMs: 300_000 } });
  assert.equal(state.durationMs, 300_000);
  assert.equal(before.durationMs, 3_600_000);
});

test('a start at the daily cap is refused', () => {
  const r = reduce(createState({ todayMs: 14_400_000 }), { type: 'start', at: T0 });
  assert.deepEqual(r.actions, [{ type: 'refuse', reason: 'daily-cap' }]);
});
