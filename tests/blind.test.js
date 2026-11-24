'use strict';
// doctor() names `detector-blind` after 45 s, but a real blind run pauses as cast-stall at 90 s
// and keeps retrying. The escalation therefore measures the silence itself, while still allowing
// those two detector pauses. tests/blind.test.js pins the trigger and its session-age cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../session.js');

const PANEL = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const T0 = 1_800_000_000_000;

const base = (over) => Object.assign({
  phase: 'running', pauseReason: null, running: true, stalled: false, visible: true,
  sinceBubbleMs: 180_000, sinceDialMs: 180_000,
  startedAt: T0, now: T0 + 180_000
}, over || {});

test('the blind warning starts at three minutes, not a second before', () => {
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 179_999, sinceDialMs: 200_000, now: T0 + 300_000 })), null, '2:59.999 is still a wait');
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 180_000, sinceDialMs: 200_000, now: T0 + 300_000 })), 180_000, 'exactly three minutes escalates with the newer signal age');
});

test('the blind age is the newer of the last prompt and the last dial', () => {
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 600_000, sinceDialMs: 30_000, now: T0 + 600_000 })), null, 'a prompt 30 s ago means the detector is not blind');
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 181_000, sinceDialMs: 300_000, now: T0 + 400_000 })), 181_000);
});

test('a stale dial from an earlier session cannot blind a fresh run', () => {
  const oldDial = { sinceBubbleMs: null, sinceDialMs: 7_200_000 };
  assert.equal(S.blindWarning(base(Object.assign({ startedAt: T0, now: T0 + 60_000 }, oldDial))), null, 'the session is only one minute old');
  assert.equal(S.blindWarning(base(Object.assign({ startedAt: T0, now: T0 + 180_000 }, oldDial))), 180_000, 'the cap is the session age');
});

test('a reload starts a fresh three-minute clock for the new core', () => {
  const reloaded = { startedAt: T0, now: T0 + 600_000, runAgeMs: 60_000, sinceBubbleMs: null, sinceDialMs: null };
  assert.equal(S.blindWarning(base(reloaded)), null, 'the saved session is old, but the new detector is only one minute old');
  assert.equal(S.blindWarning(base(Object.assign({}, reloaded, { runAgeMs: 180_000 }))), 180_000, 'it warns once the new detector has been silent for three minutes');
  assert.equal(S.blindWarning(base(Object.assign({}, reloaded, { runAgeMs: 60_000, sinceDialMs: 7_200_000 }))), null, 'a stale dial from before the reload cannot count against the new core');
});

test('a cast-stall retry pause does not hide a detector blind for four minutes', () => {
  const paused = base({ phase: 'paused', pauseReason: 'cast-stall', sinceBubbleMs: 240_000, sinceDialMs: 240_000, now: T0 + 240_000 });
  assert.equal(S.blindWarning(paused), 240_000, 'the retry loop is exactly where the escalation is needed');
  assert.equal(S.blindWarning(base({ phase: 'paused', pauseReason: 'no-catch', sinceBubbleMs: 240_000, sinceDialMs: 240_000, now: T0 + 240_000 })), 240_000);
});

test('hidden, stalled, stopped and deliberately paused runs do not warn', () => {
  const off = [
    { visible: false }, { stalled: true }, { running: false },
    { phase: 'idle' },
    { phase: 'paused', pauseReason: 'user' }
  ];
  off.forEach((over) => assert.equal(S.blindWarning(base(over)), null, JSON.stringify(over)));
});

test('a session that has never seen a signal counts from its start', () => {
  assert.equal(S.blindWarning(base({ sinceBubbleMs: null, sinceDialMs: null, startedAt: T0, now: T0 + 179_999 })), null);
  assert.equal(S.blindWarning(base({ sinceBubbleMs: null, sinceDialMs: null, startedAt: T0, now: T0 + 180_000 })), 180_000);
  assert.equal(S.blindWarning(base({ sinceBubbleMs: null, sinceDialMs: null, startedAt: null })), null, 'no baseline means no claim');
});

test('the panel makes the warning persistent and names the reload-and-sit fix', () => {
  assert.match(PANEL, /window\.AutoFishSession\.blindWarning\(/, 'the panel uses the pure trigger');
  assert.ok(PANEL.includes('detector blind for '), 'the note names the blindness');
  assert.ok(PANEL.includes('reload the game tab, then sit on a chair by the water'), 'and gives both fixes');
  const chain = PANEL.slice(PANEL.indexOf('var note = stallNote'), PANEL.indexOf('ui.banner.textContent = note'));
  assert.match(chain, /playerNote \|\| blindNote \|\| castNote/, 'it outlasts the cast-stall and log-offline lines');
  assert.ok(PANEL.includes("host.dataset.blind = '1'"), 'the state is observable outside the closed root');
  assert.match(PANEL, /\.banner\.blind\{/, 'the blind warning has its own style');
  assert.ok(PANEL.includes('runAgeMs: status ? status.runAgeMs : null'), 'the panel gives the trigger the current core run age');
});
