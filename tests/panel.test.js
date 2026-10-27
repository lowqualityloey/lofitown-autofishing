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
