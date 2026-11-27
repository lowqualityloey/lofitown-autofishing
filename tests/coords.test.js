'use strict';
/**
 * Every detector reads the UI canvas in backing-store pixels; elementFromPoint, PointerEvent and
 * the panel's exclusion rect are in CSS pixels. These are the same only while the canvas is 1:1
 * with its box, so the boundary now converts instead of assuming. At the measured dpr the
 * conversion is the identity, which is the test that it cannot move a press that already worked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const T = require('../src/vision.js');

test('cssPoint is the identity when the canvas matches its CSS box', () => {
  assert.deepEqual(
    T.cssPoint(840, 411, { left: 0, top: 0, w: 1680, h: 1031, cw: 1680, ch: 1031 }),
    { x: 840, y: 411 }
  );
});

test('cssPoint maps a scaled backing store back into the CSS box', () => {
  assert.deepEqual(
    T.cssPoint(840, 411, { left: 0, top: 0, w: 840, h: 515.5, cw: 1680, ch: 1031 }),
    { x: 420, y: 205.5 }
  );
});

test('cssPoint adds the canvas offset, and a missing frame changes nothing', () => {
  assert.deepEqual(
    T.cssPoint(10, 20, { left: 7, top: 11, w: 100, h: 200, cw: 200, ch: 400 }),
    { x: 12, y: 21 }
  );
  assert.deepEqual(T.cssPoint(840, 411, null), { x: 840, y: 411 });
  assert.deepEqual(T.cssPoint(840, 411, { left: 0, top: 0, w: 0, h: 0, cw: 0, ch: 0 }), { x: 840, y: 411 });
});

test('the DOM boundaries both convert: the press point and the exclusion rects', () => {
  assert.match(SRC, /function uiFrame\(\)/);
  assert.match(SRC, /const p = cssPoint\(x, y, uiFrame\(\)\);/);
  const zones = SRC.slice(SRC.indexOf('F.zones = function'), SRC.indexOf('F.zones = function') + 1400);
  assert.match(zones, /cssPoint\(x, y, f\)/, 'zones are compared with CSS pixels, so they must be CSS rects');
  assert.match(SRC, /pxScale:/, 'status must expose the ratio it used');
});
