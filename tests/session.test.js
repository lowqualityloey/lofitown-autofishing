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

test('a focus session holds the clock and the core, and resumes when it ends', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'tick', at: T0 + 60_000, visible: true, catches: 0, errors: 0, todayMs: 0 }));
  const r = reduce(state, { type: 'tick', at: T0 + 120_000, visible: true, catches: 0, errors: 0, todayMs: 0, focus: true });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'focus');
  assert.equal(r.state.fishingMs, 120_000, 'the stretch fished before the hold is credited');
  assert.deepEqual(r.actions.map(a => a.type), ['pauseCore', 'persist']);
  // No retry timer: minutes later it is still held, not stopped as a stall.
  let s2 = r.state;
  for (let i = 1; i <= 3; i++) {
    s2 = reduce(s2, { type: 'tick', at: T0 + 120_000 + i * 61_000, visible: true, catches: 0, errors: 0, todayMs: 0, focus: true }).state;
  }
  assert.equal(s2.phase, 'paused');
  assert.equal(s2.pauseReason, 'focus');
  // The session ending is the only thing that lifts it.
  const back = reduce(s2, { type: 'tick', at: T0 + 400_000, visible: true, catches: 0, errors: 0, todayMs: 0, focus: false });
  assert.equal(back.state.phase, 'running');
  assert.ok(back.actions.some(a => a.type === 'resumeCore'), 'a session end resumes the core');
});

test('a focus hold takes over a guard pause, so its retry cannot resume mid-session', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'tick', at: T0 + 60_000, visible: true, catches: 0, errors: 0, todayMs: 0, playerBlocked: true }));
  assert.ok(['player-block', 'no-catch'].includes(state.pauseReason), 'the guard paused the run');
  const held = reduce(state, { type: 'tick', at: T0 + 120_000, visible: true, catches: 0, errors: 0, todayMs: 0, focus: true });
  assert.equal(held.state.phase, 'paused');
  assert.equal(held.state.pauseReason, 'focus', 'the hold owns the pause now');
  assert.ok(!held.actions.some(a => a.type === 'resumeCore'), 'nothing resumes it');
});

test('focus is not retryable and never overwrites an explicit user hold', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'session.js'), 'utf8');
  const retry = src.slice(src.indexOf('function retryable'), src.indexOf('var RETRY_DELAY_MS'));
  assert.ok(!/focus/.test(retry), 'a focus hold is a decision, not a stall to retry');
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'pause', at: T0 + 1000 }));
  assert.equal(state.pauseReason, 'user');
  const r = reduce(state, { type: 'tick', at: T0 + 2000, visible: true, catches: 0, errors: 0, todayMs: 0, focus: true });
  assert.equal(r.state.pauseReason, 'user', 'a user hold survives a focus tick');
  assert.equal(r.state.phase, 'paused');
});

test('a missing fishing result pauses on its own reason and cannot auto-resume', () => {
  // The game locks input with "waiting-for-result" and only its own result event clears it. A tick
  // must not turn that into a seat pause or a retryable no-catch, and the retry timer must not
  // bring the core back while the game is still locked.
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  const r = tick(state, T0 + 120_000, { resultMissing: true, seat: true });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'result-missing', 'the distinct reason outranks the seat fact');
  assert.equal(r.state.fishingMs, 120_000, 'time before the lock is still session time');
  assert.equal(r.state.retryAt, null, 'there is nothing to retry: the game owns the lock');
  assert.deepEqual(r.actions.map(a => a.type), ['pauseCore', 'persist']);
  assert.ok(!r.actions.some(a => a.type === 'holdCasts'), 'this is a full pause, not a cast hold');

  // A later tick with the flag cleared (or a seat/focus fact) does not lift the pause.
  const held = tick(r.state, T0 + 300_000, { resultMissing: false, seat: false, focus: true });
  assert.equal(held.state.phase, 'paused');
  assert.equal(held.state.pauseReason, 'result-missing');
  assert.deepEqual(held.actions, []);

  // Resume cannot deliver the missing result; refuse it and keep the pause for a reload.
  const resume = reduce(held.state, { type: 'resume', at: T0 + 360_000 });
  assert.equal(resume.state.phase, 'paused');
  assert.equal(resume.state.pauseReason, 'result-missing');
  assert.deepEqual(resume.actions, [{ type: 'refuse', reason: 'result-missing' }]);
});

test('a pause fact carries its reason, so a focus hold is labelled', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  const r = reduce(state, { type: 'pause', at: T0 + 1000, reason: 'focus' });
  assert.equal(r.state.pauseReason, 'focus');
  const u = reduce(state, { type: 'pause', at: T0 + 1000 });
  assert.equal(u.state.pauseReason, 'user', 'no reason still means a user hold');
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

test('an automatic retry gets a seat grace instead of re-pausing at once', () => {
  // The seat watchdog can still say "unseated" because a line is already out, not because the
  // character stood up. A retry that resumes into that fact without a grace window re-pauses on
  // its first tick, before its cast can bring the prompt back - and the held casts can never
  // clear the flag. Measured live 2026-11-20: resume -> pause in 0.4 s, for 60 minutes.
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 601_000));
  assert.equal(state.phase, 'paused');
  assert.equal(state.pauseReason, 'no-catch');
  const retryAt = state.retryAt;
  const r = tick(state, retryAt, { seat: true });
  assert.equal(r.state.phase, 'running');
  assert.equal(r.state.seatOverrideUntil, retryAt + 15_000, 'the retry buys the same 15 s a Resume does');
  const soon = tick(r.state, retryAt + 14_000, { seat: true });
  assert.equal(soon.state.phase, 'running', 'the retry must get its cast window');
  const after = tick(soon.state, retryAt + 15_001, { seat: true });
  assert.equal(after.state.phase, 'paused');
  assert.equal(after.state.pauseReason, 'seat');
  assert.deepEqual(after.actions.find(a => a.type === 'holdCasts'), { type: 'holdCasts', on: true });
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

test('a focus hold takes over a seat pause and releases the cast hold', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  const seat = tick(state, T0 + 90_000, { seat: true });
  assert.equal(seat.state.pauseReason, 'seat');
  assert.deepEqual(seat.actions.find(a => a.type === 'holdCasts'), { type: 'holdCasts', on: true });

  const focus = tick(seat.state, T0 + 120_000, { seat: true, focus: true });
  assert.equal(focus.state.phase, 'paused');
  assert.equal(focus.state.pauseReason, 'focus', 'the focus decision owns the pause');
  assert.equal(focus.state.fishingMs, 60_000, 'the seat wait stayed uncharged');
  assert.deepEqual(focus.actions, [
    { type: 'holdCasts', on: false },
    { type: 'pauseCore' },
    { type: 'persist' }
  ], 'the seat hold is released before the core is paused');
  assert.ok(!focus.actions.some(a => a.type === 'resumeCore'), 'nothing resumes mid-focus');

  const seated = tick(focus.state, T0 + 150_000, { seat: false, focus: true });
  assert.equal(seated.state.phase, 'paused');
  assert.equal(seated.state.pauseReason, 'focus', 'a cleared seat fact cannot lift the focus hold');
  assert.deepEqual(seated.actions, []);

  const back = tick(focus.state, T0 + 180_000, { seat: false, focus: false });
  assert.equal(back.state.phase, 'running');
  assert.equal(back.state.pauseReason, null);
  assert.ok(back.actions.some(a => a.type === 'resumeCore'), 'the focus end still resumes');
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

test('a run that crosses midnight spends only its own day against the new cap', () => {
  // 23:30 to 01:00 is one 90 minute session but two fishing days. Charging all of it to the new day
  // burned the cap an hour early, and the panel wrote the whole run under the new day's key.
  const start = new Date(2026, 10, 21, 23, 30).getTime();
  const midnight = new Date(2026, 10, 22, 0, 0).getTime();
  const cap = 60 * 60_000;
  let { state } = reduce(createState({ dailyCapMs: cap, durationMs: 3 * 60 * 60_000 }), { type: 'start', at: start });
  assert.equal(state.dayStartMs, new Date(2026, 10, 21).getTime(), 'the session starts on its own day');

  ({ state } = tick(state, midnight - 30_000, { catches: 1 }));   // 29.5 minutes fished
  assert.equal(state.fishingMs, 29.5 * 60_000);
  assert.equal(state.carriedMs, 0);

  // The stretch over midnight is split: 30 s before, 60 s after.
  ({ state } = tick(state, midnight + 60_000, { catches: 2 }));
  assert.equal(state.fishingMs, 31 * 60_000, 'the whole stretch is still session time');
  assert.equal(state.fishingMs - state.carriedMs, 60_000, 'only the minute after midnight is today');

  // 00:30: the new day has spent 30 minutes, not 60, so the cap is still open.
  ({ state } = tick(state, midnight + 30 * 60_000, { catches: 3 }));
  assert.equal(state.phase, 'running');
  assert.equal(state.fishingMs - state.carriedMs, 30 * 60_000);

  // 01:00: exactly the new day's hour is spent, and the cap stops the run here.
  const r = tick(state, midnight + 60 * 60_000, { catches: 4 });
  assert.equal(r.state.stopReason, 'daily-cap');
  assert.equal(r.state.todayMs, cap, 'the new day is charged only its own hour');
  assert.equal(r.state.fishingMs, 0);
  assert.equal(r.state.carriedMs, 0);
  assert.equal(r.actions.find(a => a.type === 'sessionRow').minutes, 90, 'the row still reports the whole session');
});

test('a run paused across midnight resumes without yesterday on today\'s cap', () => {
  const start = new Date(2026, 10, 21, 23, 30).getTime();
  const midnight = new Date(2026, 10, 22, 0, 0).getTime();
  let { state } = reduce(createState({ dailyCapMs: 60 * 60_000 }), { type: 'start', at: start });
  ({ state } = tick(state, midnight - 60_000, { catches: 1 }));   // 29 minutes fished
  ({ state } = reduce(state, { type: 'pause', at: midnight - 60_000 }));
  assert.equal(state.fishingMs, 29 * 60_000);

  // Midnight passes while the user hold is up: the reducer carries the whole session, and the
  // resume is not refused for time today has not spent.
  ({ state } = tick(state, midnight + 10 * 60_000));
  assert.equal(state.phase, 'paused');
  assert.equal(state.carriedMs, state.fishingMs, 'yesterday is carried out of today');
  const back = reduce(state, { type: 'resume', at: midnight + 10 * 60_000 });
  assert.equal(back.state.phase, 'running');

  const after = tick(back.state, midnight + 11 * 60_000, { catches: 2 });
  assert.equal(after.state.fishingMs - after.state.carriedMs, 60_000, 'only the new minute is today');
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

test('a frozen catch fact trips the no-catch clock: the producer has to stay monotonic', () => {
  // The 400-catch ring froze status().catchCount, and this is what that did to a long run:
  // no catch could ever be newer than the last fact, so the ten-minute watchdog fired.
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 1000, { catches: 400 }));
  const r = tick(state, T0 + 602_000, { catches: 400 });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'no-catch');
});

test('a pause records its reason and when it happened, and a resume clears them', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  const p = reduce(state, { type: 'pause', at: T0 + 90_000 });
  assert.equal(p.state.pauseReason, 'user');
  assert.equal(p.state.pausedAt, T0 + 90_000, 'the panel needs the clock time, not just the reason');
  const r = reduce(p.state, { type: 'resume', at: T0 + 120_000 });
  assert.equal(r.state.pausedAt, null);
  assert.equal(r.state.pauseReason, null);
});

test('a resume restarts the no-catch clock instead of pausing on the first tick', () => {
  // Measured live 2026-11-24: a session held for 5 h resumed and re-paused with reason 'no-catch'
  // 0.9 s later, because lastCatchAt still pointed at the catch before the hold. A hold is not
  // time spent waiting for a bite.
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'tick', at: T0 + 60_000, visible: true, catches: 1, errors: 0, todayMs: 0 }));
  ({ state } = reduce(state, { type: 'pause', at: T0 + 90_000 }));
  const at = T0 + 6 * 60 * 60_000;
  const resumed = reduce(state, { type: 'resume', at });
  assert.equal(resumed.state.phase, 'running');
  assert.equal(resumed.state.lastCatchAt, at, 'the hold is not counted as a stretch without a bite');
  const first = reduce(resumed.state, { type: 'tick', at: at + 1000, visible: true, catches: 1, errors: 0, todayMs: 0 });
  assert.equal(first.state.phase, 'running');
  assert.equal(first.state.pauseReason, null);
});

test('a guard pause records its own time, and a stop clears it', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = reduce(state, { type: 'tick', at: T0 + 60_000, visible: true, catches: 1, errors: 0, todayMs: 0 }));
  const quiet = reduce(state, { type: 'tick', at: T0 + 60_000 + 10 * 60_000 + 1, visible: true, catches: 1, errors: 0, todayMs: 0 });
  assert.equal(quiet.state.pauseReason, 'no-catch');
  assert.equal(quiet.state.pausedAt, T0 + 60_000 + 10 * 60_000 + 1);
  const stopped = reduce(quiet.state, { type: 'stop', at: T0 + 12 * 60_000, reason: 'user' });
  assert.equal(stopped.state.pausedAt, null, 'a finished session is not still paused');
});

test('flow mode runs nonstop past duration, cap, and window, skips cooldown on stop, and still honors safety guards', () => {
  let { state, actions } = reduce(
    createState({ mode: 'flow', durationMs: 60_000, dailyCapMs: 60_000, cooldownMs: 30 * 60_000, window: { on: true, start: '00:00', stop: '00:01' } }),
    { type: 'start', at: T0 }
  );
  assert.equal(state.phase, 'running');
  assert.equal(actions[0].maxMinutes, 0, 'Flow mode removes core timeout');

  // Tick 15 hours forward with catches -> never hits duration, daily-cap, or window stop
  let at = T0;
  for (let h = 1; h <= 15; h++) {
    at = T0 + h * 3600_000;
    ({ state } = reduce(state, { type: 'tick', at, visible: true, catches: h, errors: 0, todayMs: 25 * 3600_000 }));
    assert.equal(state.phase, 'running', 'still running after ' + h + 'h');
  }

  // Hidden pause-only (hiddenStopMs: 0) holds indefinitely while hidden and resumes on return
  ({ state } = reduce(state, { type: 'config', at, patch: { hiddenStopMs: 0 } }));
  ({ state } = reduce(state, { type: 'tick', at: at + 10_000, visible: false, catches: 15, errors: 0, todayMs: 0 }));
  ({ state } = reduce(state, { type: 'tick', at: at + 20_000, visible: false, catches: 15, errors: 0, todayMs: 0 }));
  assert.equal(state.pauseReason, 'hidden');
  ({ state } = reduce(state, { type: 'tick', at: at + 2 * 3600_000, visible: false, catches: 15, errors: 0, todayMs: 0 }));
  assert.equal(state.phase, 'paused', 'hiddenStopMs: 0 never hard-stops the run');
  ({ state } = reduce(state, { type: 'tick', at: at + 2 * 3600_000 + 5_000, visible: true, catches: 15, errors: 0, todayMs: 0 }));
  ({ state } = reduce(state, { type: 'tick', at: at + 2 * 3600_000 + 9_000, visible: true, catches: 15, errors: 0, todayMs: 0 }));
  assert.equal(state.phase, 'running', 'resumes automatically once tab returns');

  // Safety guard (resultMissing) still pauses in Flow mode
  ({ state } = reduce(state, { type: 'tick', at: at + 2 * 3600_000 + 15_000, visible: true, catches: 15, errors: 0, todayMs: 0, resultMissing: true }));
  assert.equal(state.phase, 'paused');
  assert.equal(state.pauseReason, 'result-missing');

  // Manual Stop enters idle directly without cooldown
  ({ state } = reduce(state, { type: 'stop', at: at + 2 * 3600_000 + 20_000, reason: 'user' }));
  assert.equal(state.phase, 'idle');
  assert.equal(state.cooldownUntil, null);

  // Switching Timed -> Flow during cooldown clears cooldown back to idle
  let timed = createState({ phase: 'cooldown', cooldownUntil: T0 + 600_000, stopReason: 'user' });
  ({ state } = reduce(timed, { type: 'config', at: T0, patch: { mode: 'flow' } }));
  assert.equal(state.phase, 'idle');
  assert.equal(state.cooldownUntil, null);
});
