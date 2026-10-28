'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Measured live 2026-10-28: an occluded window had its animation frames suspended while
// document.visibilityState still read "visible". The loop simply stopped, status() kept reporting
// running: true, and the session charged 10.7 minutes of budget for frames that never happened.
// Nothing inside a dead loop can notice that, so a one-second interval watches the tick clock.

const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const SESSION = fs.readFileSync(path.join(__dirname, '..', 'session.js'), 'utf8');

function slice(from, to) {
  const a = CORE.indexOf(from);
  assert.ok(a >= 0, from + ' is missing');
  const b = CORE.indexOf(to, a);
  assert.ok(b > a, to + ' is missing after ' + from);
  return CORE.slice(a, b);
}

test('the loop records every tick, so a silent stall can be told from a slow one', () => {
  const step = slice('function step() {', 'if (document.visibilityState');
  assert.match(step, /F\.lastTickAt = t;/, 'step() must stamp the tick clock');
});

test('a missing frame is noticed, counted and logged once', () => {
  assert.match(CORE, /const STALL_MS = 2000;/, 'the stall threshold is missing');
  const fn = slice('function checkStall()', 'function step() {');
  assert.match(fn, /document\.visibilityState !== 'visible'/, 'a hidden tab is not a stall: the game is frozen by design');
  assert.match(fn, /age <= STALL_MS/);
  assert.match(fn, /F\.stalled = true;/);
  assert.match(fn, /F\.stats\.stalls = \(F\.stats\.stalls \|\| 0\) \+ 1;/, 'the stall is counted');
  // inside `if (!F.stalled)`, so a stall that lasts an hour is one line in the log, not 3600
  assert.match(fn, /if \(!F\.stalled\) \{[^}]*L\('loop stalled'/, 'the stall is logged once, when it starts');
});

test('the repair re-arms the frame and cannot start a second loop', () => {
  const fn = slice('function checkStall()', 'function step() {');
  assert.match(fn, /cancelAnimationFrame\(F\._raf\)/, 'a late frame must be dropped, or the loop doubles');
  assert.match(fn, /F\._raf = requestAnimationFrame\(loop\)/, 'the frame has to be re-armed');
});

test('the watchdog runs with the core and stops with it', () => {
  const start = slice('F.start = function (opts)', 'F.stop = function ()');
  assert.match(start, /F\._stallTimer = setInterval\(checkStall, 1000\)/);
  assert.match(start, /F\.lastTickAt = now\(\); F\.stalled = false;/);
  const stop = slice('F.stop = function ()', 'F.pause = function ()');
  assert.match(stop, /clearInterval\(F\._stallTimer\)/, 'a stopped core must not keep the watchdog alive');
  assert.match(stop, /F\.stalled = false;/);
});

test('status() exposes the stall, so anything outside the loop can see it', () => {
  const status = slice('F.status = function ()', 'accuracy: {');
  assert.match(status, /stalled: !!F\.stalled/);
  assert.match(status, /lastTickAgoMs:/);
});

test('the panel says stalled instead of running', () => {
  assert.match(PANEL, /var stalled = !!\(status && status\.running && status\.stalled\);/);
  assert.match(PANEL, /ui\.chip\.textContent = stalled \? 'stalled' : phase;/, 'the chip must not keep saying running');
  assert.match(PANEL, /'dot ' \+ \(stalled \? 'stalled' : phase\)/);
  assert.match(PANEL, /var stallNote = stalled \? 'loop stalled/, 'the red line names the stall');
  assert.match(PANEL, /if \(stallNote\) ui\.banner\.className = 'banner stall'/);
  assert.match(PANEL, /\.banner\.stall\{color:#ffb3b3/, 'the stall line is red');
  assert.match(PANEL, /host\.dataset\.stalled = '1'/, 'the state is observable from outside the shadow root');
});

test('a stalled tick does not charge the session clock', () => {
  assert.match(PANEL, /stalled: !!\(status && status\.running && status\.stalled\)/, 'the tick fact must carry the stall');
  // the tick branch is the LAST credit (stopSession() credits once too, before it)
  const credit = SESSION.lastIndexOf('s.fishingMs += Math.max(0, at - s.lastTickAt);');
  const stall = SESSION.indexOf('if (fact.stalled === true) {');
  assert.ok(stall > 0, 'the reducer has no stall branch');
  assert.ok(stall < credit, 'the stall branch must come before the time credit');
  assert.match(SESSION, /s\.lastTickAt = at;\s+\/\/ no credit: no frames, no fishing time/);
});
