'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Reading the UI layer is a GPU readback (~2.1 ms per 360x210 read against the live game) and the
// per-pixel PX() helper allocates a 4-element array every call. Doing both once per frame dropped
// the page from 141 fps to 27.6 fps (measured live 2026-10-28), so these guards keep the scan rates
// and the allocation-free loops from creeping back in.

const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');

function fnBody(start) {
  const a = CORE.indexOf(start);
  assert.ok(a >= 0, start + ' is missing');
  const b = CORE.indexOf('\n  }', a);
  assert.ok(b > a, 'the end of ' + start + ' is missing');
  return CORE.slice(a, b);
}

test('the bubble scan is throttled to ~25 Hz idle and ~11 Hz with a dial locked', () => {
  const fn = fnBody('F.findBubble = function ()');
  assert.match(fn, /const t = now\(\);/);
  assert.match(fn, /F\.bubbleScanAt/);
  const m = fn.match(/<\s*\(F\.geo \? (\d+) : (\d+)\)/);
  assert.ok(m, 'the throttle interval is missing');
  assert.ok(Number(m[1]) >= 90, 'a locked dial must not read the layer more than ~11 Hz');
  assert.ok(Number(m[2]) >= 40, 'the idle scan must not read the layer more than ~25 Hz');
});

test('the full-surface prompt scan is throttled to a few Hz', () => {
  const fn = fnBody('function bubbleAnywhere()');
  const m = fn.match(/promptAt < (\d+)/);
  assert.ok(m, 'the prompt scan throttle is missing');
  assert.ok(Number(m[1]) >= 300, 'the whole-surface readback must not run more than ~3 Hz');
});

test('the bubble box scan reads channels by index instead of allocating per pixel', () => {
  const fn = fnBody('function bubbleInBox()');
  assert.ok(!/PX\(/.test(fn), 'bubbleInBox must not call PX() - it allocates an array per pixel');
  assert.ok(!/\[r\.d\[i\]/.test(fn), 'a per-pixel array literal came back');
  assert.match(fn, /d\[i \+ 3\] > 120 && d\[i\] >= 225/, 'the flat white test is missing');
  assert.match(fn, /new Array\(w\)\.fill\(0\)/, 'the single-pass column count is missing');
});

test('the bubble height and width do not shadow the buffer stride', () => {
  const fn = fnBody('function bubbleInBox()');
  assert.ok(!/const w = x - s;/.test(fn), 'the bubble width must not shadow the buffer width');
  assert.ok(!/const h = y1 - y0;/.test(fn), 'the bubble height must not shadow the buffer height');
});
// The dial search, not the dial sample, was the second lag (measured live 2026-10-28): 83 ms per
// lockDial call at 8 calls a second, i.e. two thirds of the main thread whenever no dial was on
// screen. These guards keep the fixed shape: precomputed direction tables, index-only predicates,
// one rim mask per read, and a throttled catch-card scan.

function slice(from, to) {
  const a = CORE.indexOf(from);
  assert.ok(a >= 0, from + ' is missing');
  const b = CORE.indexOf(to, a);
  assert.ok(b > a, to + ' is missing after ' + from);
  return CORE.slice(a, b);
}

test('the dial search counts a rim mask instead of test-allocating per sample', () => {
  const fn = slice('F.lockDial = function (hintX, hintY)', 'F.sample = function');
  assert.match(fn, /rimMask\(r\)/, 'lockDial must mark the rim once');
  assert.match(fn, /rimHits\(mask, r, cx, cy, R, RIM_C20, RIM_S20, 20\)/);
  assert.ok(!/Math\.cos|Math\.sin/.test(fn), 'the direction tables must replace per-sample trig');
  assert.ok(!/PX\(/.test(fn), 'lockDial must not allocate a pixel array per sample');
  assert.ok(!/RIM\(/.test(fn), 'lockDial must read the mask, not the raw predicate');
});

test('the dial sample reads its three rings by index, without per-sample arrays', () => {
  const fn = slice('F.sample = function (geo)', 'function cancelPend');
  assert.ok(!/PX\(/.test(fn), 'F.sample must not allocate a pixel array per sample');
  assert.ok(!/Math\.cos\(|Math\.sin\(/.test(fn), 'F.sample must use the DIAL_/PIN_ tables');
  assert.match(fn, /isRim\(d, \(y \* rw \+ x\) \* 4\)/);
  assert.match(fn, /isGreen\(d, \(y \* rw \+ x\) \* 4\)/);
  assert.match(fn, /isPin\(d, \(y \* rw \+ x\) \* 4\)/);
});

test('the rim helpers are built from tables and read channels by index', () => {
  assert.match(CORE, /const RIM_C20 = new Float64Array\(20\)/);
  assert.match(CORE, /const RIM_C40 = new Float64Array\(40\)/);
  assert.match(CORE, /const DIAL_N = 72/);
  assert.match(CORE, /const PIN_N = PIN_F\.length;/);
  for (const name of ['isRim', 'isGreen', 'isPin', 'rimMask', 'rimHits']) {
    const fn = slice('function ' + name + '(', '\n  }');
    assert.ok(!/PX\(/.test(fn), name + ' must not call PX()');
    assert.ok(!/\[d\[i\]/.test(fn), name + ' must not build a pixel array');
  }
  const mix = slice('function inkMix(r)', 'let promptAt = 0;');
  assert.ok(!/PX\(/.test(mix), 'inkMix must not allocate a pixel array per pixel');
});

test('the catch-card scan is throttled to about 10 Hz', () => {
  const fn = slice('F.findCatch = function ()', 'F.lockDial = function (');
  const m = fn.match(/cardCheckMs \|\| (\d+)/);
  assert.ok(m, 'the card-scan throttle is missing');
  assert.ok(Number(m[1]) >= 100, 'a card waits for a tap; there is nothing to win by scanning faster');
});

// A white blob is not always the cast button. Measured live 2026-10-28: a false-positive bubble was
// tapped every ~0.9 s for 60+ s with no cast, because the bubble branch returns before the cast
// retry. These guards keep the bounded recovery ladder (click -> keybind -> stand up) wired in.

test('the bubble branch escalates instead of tapping the same blob forever', () => {
  const btn = CORE.indexOf('const b = F.findBubble();');
  assert.ok(btn > 0, 'the bubble branch is missing');
  const branch = CORE.slice(btn, btn + 2400);
  assert.match(branch, /const rung = \(F\.bubbleMiss = \(F\.bubbleMiss \|\| 0\) \+ 1\);/);
  assert.match(branch, /castRecovery\(rung\)/);
  assert.match(branch, /if \(rec\.tap\)/);
  assert.match(branch, /if \(rec\.space\)/);
  // a plain unconditional tap() is what caused the stall
  assert.doesNotMatch(branch, /\n\s{8}tap\(b\.cx, b\.cy\);/);
});

test('a locked dial resets the recovery ladder, so the next cast starts at rung one', () => {
  const m = CORE.match(/F\.bubbleMiss = 0; F\.stallRetry = 0;[^\n]*the ladder worked[^\n]*/);
  assert.ok(m, 'the dial lock must reset bubbleMiss and stallRetry');
  const lock = CORE.indexOf("L('dial locked'");
  assert.ok(lock > m.index, 'the reset has to happen when the lock succeeds');
  assert.ok(lock - m.index < 900, 'the reset belongs next to the lock');
});

test('the cast retry uses the same ladder, so a stall with no bubble still stands up', () => {
  const at = CORE.indexOf("L('cast retry'");
  assert.ok(at > 0);
  const around = CORE.slice(at - 700, at + 60);
  assert.match(around, /castRecovery\(rung\)/);
});

// Fishing in this game is seat-based: the cast prompt is emitted only by the sit-down path
// (isRaycastHittingWater -> showCastButton) and by the post-fish result. A walk stands the character
// up, i.e. it destroys the only thing that produces the prompt - measured live 2026-10-28 it walked
// the character behind a building instead of recovering anything.

test('no movement key is ever synthesised - sitting is what makes a cast possible', () => {
  assert.doesNotMatch(CORE, /walkNudge\(/);
  assert.doesNotMatch(CORE, /function clearWalk/);
  assert.doesNotMatch(CORE, /\.walk\b/);
  assert.doesNotMatch(CORE, /walkHoldMs/);
});

test('a missing cast prompt is named, not clicked at forever', () => {
  assert.match(CORE, /seatWatchdogMs: \d+/);
  assert.match(CORE, /L\('needs a seat'/);
  assert.match(CORE, /F\.needsSeat = true;/);
  // the flag has to clear again once a prompt or a dial proves the character is seated
  assert.match(CORE, /F\.needsSeat = false;[^\n]*the character is seated/);
  assert.match(CORE, /F\.needsSeat = false;[^\n]*the cast took/);
  const status = CORE.slice(CORE.indexOf('F.status = function'), CORE.indexOf('F.status = function') + 1600);
  assert.match(status, /needsSeat:/);
});

test('the ladder counts cast attempts, not frames', () => {
  // Counting frames ran the rung to 4567 in one second and left the bot walking instead of clicking.
  const btn = CORE.indexOf('const b = F.findBubble();');
  const branch = CORE.slice(btn, btn + 1800);
  const gate = branch.indexOf('if (t - F.lastPress > F.opts.bubbleDebounceMs) {');
  assert.ok(gate > 0, 'the debounce gate is missing');
  const rung = branch.indexOf('const rung = (F.bubbleMiss = (F.bubbleMiss || 0) + 1);');
  assert.ok(rung > gate, 'the rung must only advance once per cast attempt (inside the debounce gate)');
});
