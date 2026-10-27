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
