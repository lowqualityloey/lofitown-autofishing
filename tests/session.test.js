'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, reduce } = require('../session.js');

const T0 = 1_800_000_000_000;

test('a fact with no clock falls back to now instead of the epoch', () => {
  const { state } = reduce(createState(), { type: 'start' });
  assert.ok(state.startedAt > 1600000000000, 'startedAt is a real clock reading');
  const tick = reduce(state, { type: 'tick', visible: true, catches: 0, errors: 0, todayMs: 0 });
  assert.ok(tick.state.fishingMs < 5000, 'no epoch-sized phantom fishing time was credited');
  assert.equal(tick.state.phase, 'running');
});

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

test('a stalled loop is not charged for the time it never fished', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'tick', at: T0 + 60_000, visible: true, catches: 0, errors: 0, todayMs: 0 }));
  assert.equal(state.fishingMs, 60_000);
  // 40 s with the loop stalled: the frames never happened, so the budget must not move
  ({ state } = reduce(state, { type: 'tick', at: T0 + 100_000, visible: true, catches: 0, errors: 0, todayMs: 0, stalled: true }));
  assert.equal(state.fishingMs, 60_000, 'a stalled stretch was charged as fishing time');
  assert.equal(state.stalled, true);
  // and the clock picks up again from the moment the frames come back
  ({ state } = reduce(state, { type: 'tick', at: T0 + 110_000, visible: true, catches: 0, errors: 0, todayMs: 0 }));
  assert.equal(state.fishingMs, 70_000);
  assert.equal(state.stalled, false);
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

test('pause holds the session without a cooldown and resume continues it', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 5 * 60_000));
  const p = reduce(state, { type: 'pause', at: T0 + 8 * 60_000 });
  assert.equal(p.state.phase, 'paused');
  assert.equal(p.state.pauseReason, 'user');
  assert.equal(p.state.fishingMs, 8 * 60_000, 'time up to the pause is credited');
  assert.equal(p.state.cooldownUntil, null, 'a hold must not start the cooldown');
  assert.deepEqual(p.actions.map(a => a.type), ['pauseCore', 'releaseWakeLock', 'persist']);
  assert.ok(!p.actions.some(a => a.type === 'sessionRow'), 'a hold is not a finished session');

  // Two hours of hold: the clock, the session length and the budget all stay put.
  const held = tick(p.state, T0 + 120 * 60_000);
  assert.equal(held.state.phase, 'paused');
  assert.equal(held.state.pauseReason, 'user');
  assert.equal(held.state.fishingMs, 8 * 60_000);

  const r = reduce(held.state, { type: 'resume', at: T0 + 120 * 60_000 });
  assert.equal(r.state.phase, 'running');
  assert.equal(r.state.pauseReason, null);
  assert.equal(r.state.fishingMs, 8 * 60_000);
  assert.deepEqual(r.actions.map(a => a.type), ['resumeCore', 'wakeLock', 'persist']);
  const after = tick(r.state, T0 + 125 * 60_000);
  assert.equal(after.state.fishingMs, 13 * 60_000, 'the hold itself added no fishing time');
});

test('a user pause never auto-resumes on a tick', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  ({ state } = reduce(state, { type: 'pause', at: T0 + 90_000 }));
  // visible, seated, catches landing: none of it is permission to override an explicit pause
  const r = tick(state, T0 + 300_000, { visible: true, seat: false, catches: 5 });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'user');
  assert.deepEqual(r.actions, []);
});

test('pause is ignored outside a running session', () => {
  const idle = reduce(createState(), { type: 'pause', at: T0 });
  assert.equal(idle.state.phase, 'idle');
  assert.deepEqual(idle.actions, []);
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'pause', at: T0 + 1 }));
  const again = reduce(state, { type: 'pause', at: T0 + 2 });
  assert.equal(again.state.phase, 'paused');
  assert.deepEqual(again.actions, []);
});

test('stop while paused ends the session and starts the cooldown', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 5 * 60_000));
  ({ state } = reduce(state, { type: 'pause', at: T0 + 8 * 60_000 }));
  const r = reduce(state, { type: 'stop', at: T0 + 9 * 60_000, reason: 'user' });
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.cooldownUntil, T0 + 9 * 60_000 + 1_800_000);
  assert.equal(r.state.todayMs, 8 * 60_000, 'the held session folded into today once');
  assert.equal(r.actions.find(a => a.type === 'sessionRow').minutes, 8);
});

test('resume at a spent cap is refused instead of stopping on the next tick', () => {
  const paused = createState({ phase: 'paused', pauseReason: 'user', fishingMs: 5 * 60_000, todayMs: 5 * 60_000, dailyCapMs: 10 * 60_000, lastTickAt: null });
  const r = reduce(paused, { type: 'resume', at: T0 });
  assert.equal(r.state.phase, 'paused');
  assert.deepEqual(r.actions, [{ type: 'refuse', reason: 'daily-cap' }]);
});

test('resume outside the clock window is refused, not a silent no-op', () => {
  const at = new Date(2026, 0, 1, 23, 30).getTime();   // window is 21:00-23:00
  const paused = createState({ phase: 'paused', pauseReason: 'user', window: { on: true, start: '21:00', stop: '23:00' }, lastTickAt: null });
  const r = reduce(paused, { type: 'resume', at });
  assert.equal(r.state.phase, 'paused');
  assert.deepEqual(r.actions, [{ type: 'refuse', reason: 'window' }]);
});

test('skipping the cooldown clears the wait so a start is allowed', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'stop', at: T0 + 60_000, reason: 'user' }));
  const skipped = reduce(state, { type: 'skip-cooldown', at: T0 + 120_000 });
  assert.equal(skipped.state.phase, 'idle');
  assert.equal(skipped.state.cooldownUntil, null);
  assert.equal(skipped.state.stopReason, null);
  assert.deepEqual(skipped.actions.map(a => a.type), ['persist']);
  const started = reduce(skipped.state, { type: 'start', at: T0 + 120_000 });
  assert.equal(started.state.phase, 'running');
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
/* ---------------------------------------------------------------- guards --- */

const tick = (state, at, over) => reduce(state, Object.assign({ type: 'tick', at, visible: true, catches: 0, errors: 0, todayMs: 0 }, over || {}));

test('hidden for six seconds pauses the loop', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 1000));
  ({ state } = tick(state, T0 + 2000, { visible: false }));
  ({ state } = tick(state, T0 + 4000, { visible: false }));
  let r = tick(state, T0 + 8000, { visible: false });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'hidden');
  assert.deepEqual(r.actions.map(a => a.type), ['pauseCore', 'releaseWakeLock', 'persist']);
});

test('showing the window for three seconds resumes after a hidden pause', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 2000, { visible: false }));
  ({ state } = tick(state, T0 + 8000, { visible: false }));
  assert.equal(state.phase, 'paused');
  ({ state } = tick(state, T0 + 9000));
  let r = tick(state, T0 + 10_000);
  assert.equal(r.state.phase, 'paused');            // only one second visible
  state = r.state;
  r = tick(state, T0 + 12_500);
  assert.equal(r.state.phase, 'running');
  assert.ok(r.actions.some(a => a.type === 'resumeCore'));
});

test('hidden for two minutes stops with reason hidden', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 2000, { visible: false }));
  ({ state } = tick(state, T0 + 8000, { visible: false }));
  const r = tick(state, T0 + 125_000, { visible: false });
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.stopReason, 'hidden');
  assert.equal(r.actions.find(a => a.type === 'sessionRow').reason, 'hidden');
});

test('ten minutes without a catch pauses and schedules a retry', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 300_000));
  const r = tick(state, T0 + 601_000);
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'no-catch');
  assert.equal(r.state.retryAt, T0 + 661_000);
  assert.equal(r.state.retries, 0);
});

test('the retry resumes once, then a fourth failure stops the session', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  let at = T0;
  for (let i = 0; i < 3; i++) {
    at += 601_000;
    let r = tick(state, at);
    assert.equal(r.state.phase, 'paused', 'attempt ' + i);
    at += 61_000;
    r = tick(r.state, at);
    assert.equal(r.state.phase, 'running', 'retry ' + i);
    assert.equal(r.state.retries, i + 1);
    state = r.state;
  }
  const r = tick(state, at + 601_000);
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.stopReason, 'no-catch');
});

test('an error burst stops the session', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 1000, { errors: 5 }));
  const r = tick(state, T0 + 2000, { errors: 30 });
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.stopReason, 'errors');
});

test('an unseated character pauses the clock instead of burning the session', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  assert.equal(state.fishingMs, 60_000);
  const r = tick(state, T0 + 120_000, { seat: true });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'seat');
  assert.equal(r.state.fishingMs, 60_000, 'the unseated minute was not counted');
  assert.deepEqual(r.actions.map(a => a.type), ['holdCasts', 'persist'], 'the core keeps running, but its casts are held');
  assert.deepEqual(r.actions[0], { type: 'holdCasts', on: true });
  // half an hour of waiting burns nothing
  const later = tick(r.state, T0 + 120_000 + 20 * 60_000, { seat: true });
  assert.equal(later.state.phase, 'paused');
  assert.equal(later.state.fishingMs, 60_000);
});

test('sitting down again resumes the session where it left off', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  ({ state } = tick(state, T0 + 120_000, { seat: true }));
  const r = tick(state, T0 + 900_000, { seat: false });
  assert.equal(r.state.phase, 'running');
  assert.equal(r.state.pauseReason, null);
  assert.ok(r.actions.some(a => a.type === 'resumeCore'));
  assert.equal(r.state.fishingMs, 60_000, 'the pause itself added no time');
  const after = tick(r.state, T0 + 930_000, { seat: false });
  assert.equal(after.state.fishingMs, 90_000, 'time counts again once seated');
});

test('a seat pause holds the casts, and Resume overrides the seat fact for a grace window', () => {
  // Keeping the core alive during a seat pause is only safe if it cannot cast: a retry that puts a
  // line in the water removes the prompt the pause is waiting for, and neither side can recover.
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  const held = tick(state, T0 + 90_000, { seat: true });
  assert.deepEqual(held.actions.find(a => a.type === 'holdCasts'), { type: 'holdCasts', on: true });
  assert.ok(!held.actions.some(a => a.type === 'pauseCore'), 'the watcher must keep running');

  // Resume is a user override: the still-true seat fact must not re-pause on the next tick.
  const back = reduce(held.state, { type: 'resume', at: T0 + 120_000 });
  assert.deepEqual(back.actions[0], { type: 'holdCasts', on: false }, 'Resume frees the retry loop');
  assert.deepEqual(back.actions.slice(1).map(a => a.type), ['resumeCore', 'wakeLock', 'persist']);
  assert.equal(back.state.seatOverrideUntil, T0 + 120_000 + 15_000);
  const soon = tick(back.state, T0 + 125_000, { seat: true });
  assert.equal(soon.state.phase, 'running', 'the same seat fact must not re-pause inside the window');

  // After the window the watchdog wins again, and the hold comes back with it.
  const after = tick(soon.state, T0 + 136_000, { seat: true });
  assert.equal(after.state.phase, 'paused');
  assert.equal(after.state.pauseReason, 'seat');
  assert.deepEqual(after.actions.find(a => a.type === 'holdCasts'), { type: 'holdCasts', on: true });
});

test('the daily cap counts fishing time, not waiting for a chair', () => {
  // the pause credits nothing, so an unseated hour cannot creep the day's budget toward the cap
  let { state } = reduce(createState({ dailyCapMs: 10 * 60_000 }), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 5 * 60_000, { todayMs: 0 }));
  assert.equal(state.fishingMs, 5 * 60_000);
  ({ state } = tick(state, T0 + 6 * 60_000, { seat: true, todayMs: 0 }));
  assert.equal(state.pauseReason, 'seat');
  // 19 unseated minutes, still inside the 30-minute seat cap
  for (let m = 7; m <= 25; m++) {
    ({ state } = tick(state, T0 + m * 60_000, { seat: true, todayMs: 0 }));
  }
  assert.equal(state.phase, 'paused', 'unseated time never spends the last five minutes of the cap');
  assert.equal(state.fishingMs, 5 * 60_000);
  const back = tick(state, T0 + 26 * 60_000, { seat: false, todayMs: 0 });
  assert.equal(back.state.phase, 'running');
  assert.equal(back.state.fishingMs, 5 * 60_000, 'the pause added no fishing time either');
});

test('a seat pause that outlives the clock window ends the session', () => {
  const window22 = new Date(2026, 0, 1, 22, 0, 0);   // local 22:00, inside 21:00-23:00
  const T = window22.getTime();
  let { state } = reduce(createState({ window: { on: true, start: '21:00', stop: '23:00' } }), { type: 'start', at: T });
  ({ state } = tick(state, T + 60_000, { seat: true }));
  assert.equal(state.pauseReason, 'seat');
  const inside = tick(state, T + 30 * 60_000, { seat: true });
  assert.equal(inside.state.phase, 'paused', 'still inside the window: keep waiting for a chair');
  const closed = tick(state, T + 61 * 60_000, { seat: true });   // 23:01
  assert.equal(closed.state.phase, 'idle', 'a closed window is not a rest');
  assert.equal(closed.state.cooldownUntil, null, 'the next window should not wait on a cooldown');
  assert.equal(closed.state.stopReason, 'window');
});

test('a seat pause that runs into a spent daily cap stops instead of resuming', () => {
  let { state } = reduce(createState({ dailyCapMs: 10 * 60_000 }), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000, { seat: true, todayMs: 0 }));
  assert.equal(state.pauseReason, 'seat');
  const spent = tick(state, T0 + 120_000, { seat: true, todayMs: 10 * 60_000 });
  assert.equal(spent.state.phase, 'idle', 'a spent cap is not a rest');
  assert.equal(spent.state.cooldownUntil, null, 'a spent cap must not add a cooldown');
  assert.equal(spent.state.stopReason, 'daily-cap');
});

test('a seat pause longer than half an hour ends the session instead of waiting forever', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 120_000, { seat: true }));
  const still = tick(state, T0 + 120_000 + 29 * 60_000, { seat: true });
  assert.equal(still.state.phase, 'paused');
  const r = tick(state, T0 + 120_000 + 31 * 60_000, { seat: true });
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.stopReason, 'no-seat');
});

test('the session stops at its duration', () => {
  let { state } = reduce(createState({ durationMs: 60_000 }), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 59_000));
  assert.equal(state.phase, 'running');
  const r = tick(state, T0 + 61_000);
  assert.equal(r.state.stopReason, 'duration');
});

test('the session stops when the clock window closes, without a cooldown', () => {
  const win = { on: true, start: '21:00', stop: '23:00' };
  const at = new Date(2026, 9, 27, 22, 59).getTime();
  let { state } = reduce(createState({ window: win }), { type: 'start', at });
  assert.equal(state.phase, 'running');
  const r = tick(state, at + 2 * 60_000);
  assert.equal(r.state.phase, 'idle');
  assert.equal(r.state.cooldownUntil, null);
  assert.equal(r.state.stopReason, 'window');
});

test('the daily cap stops the session, without a cooldown', () => {
  const { DEFAULTS } = require('../session.js');
  const left = DEFAULTS.dailyCapMs - 1000;
  const { state } = reduce(createState({ todayMs: left }), { type: 'start', at: T0 });
  const r = tick(state, T0 + 5000, { todayMs: left });
  assert.equal(r.state.phase, 'idle');
  assert.equal(r.state.cooldownUntil, null);
  assert.equal(r.state.stopReason, 'daily-cap');
  assert.ok(r.actions.some(a => a.type === 'sessionRow'), 'the finished session is still logged');
});

test('a catch resets the no-catch clock', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 400_000, { catches: 1 }));
  const r = tick(state, T0 + 700_000);
  assert.equal(r.state.phase, 'running');
});

/* ------------------------------------------------------- budget persistence - */

test('a stop folds the session into today, so a restart cannot forget it', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 10 * 60_000));
  const r = reduce(state, { type: 'stop', at: T0 + 10 * 60_000, reason: 'user' });
  assert.equal(r.state.fishingMs, 0, 'the session time moved into today');
  assert.equal(r.state.todayMs, 10 * 60_000);
  assert.equal(r.actions.find(a => a.type === 'sessionRow').minutes, 10, 'the row still reports the session');
});

test('a second session counts against the cap the first one spent', () => {
  let { state } = reduce(createState({ dailyCapMs: 630_000 }), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 600_000, { todayMs: 0 }));
  ({ state } = reduce(state, { type: 'stop', at: T0 + 600_000, reason: 'user' }));
  assert.equal(state.todayMs, 600_000);
  ({ state } = tick(state, T0 + 2_400_000, { todayMs: 600_000 }));   // 30 min cooldown, over
  assert.equal(state.phase, 'idle');
  const again = reduce(state, { type: 'start', at: T0 + 2_400_000 });
  assert.equal(again.state.phase, 'running');
  assert.equal(again.state.todayMs, 600_000, 'the start kept the day');
  const over = tick(again.state, T0 + 2_460_000, { todayMs: 600_000 });
  assert.equal(over.state.stopReason, 'daily-cap', 'ten minutes of the ten-and-a-half were already spent');
});

/* ---------------------------------------------------------------- chaining - */

test('chain runs restarts after the cooldown, within the window and the cap', () => {
  let { state } = reduce(createState({ chain: true, cooldownMs: 60_000 }), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'stop', at: T0 + 60_000, reason: 'user' }));
  assert.equal(state.phase, 'cooldown');
  const r = tick(state, T0 + 121_000, { visible: true });
  assert.equal(r.state.phase, 'running');
  assert.ok(r.actions.some(a => a.type === 'startCore'), 'the next session starts itself');
  assert.equal(r.state.stopReason, null, 'the old stop reason is cleared');
});

test('chain runs never starts while the tab is hidden', () => {
  let { state } = reduce(createState({ chain: true, cooldownMs: 60_000 }), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'stop', at: T0 + 60_000, reason: 'user' }));
  const r = tick(state, T0 + 121_000, { visible: false });
  assert.equal(r.state.phase, 'idle', 'a hidden tab must not start itself');
});

test('chain runs stops at a spent cap instead of restarting', () => {
  let { state } = reduce(createState({ chain: true, cooldownMs: 60_000, dailyCapMs: 60_000 }), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'stop', at: T0 + 60_000, reason: 'user' }));
  assert.equal(state.todayMs, 60_000);
  const r = tick(state, T0 + 121_000, { visible: true, todayMs: 60_000 });
  assert.equal(r.state.phase, 'idle');
});

test('a longer hidden stop keeps the run paused instead of ending it', () => {
  let { state } = reduce(createState({ hiddenStopMs: 10 * 60_000 }), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 2000, { visible: false }));
  ({ state } = tick(state, T0 + 8000, { visible: false }));
  assert.equal(state.phase, 'paused');
  ({ state } = tick(state, T0 + 125_000, { visible: false }));
  assert.equal(state.phase, 'paused', 'a two-minute cover is not a stop when the threshold is ten');
  const r = tick(state, T0 + 605_000, { visible: false });
  assert.equal(r.state.phase, 'cooldown');
  assert.equal(r.state.stopReason, 'hidden');
});
