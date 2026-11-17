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

test('null disarms, and a re-arm keeps the rects it already has', () => {
  const api = slice(CORE, 'F.setPromptMask = function (spec) {', 'F.promptMask = function () {');
  assert.match(api, /if \(!spec\) \{/, 'null disarms');
  assert.match(api, /F\._mask = null;/, 'disarm drops the rects');
  assert.match(api, /if \(!maskTarget\(\)\) \{/, 'arming asks whether the surface is safe');
  assert.match(api, /const keep = F\._mask;/, 'a re-arm keeps the armed state');
  assert.match(api, /rects: \(keep && keep\.rects\) \|\| null/, 'including the rects it resolved');
  assert.match(api, /probeAt: \(keep && keep\.probeAt\) \|\| 0/, 'and the probe clock, so a re-arm does not force a probe');
});

test('arming sets up the surface and the hook a paused core never installs', () => {
  const api = slice(CORE, 'F.setPromptMask = function (spec) {', 'F.promptMask = function () {');
  const liveAt = api.indexOf('ensureMaskLive();');
  const targetAt = api.indexOf('maskTarget()');
  assert.ok(liveAt > 0 && targetAt > liveAt, 'the setup runs before the surface is judged');
  const fn = slice(CORE, 'function ensureMaskLive()', 'function maskTarget(');
  assert.match(fn, /if \(!uiCanvas \|\| !uiCanvas\.isConnected \|\| !uiCanvas\.width\) surfaces\(\);/, 'a page that never fished has no read surface');
  assert.match(fn, /if \(!F\._postRender\) installPostRender\(\);/, 'and no render hook to run the clear from');
});

/**
 * A page that has never fished, built from the real core: two canvases (the Pixi renderer's world and
 * the prompt overlay), a renderer whose render() lives on its prototype, and no scan yet - so the
 * read surface is unresolved and no hook exists. The functions under test are the core's own, not
 * copies, so this exercises the setup instead of the text that asks for it.
 */
function maskSandbox() {
  const world = { width: 1179, height: 822, isConnected: true };
  const overlay = {
    width: 1179, height: 822, isConnected: true,
    parentElement: { className: 'absolute inset-0 pointer-events-none' },
  };
  const proto = { render() { return 'drawn'; } };
  const renderer = Object.create(proto);
  renderer.canvas = world;
  const win = { __PIXI_DEVTOOLS__: { app: { renderer: renderer } } };
  const doc = { querySelectorAll() { return [world, overlay]; } };
  const ticks = [];
  const events = [];
  const body = [
    'let uiCanvas = null, gameCanvas = null, snapAt = 0;',
    'const now = function () { return 1; };',
    'const L = function (name) { events.push(name); };',
    'const postRenderTick = function () {};',
    'const maskTick = function (canvas) { ticks.push(canvas); };',
    'const F = { _mask: null, maskStats: { on: false, clears: 0, skips: 0, probes: 0, resolved: 0, path: "none", lastError: null } };',
    slice(CORE, 'function surfaces()', 'function inkStats('),
    slice(CORE, 'function renderProto()', 'function installPostRender('),
    slice(CORE, 'function installPostRender()', '/* ------------------------------------------- focus prompt mask'),
    slice(CORE, 'function ensureMaskLive()', 'function maskTarget('),
    slice(CORE, 'function maskTarget()', 'function clearPromptRect('),
    slice(CORE, 'F.setPromptMask = function (spec) {', 'F.promptMask = function () {'),
    'return { F: F, ticks: ticks, events: events, proto: proto, world: world, overlay: overlay, target: maskTarget, arm: F.setPromptMask, surface: function () { return uiCanvas; } };',
  ].join('\n');
  return new Function('window', 'document', 'events', 'ticks', 'proto', 'world', 'overlay', body)(
    win, doc, events, ticks, proto, world, overlay);
}

test('arming on a page that never scanned resolves the surface and installs the hook', () => {
  const box = maskSandbox();
  assert.equal(box.surface(), null, 'a page that has never fished has no read surface yet');
  assert.equal(box.target(), null, 'so there is nothing safe to clear');

  assert.equal(box.arm({ resolve: true }), true, 'the arm itself succeeds');
  assert.equal(box.surface(), box.overlay, 'the prompt overlay became the read surface');
  assert.equal(box.target(), box.overlay, 'and the mask may clear it');
  assert.equal(box.F._mask && box.F._mask.resolve, true, 'the mask is armed to resolve its own rect');

  assert.equal(box.F._postRender, true, 'the post-render hook is installed, not merely remembered');
  assert.equal(typeof box.proto.render.__autofishHook, 'object', 'the renderer prototype is wrapped');
  assert.ok(box.events.indexOf('post-render hook') >= 0, 'the install is recorded like every other hook');

  box.proto.render.call({ canvas: box.overlay });
  assert.deepEqual(box.ticks, [box.overlay], 'a draw reaches the mask with the canvas it just drew');

  const wrapped = box.proto.render;
  box.arm({ resolve: true });
  assert.equal(box.proto.render, wrapped, 'a re-arm does not wrap the prototype twice');
});

test('the mask hides every element on the UI layer, at its own bounds', () => {
  const tick = slice(CORE, 'function maskTick(', 'F.setPromptMask =');
  assert.match(tick, /uiRects\(\)/, 'the rects come from the frame');
  const probeAt = tick.indexOf('uiRects()');
  const clearAt = tick.indexOf('clearPromptRect(gl');
  assert.ok(probeAt > 0 && clearAt > probeAt, 'the read happens before the clear, never after it');
  assert.match(tick, /for \(let i = 0; i < m\.rects\.length; i\+\+\) clearPromptRect/, 'every element on the layer is cleared');
  const probe = slice(CORE, 'function uiRects()', 'F.setPromptMask =');
  assert.match(probe, /snapshot\(\)/, 'the cheap quarter-scale gate answers first');
  assert.match(probe, /blobs\(ANY_INK, 6\)/, 'the elements are the blobs the game painted');
  assert.match(probe, /readUI\(/, 'each is measured at full resolution');
  assert.match(probe, /out\.push\(\{ x: wr\.x \+ x0, y: wr\.y \+ y0, w: x1 - x0 \+ 1, h: y1 - y0 \+ 1 \}\)/, 'the rect ends on the sprite edge');
});

test('the refinement turns the measured blobs into the sprites own bounds', () => {
  // Live 2026-11-17 at 1179x822: the prompt sprite and the lure button on the UI layer. Their
  // quarter-scale blobs are what blobs() reports, and their full-res pixels are what readUI returns.
  const sprites = [
    { x: 531, y: 225, w: 114, h: 60 },
    { x: 651, y: 234, w: 48, h: 48 },
  ];
  const S = 4;
  const qblobs = sprites.map(function (s) {
    return {
      x0: Math.floor(s.x / S),
      y0: Math.floor(s.y / S),
      x1: Math.floor((s.x + s.w - 1) / S),
      y1: Math.floor((s.y + s.h - 1) / S),
      count: 1,
    };
  });
  const body = [
    'const SDOWN = 4;',
    'const near4 = new Int32Array(4);',
    'const INK_ALPHA = 24;',
    'let rectSeen = null, rectStack = null;',
    'const uiCanvas = { width: 1179, height: 822 };',
    'const ANY_INK = function () { return true; };',
    'const snapshot = function () { return true; };',
    'const blobs = function () { return QBLOBS; };',
    // The real readUI returns the window's pixels top-down; a sprite pixel is at its canvas coords.
    'const readUI = function (x, y, w, h) {',
    '  const d = new Uint8Array(w * h * 4);',
    '  for (let yy = 0; yy < h; yy++) {',
    '    for (let xx = 0; xx < w; xx++) {',
    '      const cx = x + xx, cy = y + yy;',
    '      for (let i = 0; i < SPRITES.length; i++) {',
    '        const s = SPRITES[i];',
    '        if (cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h) { d[(yy * w + xx) * 4 + 3] = 255; break; }',
    '      }',
    '    }',
    '  }',
    '  return { d: d, w: w, h: h, x: x, y: y };',
    '};',
    slice(CORE, 'function uiRects()', 'F.setPromptMask ='),
    'return uiRects();',
  ].join('\n');
  assert.deepEqual(
    new Function('QBLOBS', 'SPRITES', body)(qblobs, sprites),
    sprites,
    'the padded windows overlap, yet each rect is exactly its own sprite'
  );
});

test('the refinement flood reuses its buffers instead of allocating per pass', () => {
  const fn = slice(CORE, 'let rectSeen = null, rectStack = null;', 'F.setPromptMask =');
  assert.match(fn, /let rectSeen = null, rectStack = null;/, 'both scratch buffers live outside the pass');
  assert.match(fn, /const stack = rectStack;/, 'the flood runs on the shared stack');
  assert.ok(!fn.includes('const stack = [seed]'), 'no array is grown per component');
  assert.match(fn, /stack\[top\+\+\] = seed;/, 'the seed enters the preallocated stack');
});

test('a draw clears every rect the probe found, not just the first', () => {
  const body = [
    'let uiCanvas = { width: 100, height: 50 };',
    'const now = function () { return 1000; };',
    'const webglFor = function () { return gl; };',
    'const uiRects = function () { return [{ x: 10, y: 5, w: 20, h: 10 }, { x: 50, y: 5, w: 10, h: 10 }]; };',
    'const F = { _mask: { resolve: true, rects: null, probeAt: 0 }, maskStats: { on: true, clears: 0, skips: 0, probes: 0, resolved: 0, rects: 0, path: "none", lastError: null } };',
    slice(CORE, 'function clearPromptRect(', 'function maskTick('),
    slice(CORE, 'function maskTick(', '  /** Any pixel the game actually painted'),
    'return { tick: maskTick, F: F, ui: uiCanvas };',
  ].join('\n');
  const calls = [];
  const box = new Function('gl', body)(fakeGl(calls));
  box.tick(box.ui);
  assert.deepEqual(
    calls.filter(function (c) { return c.indexOf('scissor:') === 0; }),
    ['scissor:10,35,20,10', 'scissor:50,35,10,10'],
    'both elements are cleared in the one draw'
  );
  assert.equal(box.F.maskStats.rects, 2);
  assert.equal(box.F.maskStats.probes, 1);
});

function maskTickSandbox(probe) {
  const body = [
    'let uiCanvas = { width: 100, height: 50 };',
    'let t = 1000;',
    'const now = function () { return t; };',
    'const probe = { v: PROBE };',
    'const webglFor = function () { return gl; };',
    'const uiRects = function () { return probe.v; };',
    'const F = { _mask: { resolve: true, rects: null, probeAt: 0 }, maskStats: { on: true, clears: 0, skips: 0, probes: 0, resolved: 0, rects: 0, path: "none", lastError: null } };',
    slice(CORE, 'function clearPromptRect(', 'function maskTick('),
    slice(CORE, 'function maskTick(', '  /** Any pixel the game actually painted'),
    'F.maskStats.dropped = 0;',
    'return { tick: maskTick, F: F, ui: uiCanvas, probe: probe, next: function () { t += 400; } };',
  ].join('\n');
  const calls = [];
  const box = new Function('gl', 'PROBE', body)(fakeGl(calls), probe);
  return {
    box: box,
    next() { box.next(); box.tick(box.ui); },
    scissors() { return calls.filter(function (c) { return c.indexOf('scissor:') === 0; }); },
  };
}

test('two empty probes drop the armed rects, so a stale rect cannot erase a later element', () => {
  const h = maskTickSandbox([{ x: 10, y: 5, w: 20, h: 10 }]);
  h.next();
  assert.equal(h.scissors().length, 1, 'the found rect is cleared');
  assert.equal(h.box.F._mask.rects.length, 1);

  h.box.probe.v = [];               // the layer went blank: prompt dismissed, view changed
  h.next();
  assert.equal(h.box.F._mask.rects.length, 1, 'one empty probe is a timing artefact, not proof');
  assert.equal(h.scissors().length, 2, 'and the rect it had is still cleared meanwhile');

  h.next();
  assert.equal(h.box.F._mask.rects, null, 'the second empty probe drops it');
  assert.equal(h.box.F.maskStats.dropped, 1);
  assert.equal(h.box.F.maskStats.rects, 0);

  const before = h.scissors().length;
  h.next();
  assert.equal(h.scissors().length, before, 'nothing is erased once the rects are dropped');
  assert.equal(h.box.F._mask.rects, null, 'and an empty layer does not re-arm itself');
});

test('an unreadable probe holds its rects instead of dropping them', () => {
  const h = maskTickSandbox([{ x: 10, y: 5, w: 20, h: 10 }]);
  h.next();
  h.box.probe.v = null;             // canvases getting replaced: no evidence either way
  h.next();
  h.next();
  h.next();
  assert.equal(h.box.F._mask.rects.length, 1, 'a probe that could not read proves nothing');
  assert.equal(h.box.F.maskStats.dropped, 0);
  assert.equal(h.box.F._mask.empty, 0, 'and does not advance the empty streak');
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

test('the hold says only "hide", and the core finds the elements itself', () => {
  const tick = slice(PANEL, 'function focusTick()', 'function applyPromptMask()');
  assert.match(tick, /if \(focusOn\) applyPromptMask\(\);/);
  const apply = slice(PANEL, 'function applyPromptMask()', 'function clearPromptMask()');
  assert.match(apply, /setPromptMask\(\{ resolve: true \}\)/, 'the core resolves every element itself');
  assert.ok(!apply.includes('zones()'), 'the panel no longer passes a detector box');
});

test('unmounting the panel removes the mask from the page', () => {
  const un = slice(PANEL, 'function unmount()', 'mount();');
  assert.match(un, /clearPromptMask\(\);/, 'a removed panel must not keep erasing the game');
});
