'use strict';
/**
 * Deterministic multi-frame headless simulator driving src/loop.js (`stepFrame`) across
 * live-regression timelines without a browser, WebGL canvas, or DOM timers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { stepFrame } = require('../src/loop.js');
const { createResultMissing } = require('../src/diagnostics.js');
const { seatPromptBox } = require('../src/vision.js');

function createHarness(optsOver) {
  let simNow = 1000;
  let nextTimerId = 1;
  const timers = new Map();
  const logs = [];
  const taps = [];
  const spaces = [];
  let bubblePrev = null;

  const opts = Object.assign({
    press: true,
    pressWith: 'pointer',
    maxMinutes: 60,
    leadMs: 25,
    midDeg: 6,
    marginDeg: 4,
    horizonMs: 40,
    schedHorizonMs: 40,
    replanMs: 8,
    dialCheckMs: 200,
    pressGapMs: 100,
    pressGraceMs: 250,
    rearmAcceptedMs: 600,
    maxPressPerDial: 30,
    maxRejectedPerDial: 5,
    relockGraceMs: 450,
    hitMs: 1500,
    skipMs: 300,
    ghostCooldownMs: 2000,
    bubbleDebounceMs: 600,
    castRungResetMs: 10000,
    castRetryMs: 2000,
    seatHoldRetryMs: 60000,
    seatWatchdogMs: 5000,
    resultMissingMs: 8000,
    lossGraceMs: 2500,
    attemptIdleMs: 25000,
    fastFirstPress: true,
  }, optsOver || {});

  const F = {
    version: 'sim',
    running: true,
    paused: false,
    hidden: false,
    hiddenPauses: 0,
    startedAt: 1000,
    lastTickAt: 0,
    lastPress: 0,
    lastCard: 0,
    lastBubble: null,
    lastBubbleAt: 0,
    lastCastTry: 0,
    lastDialCheck: 0,
    geo: null,
    geoAt: 0,
    lastGeo: null,
    hint: { x: 840, y: 411 },
    bad: 0,
    armed: false,
    pend: null,
    pressesThisDial: 0,
    pressStamp: null,
    pressWait: null,
    pressProbe: null,
    pressLog: [],
    predProbe: null,
    predLog: [],
    dialBlinks: 0,
    dialRejected: 0,
    dialLastPress: null,
    dialMaxOmega: 0,
    dialTravel: 0,
    dialPrevDelta: null,
    dialAnyFail: 0,
    dialAnyAt: 0,
    dialArm: null,
    armCfg: null,
    outcomes: [],
    attempts: [],
    attempt: null,
    pendingWin: null,
    cardWait: null,
    cardScan: 0,
    cardUntil: 0,
    lastCardRect: null,
    needsSeat: false,
    castHold: false,
    castHoldAt: 0,
    resultMissing: false,
    resultMissingAt: null,
    resultMissingAttempt: null,
    bubblePrev: null,
    bubbleMiss: 0,
    stallRetry: 0,
    lastRung: 0,
    lastBubbleCause: null,
    lastDialCause: null,
    acceptedAt: null,
    txtAt: 0,
    parseWhy: null,
    sweep: {},
    opts,
    stats: {
      frames: 0, dials: 0, dialsClosed: 0, hits: 0, misses: 0, ghosts: 0,
      skipped: 0, stalled: 0, noPress: 0, presses: 0, pressAccepted: 0,
      pressRejected: 0, attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0,
      bubbles: 0, castRetries: 0, cards: 0, shapeHits: 0, cardWaits: 0,
      textGaps: 0, narrowHolds: 0, firstPressHeld: 0, firstPressForced: 0,
      firstPressHeldForced: 0, locksDisarmed: 0, resultMissing: 0,
    },
    stop() { F.running = false; },
  };

  const log = (msg, extra) => logs.push({ t: simNow, msg, extra: extra || {} });
  const rm = createResultMissing(F, log);

  const state = {
    catchResult: null,
    recordVerdict: 'logged',
    bubbleResult: null,
    dialLockResult: null,
    dialSampleFn: null,
  };

  const io = {
    isVisible: () => true,
    now: () => simNow,
    stop: () => { F.running = false; },
    findCatch: () => state.catchResult,
    recordCatch: () => state.recordVerdict,
    findBubble: () => state.bubbleResult,
    lockDial: () => state.dialLockResult,
    dialAnywhere: () => null,
    sample: (geo) => (state.dialSampleFn ? state.dialSampleFn(geo, simNow) : null),
    captureTextCursor: () => { F.txtAt = simNow; },
    tap: (x, y) => { taps.push({ t: simNow, x, y }); return true; },
    space: (target) => { spaces.push({ t: simNow, target }); return true; },
    clearPendingWin: () => { F.pendingWin = null; },
    startAttempt: (t) => {
      F.attempt = {
        n: F.stats.attempts + 1, startedAt: t, touched: t,
        presses: 0, dials: 0, skipped: 0, maxOmega: 0,
        pressAccepted: 0, pressRejected: 0, dialHits: 0, dialMisses: 0,
        widthSum: 0, widthN: 0, maxWidth: 0, minWidth: 0,
      };
      return F.attempt;
    },
    resolveAttempt: (verdict, t, why) => {
      const a = F.attempt;
      if (!a) return null;
      F.attempt = null;
      a.verdict = verdict;
      a.why = why || null;
      a.ms = t - a.startedAt;
      F.stats.attempts++;
      F.stats[verdict === 'caught' ? 'caught' : 'lost']++;
      F.attempts.push(a);
      return a;
    },
    bubbleConfirmed: (b, t) => {
      if (!b || b.via === 'anywhere' || b.glyph === false) return false;
      const same = !!bubblePrev && Math.abs(bubblePrev.x - b.cx) <= 12 &&
        Math.abs(bubblePrev.y - b.cy) <= 12 && (t - bubblePrev.at) <= 2000;
      bubblePrev = { x: b.cx, y: b.cy, at: t, n: same ? bubblePrev.n + 1 : 1 };
      F.bubblePrev = bubblePrev;
      return bubblePrev.n >= 2;
    },
    noteBubbleTap: () => {},
    sameDial: (a, b) => !!(a && b && a.cx === b.cx && a.cy === b.cy && a.R === b.R),
    saveDialMemory: () => true,
    tryEscapeProfile: () => {},
    clearResultMissing: (why) => rm.clear(why),
    markResultMissing: (t, why) => rm.mark(t, why),
    log,
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { at: simNow + ms, fn });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
  };

  function stepAt(t) {
    simNow = t;
    for (const [id, entry] of [...timers.entries()]) {
      if (entry.at <= t) {
        timers.delete(id);
        entry.fn();
      }
    }
    stepFrame(F, t, io);
  }

  return { F, io, state, logs, taps, spaces, stepAt };
}

test('simulator 1: >90 deg spawn jump after doPress stays locked and re-arms before planPress', () => {
  const sim = createHarness();
  sim.state.dialLockResult = { cx: 840, cy: 411, R: 96, width: 90 };

  // Frame 1: lock dial and open gate
  sim.stepAt(1300);
  assert.ok(sim.F.geo, 'dial should lock');
  assert.equal(sim.F.armed, true);

  // Frame 2: first triangle is inside acceptance window -> immediate press 1
  sim.state.dialSampleFn = (geo, t) => {
    if (t === 1450) {
      geo._mid = 4;
      geo._hist = [{ t: 1450, mid: 4 }];
      return { valid: true, ring: 0.95, tracked: true, t: 1450, mid: 4, delta: -4, width: 90, omega: 200 };
    }
    // Frame 3 (150 ms later): predicted delta would be -4 + 200*0.15 = +26 deg.
    // Spawn jumps -120 deg away (delta = -94 deg -> |wrap(-94 - 26)| = 120 deg > 25 deg),
    // wait: land inside window at delta = -10 and mid jumped >90 deg -> check >25 jump + inside win!
    // Wait: width jump (90 -> 75) ALSO proves new spawn, OR jump from delta -4 to delta -30 => |-30 - 26| = 56 > 25 deg,
    // and width = 90 -> win = 41 -> |-30| <= 41!
    return { valid: true, ring: 0.96, tracked: true, t: 1600, mid: 130, delta: -30, width: 90, omega: 200 };
  };

  sim.stepAt(1450);
  assert.equal(sim.F.pressesThisDial, 1, 'press 1 fired');
  assert.equal(sim.F.geo._mid, null, 'doPress cleared _mid to allow >90 deg spawns');
  assert.equal(sim.F.geo._hist.length, 0, 'doPress cleared rotation history');
  assert.equal(sim.F.armed, false, 'gate disarmed until new spawn proven');
  assert.equal(sim.taps.length, 1);

  // Frame 3: >90 deg jump (mid 4 -> 130, delta diff 56 deg > 25) settles press 1 as accepted,
  // re-arms BEFORE planPress, and fires press 2 on the same frame.
  sim.stepAt(1600);
  assert.equal(sim.F.stats.pressAccepted, 1, 'press 1 settled as accepted');
  assert.equal(sim.F.pressesThisDial, 2, 're-armed and pressed again on the same frame');
  assert.equal(sim.taps.length, 2);
});

test('simulator 2: catch card overlapping locked dial holds fire, clears on expiry, and dismisses cleanly', () => {
  const sim = createHarness();
  sim.F.geo = { cx: 840, cy: 411, R: 96, width: 90, _travel: 0 };
  sim.F.geoAt = 1000;
  sim.F.armed = true;
  sim.F.pendingWin = { closedAt: 900, presses: 1, verdict: 'hit' };

  const cardObj = { cx: 800, cy: 500, w: 300, h: 410, via: 'shape', frac: 0.18 };
  sim.state.catchResult = cardObj;
  sim.state.dialSampleFn = () => ({
    valid: true, ring: 0.95, tracked: true, t: 1200, mid: 0, delta: 0, width: 90, omega: 0,
  });

  // Frame 1: branch 0b detects card over locked dial, sets cardUntil and holds fire
  sim.stepAt(1200);
  assert.equal(sim.F.cardUntil, 3400, 'cardUntil set to t + 2200');
  assert.deepEqual(sim.F.lastCardRect, { x: 650, y: 295, w: 300, h: 410 });
  assert.equal(sim.taps.length, 0, 'must hold fire while catch card covers dial');

  // Frame 2: still under cardUntil hold -> still no press
  sim.stepAt(1500);
  assert.equal(sim.taps.length, 0, 'still holding fire during cardUntil');

  // Dial disappears (4 bad samples close the dial)
  sim.state.dialSampleFn = () => ({ valid: false, ring: 0.1 });
  sim.stepAt(1700);
  sim.stepAt(1720);
  sim.stepAt(1740);
  sim.stepAt(1760);
  assert.equal(sim.F.geo, null, 'dial closed after blink/miss frames');

  // Card dismissal after card throttle window (lastCard = 0, t > 1500)
  sim.stepAt(2800);
  assert.equal(sim.taps.length, 1, 'card tapped once dial cleared');
  assert.deepEqual(sim.taps[0], { t: 2800, x: 800, y: 500 });
  assert.equal(sim.F.cardUntil, 0, 'cardUntil cleared after dismissal');
  assert.equal(sim.F.lastCardRect, null, 'lastCardRect cleared');
  assert.equal(sim.F.stats.cards, 1);
});

test('simulator 3: off-center seat prompt triggers needsSeat, respects seatHold, probes once, and recovers', () => {
  const sim = createHarness();
  sim.F.startedAt = 1000;

  // Before seatWatchdogMs (5000ms): still waiting
  sim.stepAt(5000);
  assert.equal(sim.F.needsSeat, false);

  // Past seatWatchdogMs: flags needsSeat
  sim.stepAt(6500);
  assert.equal(sim.F.needsSeat, true);
  assert.ok(sim.logs.some((l) => l.msg === 'needs a seat'));

  // Session applies seatHold; normal 2000ms retries stay suppressed
  sim.F.castHold = true;
  sim.F.castHoldAt = 6500;
  sim.F.lastCastTry = 6500;
  const spacesBefore = sim.spaces.length;
  sim.stepAt(10000);
  sim.stepAt(20000);
  assert.equal(sim.spaces.length, spacesBefore, 'castRetryMs must not fire while seatHold is active');

  // Past seatHoldRetryMs (60000ms): seatProbe fires once
  sim.stepAt(67000);
  assert.equal(sim.spaces.length, spacesBefore + 1, 'seatProbe fires once after interval');
  assert.equal(sim.logs[sim.logs.length - 1].msg, 'cast retry');
  assert.equal(sim.logs[sim.logs.length - 1].extra.seatHold, true);

  // Prompt returns at off-center pier seat (box verified)
  const seatBox = seatPromptBox({ cx: 610, cy: 633, R: 90 }, 1620, 1031);
  assert.ok(seatBox && seatBox.x <= 610 && seatBox.x + seatBox.w >= 610);
  sim.state.bubbleResult = { cx: 610, cy: 580, n: 60, via: 'box', glyph: true, gdark: 0.002, gsoft: 0.17 };

  sim.stepAt(68000); // sighting 1: not yet confirmed, moves hint
  assert.equal(sim.F.needsSeat, false, 'prompt clears needsSeat');
  assert.deepEqual(sim.F.hint, { x: 610, y: 633 }, 'hint follows off-center prompt');
  assert.equal(sim.taps.length, 0, 'first sighting does not tap yet');

  sim.stepAt(68700); // sighting 2 (> bubbleDebounceMs): confirmed and tapped
  assert.equal(sim.taps.length, 1);
  assert.deepEqual(sim.taps[0], { t: 68700, x: 610, y: 580 });
});

test('simulator 4: maxPressPerDial (30), maxRejectedPerDial (5), and resultMissingDue latch', () => {
  // 4a. maxPressPerDial = 30 blocks 31st press even on a proven spawn
  const sim = createHarness();
  sim.F.geo = { cx: 840, cy: 411, R: 96, width: 90, _travel: 0 };
  sim.F.geoAt = 1000;
  sim.F.lastPress = 1000;
  sim.F.pressesThisDial = 30;
  sim.F.armed = false;
  sim.F.pressStamp = { delta: 0, width: 90, t: 1000 };
  sim.state.dialSampleFn = () => ({
    valid: true, ring: 0.95, tracked: true, t: 1500, mid: 120, delta: 0, width: 45, omega: 100,
  });
  sim.stepAt(1500);
  assert.equal(sim.F.armed, false, 'rearmReady blocks press #31 at maxPressPerDial=30');
  assert.equal(sim.taps.length, 0);

  // 4b. maxRejectedPerDial = 5 blocks re-arm even when acceptedAt fallback is recent
  const rejSim = createHarness();
  rejSim.F.geo = { cx: 840, cy: 411, R: 96, width: 90, _travel: 0 };
  rejSim.F.geoAt = 1000;
  rejSim.F.lastPress = 1000;
  rejSim.F.pressesThisDial = 3;
  rejSim.F.dialRejected = 5;
  rejSim.F.acceptedAt = 1400; // within rearmAcceptedMs=600
  rejSim.F.armed = false;
  rejSim.state.dialSampleFn = () => ({
    valid: true, ring: 0.95, tracked: true, t: 1500, mid: 120, delta: 0, width: 45, omega: 100,
  });
  rejSim.stepAt(1500);
  assert.equal(rejSim.F.armed, false, '5 consecutive rejected presses block re-arm');

  // 4c. resultMissingDue latches when pendingWin outlives resultMissingMs (8000ms) without card or prompt
  const latchSim = createHarness();
  latchSim.F.startedAt = 1000;
  latchSim.F.attempt = { n: 1, startedAt: 1000, touched: 1000, presses: 1, dials: 1, dialHits: 1 };
  latchSim.F.pendingWin = { closedAt: 1000, presses: 1, verdict: 'hit' };
  latchSim.stepAt(5000);
  assert.equal(latchSim.F.resultMissing, false, 'not yet past resultMissingMs=8000');
  const spacesBeforeLatch = latchSim.spaces.length;

  latchSim.stepAt(10500);
  latchSim.stepAt(13500);
  assert.equal(latchSim.F.resultMissing, true, 'latches resultMissing after resultMissingMs');
  assert.equal(latchSim.F.resultMissingAttempt.n, 1);
  assert.equal(latchSim.F.needsSeat, false, 'resultMissing suppresses needsSeat');
  assert.equal(latchSim.spaces.length, spacesBeforeLatch, 'resultMissing suppresses cast retries');

  // A late prompt clears the latch
  latchSim.state.bubbleResult = { cx: 810, cy: 358, n: 60, via: 'box', glyph: true };
  latchSim.stepAt(11200);
  assert.equal(latchSim.F.resultMissing, false, 'late cast prompt clears resultMissing');
});
