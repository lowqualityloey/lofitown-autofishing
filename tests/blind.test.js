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
  startedAt: T0, now: T0 + 180_000, pauseMs: 0
}, over || {});

const tick = (state, at, over) => S.reduce(state, Object.assign({
  type: 'tick', at, visible: true, catches: 0, errors: 0, todayMs: 0
}, over || {})).state;

const running = () => S.reduce(S.createState(), { type: 'start', at: T0 }).state;

/** The warning after a pause, with the timer's pre-pause silence and post-resume activity. */
function afterResume(state, activeMs, prePauseMs) {
  var wallMs = prePauseMs + state.blindPauseMs + activeMs;
  return S.blindWarning({
    phase: 'running', pauseReason: null, running: true, stalled: false, visible: true,
    sinceBubbleMs: wallMs, sinceDialMs: wallMs,
    startedAt: state.startedAt, now: state.startedAt + wallMs,
    pauseMs: state.blindPauseMs
  });
}

function warningAt(state, wallMs) {
  return S.blindWarning({
    phase: 'running', pauseReason: null, running: true, stalled: false, visible: true,
    sinceBubbleMs: wallMs, sinceDialMs: wallMs,
    startedAt: state.startedAt, now: state.startedAt + wallMs,
    pauseMs: state.blindPauseMs
  });
}

test('the blind warning starts at three minutes, not a second before', () => {
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 179_999, sinceDialMs: 200_000, now: T0 + 300_000 })), null, '2:59.999 is still a wait');
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 180_000, sinceDialMs: 200_000, now: T0 + 300_000 })), 180_000, 'exactly three minutes escalates with the newer signal age');
});

test('the blind age is the newer of the last prompt and the last dial', () => {
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 600_000, sinceDialMs: 30_000, now: T0 + 600_000 })), null, 'a prompt 30 s ago means the detector is not blind');
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 181_000, sinceDialMs: 300_000, now: T0 + 400_000 })), 181_000);
});

test('deliberate pause time is removed from the blind age', () => {
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 700_000, sinceDialMs: 700_000, now: T0 + 700_000, pauseMs: 600_000 })), null);
  assert.equal(S.blindWarning(base({ sinceBubbleMs: 700_000, sinceDialMs: 700_000, now: T0 + 700_000, pauseMs: 400_000 })), 300_000);
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

test('a user pause does not fire the blind warning on resume', () => {
  let s = running();
  s = tick(s, T0 + 60_000, { sinceBubbleMs: 60_000, sinceDialMs: 60_000 });
  s = S.reduce(s, { type: 'pause', at: T0 + 60_000 }).state;
  s = S.reduce(s, { type: 'resume', at: T0 + 660_000 }).state;
  assert.equal(s.phase, 'running');
  assert.equal(s.blindPauseMs, 600_000);
  assert.equal(afterResume(s, 10_000, 60_000), null, 'the hold is not detector silence');
  assert.equal(afterResume(s, 120_000, 60_000), 180_000, 'only the unpaused silence counts');
});

test('a seat pause does not fire the blind warning on resume', () => {
  let s = running();
  s = tick(s, T0 + 60_000, { seat: true, sinceBubbleMs: 60_000, sinceDialMs: 60_000 });
  assert.equal(s.pauseReason, 'seat');
  s = tick(s, T0 + 660_000, { seat: false, sinceBubbleMs: 660_000, sinceDialMs: 660_000 });
  assert.equal(s.phase, 'running');
  assert.equal(s.blindPauseMs, 600_000);
  assert.equal(afterResume(s, 10_000, 60_000), null);
  assert.equal(afterResume(s, 120_000, 60_000), 180_000);
});

test('a focus pause does not fire the blind warning on resume', () => {
  let s = running();
  s = tick(s, T0 + 60_000, { focus: true, sinceBubbleMs: 60_000, sinceDialMs: 60_000 });
  assert.equal(s.pauseReason, 'focus');
  s = tick(s, T0 + 660_000, { focus: false, sinceBubbleMs: 660_000, sinceDialMs: 660_000 });
  assert.equal(s.phase, 'running');
  assert.equal(s.blindPauseMs, 600_000);
  assert.equal(afterResume(s, 10_000, 60_000), null);
  assert.equal(afterResume(s, 120_000, 60_000), 180_000);
});

test('a hidden pause is credited by the reducer, not twice', () => {
  let s = running();
  s = S.reduce(s, { type: 'hidden-start', at: T0 + 1000 }).state;
  s = tick(s, T0 + 1000, { visible: false });
  s = tick(s, T0 + 7000, { visible: false });
  assert.equal(s.pauseReason, 'hidden');
  assert.equal(s.blindHiddenPause, true);
  assert.equal(s.blindPauseMs, 0);
  s = S.reduce(s, { type: 'hidden-return', at: T0 + 70_000, hiddenMs: 69_000 }).state;
  assert.equal(s.blindPauseMs, 0, 'the reducer owns this hidden episode');
  s = tick(s, T0 + 70_000, { visible: true });
  s = tick(s, T0 + 74_000, { visible: true });
  assert.equal(s.phase, 'running');
  assert.equal(s.blindPauseMs, 67_000);
  s = S.reduce(s, { type: 'hidden-return', at: T0 + 74_000, hiddenMs: 69_000 }).state;
  assert.equal(s.blindPauseMs, 67_000, 'a late return does not add the hidden pause again');
  assert.equal(afterResume(s, 10_000, 7000), null);
  assert.equal(afterResume(s, 173_000, 7000), 180_000);
});

test('hidden time is credited even when the background tab never ticked', () => {
  let s = running();
  s = S.reduce(s, { type: 'hidden-start', at: T0 }).state;
  s = S.reduce(s, { type: 'hidden-return', at: T0 + 600_000, hiddenMs: 600_000 }).state;
  assert.equal(s.phase, 'running');
  assert.equal(s.blindPauseMs, 600_000);
  assert.equal(afterResume(s, 10_000, 0), null, 'the hidden wall time is not detector silence');
  assert.equal(afterResume(s, 180_000, 0), 180_000, 'only time after the return counts');
});

test('a hidden return does not double-count a user pause', () => {
  let s = running();
  s = S.reduce(s, { type: 'pause', at: T0 + 60_000 }).state;
  s = S.reduce(s, { type: 'hidden-return', at: T0 + 660_000, hiddenMs: 600_000 }).state;
  assert.equal(s.blindPauseMs, 0, 'the user pause already owns this wall time');
  s = S.reduce(s, { type: 'resume', at: T0 + 660_000 }).state;
  assert.equal(s.blindPauseMs, 600_000, 'and it is credited exactly once when the hold ends');
});

test('a core restart clears the blind pause credit', () => {
  const s = S.createState({ blindPauseMs: 600_000, blindPauseAt: T0, blindBubbleMs: 1_000, blindDialMs: 2_000, blindHiddenPause: true });
  S.clearBlindPause(s);
  assert.equal(s.blindPauseMs, 0);
  assert.equal(s.blindPauseAt, null);
  assert.equal(s.blindBubbleMs, null);
  assert.equal(s.blindDialMs, null);
  assert.equal(s.blindHiddenPause, false);
  const startCore = PANEL.slice(PANEL.indexOf('startCore: function'), PANEL.indexOf('stopCore:'));
  assert.match(startCore, /clearBlindPause\(state\)/, 'the watchdog and normal Start both clear it');
});

test('cast-stall and no-catch pauses still count toward the blind clock', () => {
  let stall = running();
  stall = tick(stall, T0 + 100_000, { sinceBubbleMs: 100_000, sinceDialMs: 100_000 });
  assert.equal(stall.pauseReason, 'cast-stall');
  assert.equal(stall.blindPauseMs, 0);
  stall = tick(stall, T0 + 161_000, { sinceBubbleMs: 161_000, sinceDialMs: 161_000 });
  assert.equal(stall.phase, 'running');
  assert.equal(stall.blindPauseMs, 0);
  assert.equal(warningAt(stall, 240_000), 240_000);

  let noCatch = running();
  noCatch = tick(noCatch, T0 + 601_000);
  assert.equal(noCatch.pauseReason, 'no-catch');
  assert.equal(noCatch.blindPauseMs, 0);
  noCatch = tick(noCatch, T0 + 662_000, { sinceBubbleMs: 662_000, sinceDialMs: 662_000 });
  assert.equal(noCatch.phase, 'running');
  assert.equal(noCatch.blindPauseMs, 0);
  assert.equal(warningAt(noCatch, 700_000), 700_000);
});

test('a new prompt after a pause starts a fresh blind interval', () => {
  let s = running();
  s = tick(s, T0 + 60_000, { sinceBubbleMs: 60_000, sinceDialMs: 60_000 });
  s = S.reduce(s, { type: 'pause', at: T0 + 60_000 }).state;
  s = S.reduce(s, { type: 'resume', at: T0 + 660_000 }).state;
  assert.equal(s.blindPauseMs, 600_000);
  s = tick(s, T0 + 661_000, { sinceBubbleMs: 1_000, sinceDialMs: 601_000 });
  assert.equal(s.blindPauseMs, 0, 'the new prompt resets the pause credit');

  let first = running();
  first = S.reduce(first, { type: 'pause', at: T0 + 1000 }).state;
  first = S.reduce(first, { type: 'resume', at: T0 + 601_000 }).state;
  assert.equal(first.blindPauseMs, 600_000);
  first = tick(first, T0 + 602_000, { sinceBubbleMs: 1_000 });
  assert.equal(first.blindPauseMs, 0, 'the first prompt after a pause also resets it');
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
  assert.ok(PANEL.includes('pauseMs: state.blindPauseMs || 0'), 'the panel passes the deliberate-pause credit');
});

test('the panel records visibility wall time for the reducer', () => {
  assert.ok(PANEL.includes("type: 'hidden-return'"), 'the return event reaches the reducer');
  assert.ok(PANEL.includes("type: 'hidden-start'"), 'a new hidden episode resets the ownership marker');
  assert.ok(PANEL.includes('hiddenAt = Date.now()'), 'going hidden records the wall clock');
  assert.match(PANEL, /hiddenAt != null \? Math\.max\(0, Date\.now\(\) - hiddenAt\) : 0/, 'the return measures the hidden gap');
});
