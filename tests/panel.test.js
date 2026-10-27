'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// panel.js mounts itself and needs a DOM, so these are source-level guards on the interactions that
// cannot be exercised in node. They exist because a dead-looking-alive button shipped once: the drag
// handler on .head captured the pointer, the browser then computed the click against the host, and
// the collapse button inside the head never fired.
const src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');

test('the collapse button is wired, and the pill brings the panel back', () => {
  assert.match(src, /min\.addEventListener\('click', function \(\) \{ setCollapsed\(true\); \}\)/);
  assert.match(src, /pill\.addEventListener\('click', function \(\) \{ setCollapsed\(false\); \}\)/);
});

test('dragging never steals a click from a button inside the head', () => {
  const startDrag = src.slice(src.indexOf('function startDrag(e)'), src.indexOf('function onDrag(e)'));
  assert.ok(startDrag.indexOf("closest('button')") > 0, 'startDrag must ignore pointerdown on a button');
  // the guard has to run before the capture, or the capture retargets the pointerup anyway
  const captureAt = startDrag.indexOf('host.setPointerCapture(e.pointerId)');
  assert.ok(captureAt > 0, 'startDrag still captures the pointer for real drags');
  assert.ok(
    startDrag.indexOf("closest('button')") < captureAt,
    'the button guard must come before setPointerCapture'
  );
});

test('collapsing actually hides the card and shows the 48px pill', () => {
  assert.match(src, /\.hide\{display:none\}/);
  assert.match(src, /\.pill\{width:48px;height:48px/);
  const setCollapsed = src.slice(src.indexOf('function setCollapsed(next)'), src.indexOf('function startDrag(e)'));
  assert.match(setCollapsed, /ui\.card\.classList\.toggle\('hide', collapsed\)/);
  assert.match(setCollapsed, /ui\.pill\.classList\.toggle\('hide', !collapsed\)/);
  // the choice has to survive a reload
  assert.match(setCollapsed, /pos\.collapsed = collapsed/);
});
test('the session, cooldown and cap steppers reach overnight ranges', () => {
  // the point of the ranges is "leave it fishing while I sleep", so assert the numbers a
  // sleeper needs are actually reachable through the steppers, not just parseable.
  const conf = src.slice(src.indexOf('function keyConf(key)'), src.indexOf('function clamp('));
  const dur = /field: 'durationMs', min: (\d+) \* 60000, max: (\d+) \* 60000/.exec(conf);
  const cool = /field: 'cooldownMs', min: (\d+) \* 60000, max: (\d+) \* 60000/.exec(conf);
  const cap = /field: 'dailyCapMs', min: (\d+) \* 60000, max: (\d+) \* 60000/.exec(conf);
  assert.ok(dur && cool && cap, 'all three steppers declare explicit minute bounds');
  assert.ok(Number(dur[2]) >= 720, 'a session can run at least 12 hours');
  assert.ok(Number(cap[2]) >= 1440, 'the daily cap can cover a full day');
  assert.ok(Number(cool[1]) <= 1, 'the cooldown floor is one minute');
  assert.ok(Number(cap[2]) >= Number(dur[2]), 'the cap must be able to outlast one session, or it stops the run');
});

test('the panel reads the catch ledger for the rarity strip and the last catch', () => {
  // the strip is fed by __fish.log(), never by the live counters: history has to survive a reload
  assert.ok(src.includes('fish().log'), 'renderLog reads the ledger');
  assert.ok(src.includes('TIER_NAMES.map'), 'every rarity tier gets a cell, empty ones included');
  assert.ok(src.includes('renderLog();'), 'render() refreshes the strip');
  const fn = src.slice(src.indexOf('function renderLog('), src.indexOf('function render()'));
  assert.ok(fn.length > 0, 'renderLog exists');
  // a broken or blocked ledger must not take the panel down with it
  assert.ok(fn.includes('catch (e) { book = null; }'), 'renderLog swallows a ledger read failure');
  assert.ok(fn.includes("ui.lastCatch.textContent = bits.join"), 'the last catch line is text, not markup');
});
test('a running session that cannot bite says so: sit down, the game is seat-based', () => {
  // Fishing in lofi.town only starts from the sit-down path (the CAST! prompt is emitted there), so a
  // standing character can never be rescued by clicking. The panel is the only thing the user looks
  // at, so the condition has to be visible there and not just in the event log.
  const fn = src.slice(src.indexOf('function render()'), src.indexOf('/* ------------------------------------------------------------ layout'));
  assert.ok(fn.length > 0, 'render() exists');
  assert.ok(fn.includes('status.needsSeat'), 'render() reads needsSeat from the core status');
  assert.ok(fn.includes("'paused'"), 'the notice also shows while paused, not only while running');
  assert.match(fn, /seatNote \|\| banner/, 'the seat notice outranks the log-offline banner');
  assert.ok(fn.includes("'banner seat'"), 'the seat notice gets its own colour, not the amber warning style');
  assert.ok(fn.includes("host.dataset.needsSeat = '1'"), 'needsSeat is observable from outside the shadow root');
  assert.match(src, /\.banner\.seat\{/, 'the seat style exists');
});

test('the seat fact reaches the reducer so the clock pauses instead of burning', () => {
  // session.js pauses on fact.seat and resumes when it goes false; the panel is the only caller of
  // that reducer, so it must pass the flag on every tick or the pause can never happen.
  assert.ok(src.includes('seat: !!(status && status.needsSeat)'), 'the live tick passes needsSeat as seat');
  assert.ok(src.includes('catches: 0, errors: 0, todayMs: baseTodayMs, seat: false'), 'the cooldown tick passes seat: false');
  assert.ok(src.includes('clock paused'), 'the notice says the clock is paused, not that the run stopped');
  const sessionSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'session.js'), 'utf8');
  assert.ok(sessionSrc.includes("reason === 'seat' ? [] : [{ type: 'pauseCore' }]"), 'a seat pause keeps the core alive to spot the prompt');
  assert.ok(sessionSrc.includes("if (fact.seat === true) return paused(s, at, 'seat')"), 'the runner pauses on the seat fact');
});
