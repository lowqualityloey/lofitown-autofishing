'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 3.9.41 hides the CAST!/REEL! bubble during a focus-session hold by clearing its rect in the
// post-render hook: a scissor plus a colour clear of the game's own pixels, not an overlay. These
// guards exist because two mistakes here are invisible until the live game shows them: a clear on
// the world canvas leaves a hole in the scenery, and a clear at the wrong moment is painted over by
// the game in the same frame. The clear itself is exercised against a fake GL context.
const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');

function slice(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, start + ' is missing');
  const b = src.indexOf(end, a);
  assert.ok(b > a, end + ' is missing');
  return src.slice(a, b);
}

function fakeGl(calls, opts) {
  const o = opts || {};
  return {
    drawingBufferWidth: o.bw || 100,
    drawingBufferHeight: o.bh || 50,
    SCISSOR_TEST: 1,
    COLOR_BUFFER_BIT: 2,
    COLOR_CLEAR_VALUE: 3,
    SCISSOR_BOX: 4,
    scissorOn: !!o.scissorOn,
    isEnabled(p) { return p === 1 ? this.scissorOn : false; },
    getParameter(p) { return p === 3 ? [0, 0, 0, 1] : [4, 5, 6, 7]; },
    enable() { calls.push('enable'); },
    disable() { calls.push('disable'); },
    scissor(x, y, w, h) { calls.push('scissor:' + [x, y, w, h].join(',')); },
    clearColor(r, g, b, a) { calls.push('clearColor:' + [r, g, b, a].join(',')); },
    clear(m) { calls.push('clear:' + m); },
  };
}

function loadClear() {
  const body = slice(CORE, 'function clearPromptRect(', 'function maskTick(');
  const F = { maskStats: { on: false, clears: 0, skips: 0, path: 'none', lastError: null } };
  const fn = new Function('F', body + '\nreturn clearPromptRect;')(F);
  return { fn, F };
}

test('the clear is a scissor and a colour clear, flipped to GL\'s bottom-left origin', () => {
  const { fn, F } = loadClear();
  const calls = [];
  // rect (10,5,20,10) in a 100x50 surface: GL y = 50 - (5 + 10) = 35, not 5
  assert.equal(fn(fakeGl(calls), { width: 100, height: 50 }, { x: 10, y: 5, w: 20, h: 10 }), true);
  assert.deepEqual(calls.filter((c) => c.startsWith('scissor:')), ['scissor:10,35,20,10']);
  assert.ok(calls.includes('clear:2'), 'the colour buffer is cleared');
  assert.ok(calls.includes('clearColor:0,0,0,0'), 'the clear is transparent, so the world shows through');
  assert.equal(F.maskStats.clears, 1);
});

test('the game\'s own GL state is restored after the clear', () => {
  const { fn } = loadClear();
  const calls = [];
  fn(fakeGl(calls), { width: 100, height: 50 }, { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(calls[calls.length - 2], 'clearColor:0,0,0,1', 'the previous clear colour is put back');
  assert.equal(calls[calls.length - 1], 'disable', 'the scissor is turned off again');
});

test('a scissor the game had enabled is restored, not switched off', () => {
  const { fn } = loadClear();
  const calls = [];
  fn(fakeGl(calls, { scissorOn: true }), { width: 100, height: 50 }, { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(calls[calls.length - 1], 'scissor:4,5,6,7', 'the original box comes back');
});

test('a rect outside the surface is refused rather than clamped', () => {
  const { fn, F } = loadClear();
  const calls = [];
  assert.equal(fn(fakeGl(calls), { width: 100, height: 50 }, { x: 95, y: 0, w: 20, h: 10 }), false);
  assert.equal(F.maskStats.skips, 1);
  assert.deepEqual(calls, [], 'nothing is cleared when the rect does not fit');
});

test('the mask only ever clears the surface the bot reads', () => {
  const tick = slice(CORE, 'function maskTick(', 'F.setPromptMask =');
  assert.match(tick, /if \(canvas !== uiCanvas\) return;/, 'another canvas is left alone');
  assert.match(tick, /webglFor\(canvas\)/, 'the clear uses the canvas it just drew');
});

test('the world canvas is never cleared: a hole in the scenery is not a reveal', () => {
  const target = slice(CORE, 'function maskTarget(', 'function clearPromptRect(');
  assert.match(target, /world && world === uiCanvas/, 'the merged layout is recognised');
  assert.match(target, /return null;/, 'and the mask refuses');
});

test('the post-render wrapper runs the mask for every canvas it draws, before detection', () => {
  const wrap = slice(CORE, 'const wrapped = function () {', 'wrapped.__autofishPostRender = true;');
  const maskAt = wrap.indexOf('owner._maskTick(this.canvas)');
  assert.ok(maskAt > 0, 'the wrapper calls the mask');
  assert.ok(maskAt < wrap.indexOf('owner._postTick()'), 'the clear lands before the detector reads');
  // Not gated on the app canvas: the prompt layer has its own canvas and its own draw.
  assert.match(wrap, /\n      if \(owner && this && this\.canvas && typeof owner\._maskTick === 'function'\) owner\._maskTick\(this\.canvas\);/);
});

test('both install paths hand the wrapper a mask tick', () => {
  assert.equal((CORE.match(/F\._maskTick = maskTick;/g) || []).length, 2, 'adoption and a fresh wrap');
});

test('null disarms, and a probe arm keeps the rect it already resolved', () => {
  const api = slice(CORE, 'F.setPromptMask = function (spec) {', 'F.promptMask = function () {');
  assert.match(api, /if \(!spec\) \{/, 'null disarms');
  assert.match(api, /F\._mask = null;/, 'disarm drops the rect');
  assert.match(api, /const target = maskTarget\(\);/, 'arming asks whether the surface is safe');
  assert.match(api, /spec\.resolve && F\._mask && F\._mask\.rect/, 'a resolved rect survives a re-arm');
});

test('with no rect the mask finds the prompt itself, before it clears', () => {
  const tick = slice(CORE, 'function maskTick(', 'F.setPromptMask =');
  assert.match(tick, /if \(!m\.rect && m\.resolve\)/, 'only a missing rect is probed for');
  assert.match(tick, /m\.probeAt/, 'the probe is throttled');
  const probeAt = tick.indexOf('probePromptRect()');
  const clearAt = tick.indexOf('clearPromptRect(gl');
  assert.ok(probeAt > 0 && clearAt > probeAt, 'the read happens before the clear, never after it');
  const probe = slice(CORE, 'function probePromptRect(', 'F.setPromptMask =');
  assert.match(probe, /snapshot\(\)/, 'the cheap quarter-scale gate answers first');
  assert.match(probe, /bubbleGate\(\)/);
  assert.match(probe, /bubbleInBox\(\)/);
  assert.match(probe, /return \{ x: b\.cx - b\.w \/ 2/, 'the rect is the prompt box, like zones().bubble');
});

test('the toggle flips the setting before the hold, or the next tick re-engages it', () => {
  const btn = slice(PANEL, "focusToggle.addEventListener('click'", '});');
  const prefAt = btn.indexOf('focusPref = !focusOn;');
  const armAt = btn.indexOf('setFocusMode(focusPref);');
  assert.ok(prefAt > 0 && armAt > prefAt, 'the setting changes before the hold, or focusTick re-engages it');
  assert.match(btn, /savePrefs\(\);/, 'the setting is persisted');
});

test('the focus hold arms and clears the mask, and its pause is untouched', () => {
  const set = slice(PANEL, 'function setFocusMode(', 'function focusTick(');
  assert.match(set, /applyPromptMask\(\);/, 'engaging arms the mask');
  assert.match(set, /clearPromptMask\(\);/, 'releasing disarms it');
  assert.match(set, /if \(state\.phase === 'running'\) dispatch/, 'engaging pauses a live run');
  assert.equal((set.match(/dispatch\(/g) || []).length, 2, 'still exactly a pause and a resume');
  assert.match(set, /dispatch\(\{ type: 'pause', at: Date\.now\(\), reason: 'focus' \}\);/);
  assert.match(set, /if \(state\.pauseReason === 'focus'\) dispatch\(\{ type: 'resume', at: Date\.now\(\) \}\);/);
});

test('the rect is refreshed while the hold is engaged, and never invented', () => {
  const tick = slice(PANEL, 'function focusTick()', 'function applyPromptMask()');
  assert.match(tick, /if \(focusOn\) applyPromptMask\(\);/);
  const apply = slice(PANEL, 'function applyPromptMask()', 'function clearPromptMask()');
  assert.match(apply, /window\.__fish\.zones\(\)/, 'the rect comes from the detector');
  assert.match(apply, /z && z\.bubble \? z\.bubble : \{ resolve: true \}/, 'no detected prompt means the core resolves it');
});

test('unmounting the panel removes the mask from the page', () => {
  const un = slice(PANEL, 'function unmount()', 'mount();');
  assert.match(un, /clearPromptMask\(\);/, 'a removed panel must not keep erasing the game');
});
