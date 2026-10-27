'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { place, inflate, intersects, unionRect } = require('../layout.js');

const panel = { w: 260, h: 300 };

test('inflate grows a rect on every side', () => {
  assert.deepEqual(inflate({ x: 10, y: 20, w: 30, h: 40 }, 5), { x: 5, y: 15, w: 40, h: 50 });
});

test('intersects is false for a rect that only touches an edge', () => {
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
  assert.equal(intersects({ x: 0, y: 0, w: 11, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), true);
});

test('unionRect ignores nulls and covers the rest', () => {
  assert.deepEqual(unionRect([null, { x: 10, y: 10, w: 10, h: 10 }, { x: 40, y: 5, w: 5, h: 5 }]),
    { x: 10, y: 5, w: 35, h: 15 });
  assert.equal(unionRect([null, null]), null);
});

test('default placement clears the dial and bubble', () => {
  const exclude = { x: 768, y: 276, w: 200, h: 200 };
  const r = place({ panel, viewport: { w: 1522, h: 954 }, exclude });
  assert.notEqual(r, 'pill');
  assert.ok(r.x >= 0 && r.y >= 0);
  assert.ok(r.x + r.w <= 1522 && r.y + r.h <= 954);
  assert.equal(intersects(r, exclude), false);
});

test('placement works at the second measured viewport too', () => {
  // 1620x1031: dial (813,407) r~90, bubble (810,358) 108x50
  const exclude = unionRect([
    inflate({ x: 813 - 90, y: 407 - 90, w: 180, h: 180 }, 12),
    inflate({ x: 810 - 54, y: 358 - 25, w: 108, h: 50 }, 12)
  ]);
  const r = place({ panel, viewport: { w: 1620, h: 1031 }, exclude });
  assert.notEqual(r, 'pill');
  assert.equal(intersects(r, exclude), false);
  assert.ok(r.x + r.w <= 1620 && r.y + r.h <= 1031);
});

test('falls back to the pill when the viewport cannot hold both', () => {
  const r = place({ panel, viewport: { w: 320, h: 200 }, exclude: { x: 0, y: 0, w: 320, h: 200 } });
  assert.equal(r, 'pill');
});

test('a panel dragged over the dial is pushed out', () => {
  const exclude = { x: 700, y: 300, w: 260, h: 200 };
  const r = place({ panel, viewport: { w: 1522, h: 954 }, exclude, preferred: { x: 720, y: 320, w: 260, h: 300 } });
  assert.notEqual(r, 'pill');
  assert.equal(intersects(r, exclude), false);
});

test('a preferred spot that is already clear is kept', () => {
  const exclude = { x: 700, y: 300, w: 260, h: 200 };
  const preferred = { x: 20, y: 40, w: 260, h: 300 };
  assert.deepEqual(place({ panel, viewport: { w: 1522, h: 954 }, exclude, preferred }), { x: 20, y: 40, w: 260, h: 300 });
});
