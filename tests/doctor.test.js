'use strict';
/**
 * The doctor is the bot's own diagnosis of why it is or is not fishing. Its acceptance is that it
 * must name the failures this project has actually lived through, fed as the state those builds
 * really reported - otherwise it is decoration.
 */
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const OPEN = '// <doctor-core>';
const CLOSE = '// </doctor-core>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('doctor-core sentinels are missing from autofish.js');
const D = new Function(SRC.slice(a + OPEN.length, b) + '\nreturn { doctor };')();

/** The live 3.9.12 numbers, read from the owner's tab on 2026-11-02. */
const healthy = {
  running: true, paused: false, hidden: false, stalled: false, lastTickAgoMs: 6, postRender: true,
  snapshot: { gl: 3676, canvas2d: 0 },
  readback: { canvas2d: 0, allocMBPerSec: 0.01 },
  longtasks: { inLast10s: 1, maxMs: 91 },
  worstFrameMs: 96, needsSeat: false,
  sincePromptMs: 3000, sinceDialMs: 4000,
  accepted: 43, rejected: 0, acceptRate: 1, dials: 18, held: 10, forced: 6, holdPassesMax: 0.4,
};

test('a healthy run reports fishing or waiting, never a finding', () => {
  const r = D.doctor(healthy);
  assert.equal(r.severity, 'ok', r.verdict);
  assert.equal(r.verdict, 'fishing');
  assert.equal(D.doctor(Object.assign({}, healthy, { sinceDialMs: 20000 })).verdict, 'waiting-bite');
});

test('it names the 3.9.10 snapshot that never ran', () => {
  // Real state: the GL path had bailed out, so the quarter-scale copy came from getImageData about
  // 11 times a second, and nothing in the telemetry said so.
  const r = D.doctor(Object.assign({}, healthy, { snapshot: { gl: 0, canvas2d: 320 } }));
  assert.equal(r.verdict, 'snapshot-fallback');
  assert.equal(r.severity, 'high');
  assert.equal(r.evidence.gl, 0);
});

test('it names the 3.9.11 stall of one 250 ms block every second', () => {
  const r = D.doctor(Object.assign({}, healthy, { longtasks: { inLast10s: 10, maxMs: 285 }, worstFrameMs: 285 }));
  assert.equal(r.verdict, 'frame-stalls');
  assert.equal(r.severity, 'warn');
  assert.equal(r.evidence.inLast10s, 10);
});

test('it names the 3.9.9 first press that waited four rotations', () => {
  // 2500 ms ceiling against a 64 ms pass: several whole turns, not 0.4.
  const r = D.doctor(Object.assign({}, healthy, { holdPassesMax: 3.5, held: 9, forced: 2 }));
  assert.equal(r.verdict, 'timing-held');
  assert.equal(r.evidence.holdPassesMax, 3.5);
});

test('one slow dial is not a finding: the alert is for the pattern, not a single pass', () => {
  // Live 2026-11-02: a healthy 3.9.15 session read 1.03 turns on one slow dial and doctor() then
  // warned for the rest of the run, because the counter is a maximum over the session.
  const r = D.doctor(Object.assign({}, healthy, { holdPassesMax: 1.03 }));
  assert.equal(r.severity, 'ok', r.verdict);
  assert.equal(r.verdict, 'fishing');
});

test('it names every state that stops a run, in priority order', () => {
  assert.equal(D.doctor(Object.assign({}, healthy, { running: false })).verdict, 'idle');
  assert.equal(D.doctor(Object.assign({}, healthy, { stalled: true })).verdict, 'loop-stalled');
  assert.equal(D.doctor(Object.assign({}, healthy, { lastTickAgoMs: 60000 })).verdict, 'loop-stalled');
  assert.equal(D.doctor(Object.assign({}, healthy, { hidden: true })).verdict, 'page-hidden');
  assert.equal(D.doctor(Object.assign({}, healthy, { paused: true })).verdict, 'paused');
  assert.equal(D.doctor(Object.assign({}, healthy, { postRender: false })).verdict, 'path-silent');
  assert.equal(D.doctor(Object.assign({}, healthy, { needsSeat: true })).verdict, 'not-seated');
});

test('a blind detector is only claimed after a real silence', () => {
  // Waiting for a bite is normal and must never read as a finding.
  assert.equal(D.doctor(Object.assign({}, healthy, { sincePromptMs: 12000, sinceDialMs: null })).verdict, 'waiting-bite');
  assert.equal(D.doctor(Object.assign({}, healthy, { sincePromptMs: 90000, sinceDialMs: 90000 })).verdict, 'detector-blind');
});

test('rejected presses are only a finding on a real sample', () => {
  assert.equal(D.doctor(Object.assign({}, healthy, { accepted: 2, rejected: 1, acceptRate: 0.66 })).verdict, 'fishing');
  assert.equal(D.doctor(Object.assign({}, healthy, { accepted: 18, rejected: 6, acceptRate: 0.75 })).verdict, 'press-rejected');
});

test('the bot exposes the verdict and the counters it reads', () => {
  assert.match(SRC, /F\.doctor = function/);
  assert.match(SRC, /new PerformanceObserver/);
  assert.match(SRC, /longtasks: longTaskReport\(\)/);
  assert.match(SRC, /holdPassesMax/);
  assert.match(SRC, /F\.geo\._travel/);
  assert.match(SRC, /watchLongTasks\(\);/);
});
