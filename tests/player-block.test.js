'use strict';
/**
 * Nearby-player guard + overnight stall split.
 * Live on BrowserOS-neo the bot sat beside another player: a tap opened the
 * profile and the run stalled with no prompt and no dial. The guard requires a
 * boxed repeat before tapping, never taps `anywhere` blobs, suppresses a spot
 * whose taps never produce a dial, and pauses with named reasons instead of
 * burning the session as a generic no-catch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const SESSION_SRC = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');
const { createState, reduce } = require('../session.js');

const T0 = 1_800_000_000_000;
const tick = (state, at, over) => reduce(state, Object.assign({ type: 'tick', at, visible: true, catches: 0, errors: 0, todayMs: 0 }, over || {}));

test('a boxed prompt must repeat at the same spot before it may tap', () => {
  assert.match(CORE, /function bubbleConfirmed\(b, t\)/);
  assert.match(CORE, /BUBBLE_CONFIRM_PX = 12/);
  assert.match(CORE, /return q\.n >= 2;/);
  assert.match(CORE, /if \(q\.blockedUntil && t < q\.blockedUntil\) return false;/);
});

test('an `anywhere` blob never taps and never moves the dial hint', () => {
  assert.match(CORE, /if \(!b \|\| b\.via === 'anywhere'\) return false;/);
  const btn = CORE.indexOf('const b = F.findBubble();');
  const branch = CORE.slice(btn, btn + 4200);
  assert.match(branch, /var isBox = b\.via !== 'anywhere';/);
});

test('three fruitless taps on one spot suppress it and raise playerBlocked', () => {
  assert.match(CORE, /function noteBubbleTap\(t\)/);
  assert.match(CORE, /PLAYER_TAPS = 3/);
  assert.match(CORE, /q\.blockedUntil = t \+ PLAYER_BLOCK_MS;/);
  assert.match(CORE, /playerBlocked: !!\(F\.bubblePrev && F\.bubblePrev\.blockedUntil/);
  assert.match(CORE, /F\.bubblePrev = null;.*a dial proves the prompt was real/s);
  assert.match(CORE, /sinceBubbleMs: F\.lastBubbleAt \? Math\.round\(now\(\) - F\.lastBubbleAt\) : null/);
});

test('doctor() names the nearby player instead of waiting for a no-catch', () => {
  assert.match(CORE, /if \(st\.playerBlocked\) return o\('nearby-player', 'warn', 'a tap keeps landing where no dial follows/);
  const open = CORE.indexOf('// <doctor-core>');
  const close = CORE.indexOf('// </doctor-core>');
  const D = new Function(CORE.slice(open + '// <doctor-core>'.length, close) + '\nreturn { doctor };')();
  const base = { running: true, paused: false, hidden: false, stalled: false, postRender: true,
    snapshot: { gl: 100, canvas2d: 0 }, readback: { canvas2d: 0 }, longtasks: { inLast10s: 0, maxMs: 10 },
    worstFrameMs: 50, needsSeat: false, sincePromptMs: 5000, sinceDialMs: 60000,
    accepted: 0, rejected: 0, dials: 0, held: 0, forced: 0, holdPassesMax: 0 };
  assert.equal(D.doctor(Object.assign({}, base, { playerBlocked: true })).verdict, 'nearby-player');
  assert.equal(D.doctor(base).verdict, 'waiting-bite');
});

test('a blocked profile modal pauses the clock instead of burning it', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 60_000));
  const r = tick(state, T0 + 120_000, { playerBlocked: true });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'player-block');
  assert.deepEqual(r.actions.map(a => a.type), ['pauseCore', 'persist']);
  // retry runs once, then a fourth failure stops the session as player-block
  let at = T0 + 120_000;
  let s = r.state;
  for (let i = 0; i < 3; i++) {
    at += 61_000;
    const back = tick(s, at, { playerBlocked: false });
    assert.equal(back.state.phase, 'running', 'retry ' + i);
    s = back.state;
    at += 1000;
    const held = tick(s, at, { playerBlocked: true });
    assert.equal(held.state.pauseReason, 'player-block');
    s = held.state;
  }
  const stop = tick(s, at + 61_000, { playerBlocked: false });
  assert.equal(stop.state.stopReason, 'player-block');
});

test('no prompt and no dial 90 s after a catch pauses as cast-stall, not no-catch', () => {
  let { state } = reduce(createState(), { type: 'start', at: T0 });
  ({ state } = tick(state, T0 + 10_000, { catches: 1 }));
  const r = tick(state, T0 + 10_000 + 95_000, { sinceBubbleMs: 95_000, sinceDialMs: 95_000 });
  assert.equal(r.state.phase, 'paused');
  assert.equal(r.state.pauseReason, 'cast-stall');
  // without the new telemetry the old 10-minute no-catch still owns the watchdog
  let { state: s2 } = reduce(createState(), { type: 'start', at: T0 });
  const r2 = tick(s2, T0 + 95_000);
  assert.equal(r2.state.phase, 'running');
});

test('the panel passes the new telemetry and names both stalls', () => {
  assert.match(PANEL, /sinceBubbleMs: status && typeof status\.sinceBubbleMs === 'number' \? status\.sinceBubbleMs : null/);
  assert.match(PANEL, /playerBlocked: !!\(status && status\.playerBlocked\)/);
  assert.match(PANEL, /player in the way — move spots or close the profile/);
  assert.match(PANEL, /cast stalled — retrying, check for a profile popup/);
  assert.match(PANEL, /host\.dataset\.playerBlocked = '1'/);
  assert.match(SESSION_SRC, /var CAST_STALL_MS = 90 \* 1000;/);
});
