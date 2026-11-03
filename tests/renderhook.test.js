'use strict';
/**
 * The game merged the prompt layer into the Pixi/WebGL renderer, and a WebGL buffer is cleared
 * before each draw, so a read taken from requestAnimationFrame sees an empty surface even when the
 * prompt is plainly on screen (measured live 2026-11-02: 965,753 painted pixels on the renderer,
 * 0 on the old UI canvas, yet 222/222 rAF samples read blank while a post-render sample read ink
 * 256/256). Detection now runs from a wrapper around the renderer prototype's render(), and rAF
 * must not feed a pre-render sample into the same state.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const CORE = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');

function block(from, to) {
  const a = CORE.indexOf(from);
  assert.ok(a >= 0, from + ' is missing');
  const b = CORE.indexOf(to, a);
  assert.ok(b > a, to + ' is missing after ' + from);
  return CORE.slice(a, b);
}

const TICK_SRC = block('function postRenderTick() {', '/** The one place a pending diagnostic capture');
const HOOK_SRC = block('function renderProto() {', 'function loop() {');

function mkTick(F, step, shot) {
  return new Function('F', 'now', 'takeShot', 'step', 'L',
    TICK_SRC + '\nreturn postRenderTick;'
  )(F, () => 1000, shot || (() => {}), step || (() => {}), () => {});
}

function makePixi() {
  const log = [];
  function Renderer(canvas) { this.canvas = canvas; }
  Renderer.prototype.render = function (stage) {
    log.push('render ' + this.canvas.id + ' ' + stage);
    return 'drawn ' + stage;
  };
  const app = { renderer: new Renderer({ id: 'game' }) };
  return { app, Renderer, log, win: { __PIXI_DEVTOOLS__: { app } } };
}

function mkHook(win, F) {
  let ticks = 0;
  const api = new Function('window', 'F', 'L', 'now', 'uiCanvas', 'postRenderTick',
    HOOK_SRC + '\nreturn { renderProto: renderProto, installPostRender: installPostRender };'
  )(win, F, () => {}, () => 5000, { width: 100 }, () => { ticks++; });
  return { api, ticks: () => ticks };
}

test('the hook wraps the renderer prototype and ticks after the game has drawn', () => {
  const p = makePixi();
  const F = {};
  const h = mkHook(p.win, F);
  assert.equal(h.api.installPostRender(), true);
  assert.equal(F._postRender, true);
  assert.equal(p.Renderer.prototype.render.__autofishPostRender, true, 'the wrapper is tagged so a restart cannot nest it');
  assert.equal(h.api.installPostRender(), true, 'a second install is a no-op');
  assert.equal(h.ticks(), 0, 'installing must not tick');
  const out = p.app.renderer.render('stage');
  assert.equal(out, 'drawn stage', 'the wrapper must return what the game returned');
  assert.deepEqual(p.log, ['render game stage']);
  assert.equal(h.ticks(), 1, 'detection runs once, after the draw');
});

test('a re-pasted core takes the hook over instead of reporting a dead one', () => {
  const p = makePixi();
  const A = {}, B = {};
  const a = mkHook(p.win, A);
  const b = mkHook(p.win, B);
  assert.equal(a.api.installPostRender(), true);
  assert.equal(b.api.installPostRender(), true, 'the second core adopts the existing wrapper');
  assert.equal(B._postRender, true);
  assert.equal(p.Renderer.prototype.render.__autofishPostRender, true);
  p.app.renderer.render('stage');
  assert.equal(b.ticks(), 1, 'the live core steps after the game draws');
  assert.equal(a.ticks(), 0, 'the stopped core no longer owns the tick');
});

test('a renderer drawing a different canvas does not feed the step', () => {
  const p = makePixi();
  const F = {};
  const h = mkHook(p.win, F);
  h.api.installPostRender();
  const overlay = new p.Renderer({ id: 'overlay' });
  overlay.render('hidden');
  assert.equal(h.ticks(), 0, 'a renderer that is not the app renderer may not trigger detection');
  p.app.renderer.render('again');
  assert.equal(h.ticks(), 1);
});

test('a renderer instance Pixi replaces after a resize is still wrapped', () => {
  const p = makePixi();
  const F = {};
  const h = mkHook(p.win, F);
  h.api.installPostRender();
  const fresh = new p.Renderer({ id: 'game2' });
  p.win.__PIXI_DEVTOOLS__.app = { renderer: fresh };
  fresh.render('after-resize');
  assert.equal(h.ticks(), 1, 'the prototype keeps the hook across instances');
});

test('a prototype that refuses the wrapper is reported, not pretended', () => {
  const p = makePixi();
  Object.defineProperty(p.Renderer.prototype, 'render', {
    value: function () { return 'frozen'; }, writable: false, configurable: true,
  });
  const F = {};
  const h = mkHook(p.win, F);
  assert.equal(h.api.installPostRender(), false);
  assert.ok(!F._postRender, 'a failed install must leave the rAF fallback in charge');
});

test('postRenderTick runs one step per frame, stamps the tick and survives a throwing step', () => {
  const F = { running: true, _rafN: 1, stats: {} };
  let steps = 0, shots = 0;
  const tick = mkTick(F, () => { steps++; }, () => { shots++; });
  tick();
  assert.equal(steps, 1);
  assert.equal(shots, 1, 'a pending diagnostic capture is consumed after the draw');
  assert.equal(F._postAt, 1000);
  tick();
  assert.equal(steps, 1, 'a renderer that draws twice in one frame must not step twice');
  F._rafN = 2;
  tick();
  assert.equal(steps, 2);
  F.running = false;
  F._rafN = 3;
  tick();
  assert.equal(steps, 2, 'a stopped core does not step');
});

test('a step that throws is counted and releases the re-entry guard', () => {
  const F = { running: true, _rafN: 1, stats: { errors: 0 } };
  const tick = mkTick(F, () => { throw new Error('boom'); });
  tick();
  assert.equal(F.stats.errors, 1);
  assert.equal(F._inStep, false, 'a thrown step must not wedge detection');
});

test('the rAF loop does not sample while the render hook is live', () => {
  const loop = CORE.slice(CORE.indexOf('function loop() {'), CORE.indexOf('A stolen animation frame'));
  assert.match(loop, /F\._rafN = \(F\._rafN \|\| 0\) \+ 1;/);
  assert.match(loop, /if \(F\._postRender\) return;/, 'the pre-render slot must be skipped when hooked');
  assert.ok(loop.indexOf('if (F._postRender) return;') < loop.indexOf('step()'),
    'a blank pre-render read must not cancel a press armed by a post-render frame');
  assert.match(loop, /installPostRender\(\)/);
  assert.match(loop, /takeShot\(\)/);
  assert.doesNotMatch(loop, /toDataURL/);
});

test('the hook is installed at start, repaired by the watchdog, and visible in status', () => {
  const start = CORE.slice(CORE.indexOf('F.start = function (opts)'), CORE.indexOf('F.stop = function ()'));
  assert.match(start, /installPostRender\(\)/);
  const stall = CORE.slice(CORE.indexOf('function checkStall()'), CORE.indexOf('function step() {'));
  assert.match(stall, /installPostRender\(\)/, 'a renderer replacement must be re-wrapped');
  assert.match(stall, /F\._postAt/);
  assert.match(CORE, /postRender: !!F\._postRender/);
});

test('the hook is aimed at the prototype, verified, and filtered by canvas', () => {
  assert.match(HOOK_SRC, /hasOwnProperty\.call\(p, 'render'\)/);
  assert.match(HOOK_SRC, /orig\.apply\(this, arguments\)/);
  assert.match(HOOK_SRC, /__autofishPostRender/);
  assert.match(HOOK_SRC, /proto\.render !== wrapped/);
  assert.match(HOOK_SRC, /this\.canvas === app\.renderer\.canvas/);
});
