// @ts-check
/* src/loop.js — headless per-frame loop driver and dial/press state transitions.
 * UMD: browser global AutoFishLoop, CommonJS require('./src/loop.js').
 */
/**
 * @param {any} root
 * @param {(timing: Record<string, any>, diag: Record<string, any>) => Record<string, any>} factory
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var timing = isNode ? require('./timing.js') : root.AutoFishTiming;
  var diag = isNode ? require('./diagnostics.js') : root.AutoFishDiagnostics;
  var api = factory(timing, diag);
  if (isNode) module.exports = api;
  else root.AutoFishLoop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Timing, Diag) {
  'use strict';

  const {
    wrap180, planPress, sweepBias, newTriangle, rearmReady, pressOutcome, castRecovery,
    fitStable, firstPressGate, firstPressBudget, firstPressCanMature, markFirstPressForced,
    dialGhost, dialStalled, spinAlive, lossDiagnostics,
  } = Timing;
  const { resultMissingDue } = Diag;

  /* One list, not a five-deep ternary: a new verdict has to name its counter here. */
  /** @satisfies {Record<DialVerdict, string>} */
  const DIAL_COUNTER = {
    hit: 'hits', miss: 'misses', ghost: 'ghosts', skipped: 'skipped', stalled: 'stalled', 'no-press': 'noPress',
  };

  /**
   * Apply the latest prompt sighting to an attempt without touching its loss decision. A pending
   * loss keeps pendingLoss and every decision field; only lossDiag is replaced.
   * @param {Record<string, any> | null | undefined} attempt
   * @param {Record<string, any> | null | undefined} b
   * @param {number} t
   * @param {Record<string, any> | null | undefined} prev
   * @param {boolean} cardPending
   */
  function refreshLossDiagnostic(attempt, b, t, prev, cardPending) {
    if (!attempt) return null;
    return (attempt.lossDiag = lossDiagnostics(b, t, prev, cardPending));
  }

  /**
   * Drop a pending scheduled press (dial gone, pause, stop, re-plan).
   * @param {FishCore} F
   * @param {Partial<LoopIo>} [io]
   */
  function cancelPend(F, io) {
    if (F.pend) {
      const clearTimer = (io && io.clearTimeout) || function (/** @type {any} */ id) { clearTimeout(id); };
      clearTimer(F.pend.id);
      F.pend = null;
    }
  }

  /**
   * @param {FishCore} F
   * @param {Record<string, any>} rec
   */
  function pushPressProbe(F, rec) {
    if (!F.pressLog) F.pressLog = [];
    F.pressLog.push(rec);
    while (F.pressLog.length > 300) F.pressLog.shift();
  }

  /**
   * One press's verdict, counted once. `accepted` means the game spawned a new triangle, which is
   * the only observable a good press leaves before the fish is landed.
   * @param {FishCore} F
   * @param {string} verdict
   * @param {number | null | undefined} biasMs
   * @param {string} source
   * @param {number} t
   */
  function recordPressVerdict(F, verdict, biasMs, source, t) {
    if (verdict !== 'accepted' && verdict !== 'rejected') return;
    if (F.pressWait) F.pressWait.verdict = verdict;
    const src = source === 'observed' || source === 'timing' ? source : 'assumed';
    if (!F.stats.pressVerdicts) {
      F.stats.pressVerdicts = {
        observed: { accepted: 0, rejected: 0 },
        assumed: { accepted: 0, rejected: 0 },
        timing: { accepted: 0, rejected: 0 },
      };
    }
    F.stats.pressVerdicts[src][verdict]++;
    F.stats[verdict === 'accepted' ? 'pressAccepted' : 'pressRejected']++;
    F.dialRejected = verdict === 'rejected' ? (F.dialRejected || 0) + 1 : 0;
    if (verdict === 'accepted') F.acceptedAt = t;
    if (F.attempt) {
      if (verdict === 'accepted') F.attempt.pressAccepted = (F.attempt.pressAccepted || 0) + 1;
      else F.attempt.pressRejected = (F.attempt.pressRejected || 0) + 1;
    }
    const key = biasMs == null ? 0 : biasMs;
    if (!F.sweep) F.sweep = {};
    const cell = F.sweep[key] || (F.sweep[key] = { biasMs: key, presses: 0, accepted: 0, rejected: 0 });
    cell.presses++;
    cell[verdict]++;
  }

  /**
   * Resolve the pending press from the sample stream: no new triangle inside the grace = rejected.
   * @param {FishCore} F
   * @param {Record<string, any>} s
   * @param {number} blinks
   * @param {number} t
   * @param {Partial<LoopIo>} [io]
   */
  function settlePress(F, s, blinks, t, io) {
    const w = F.pressWait;
    if (!w || w.verdict) return;
    const out = pressOutcome({ press: w.press, s, blinks, opts: F.opts });
    if (out.verdict !== 'accepted' && out.verdict !== 'rejected') return;
    recordPressVerdict(F, out.verdict, w.biasMs, 'observed', t);
    const L = (io && io.log) || function () {};
    L('press verdict', { verdict: out.verdict, biasMs: w.biasMs, width: Math.round((w.press && w.press.width) || 0) });
    if (F.pressProbe && !F.pressProbe.via) {
      F.pressProbe.via = 'settled';
      F.pressProbe.verdict = out.verdict;
      pushPressProbe(F, F.pressProbe);
      F.pressProbe = null;
    }
  }

  /**
   * Start a press probe and retire the previous one the way doPress always assumed it.
   * @param {FishCore} F
   * @param {Record<string, any> | null | undefined} s
   * @param {number} t
   */
  function probePressStart(F, s, t) {
    const prev = F.pressProbe;
    if (prev && !prev.via) {
      prev.via = 'assumed';
      prev.verdict = 'accepted';
      pushPressProbe(F, prev);
    }
    const p = F.planNow || {};
    F.pressProbe = {
      at: t,
      lead: F.opts.leadMs != null ? F.opts.leadMs : 25,
      width: s && s.width != null ? Math.round(s.width) : null,
      om: s && s.omega != null ? Math.round(s.omega) : null,
      delta: s && s.delta != null ? +Number(s.delta).toFixed(1) : null,
      pred: p.pred != null ? +Number(p.pred).toFixed(1) : null,
      win: p.win != null ? +Number(p.win).toFixed(1) : null,
      inside: (p.win != null && s && s.delta != null) ? Math.abs(Number(s.delta)) <= p.win : null,
      via: null, verdict: null,
      attempt: F.attempt ? F.attempt.n : null,
      dial: F.pressesThisDial,
    };
  }

  /**
   * Dispatch one dial press and reset wedge rotation history for the incoming triangle spawn.
   * @param {FishCore} F
   * @param {Record<string, any> | null | undefined} s
   * @param {string} how
   * @param {number} t
   * @param {Partial<LoopIo>} [io]
   */
  function doPress(F, s, how, t, io) {
    if (!F.opts.press || !F.geo) return;
    const L = (io && io.log) || function () {};
    const space = (io && io.space) || function () { return false; };
    const tap = (io && io.tap) || function () { return false; };
    probePressStart(F, s, t);
    const via = F.opts.pressWith === 'space' ? 'space' : 'pointer';
    if (via === 'space') space(F.opts.spaceTarget);
    else tap(F.geo.cx, F.geo.cy);
    F.armed = false;
    // The game answers a press by spawning a fresh triangle in the same widget, so the wedge
    // jumps. Clear the rotation history AND old tracked midpoint so F.sample() accepts a >90 deg
    // spawn on the very next frame instead of rejecting it as a tracking jump and dropping F.geo.
    if (F.geo) {
      if (F.geo._hist) F.geo._hist.length = 0;
      F.geo._mid = null; F.geo._mt = null; F.geo._om = null; F.geo._fit = null;
    }
    F.pressStamp = s ? { delta: s.delta, width: s.width, t: s.t != null ? s.t : t } : null;
    F.dialBlinks = 0;
    // A second press is only possible after the re-arm gate saw a spawn, so an unresolved press
    // here was accepted by the game even though no frame managed to settle it.
    if (F.pressWait && !F.pressWait.verdict) recordPressVerdict(F, 'accepted', F.pressWait.biasMs, 'assumed', t);
    F.lastPress = t;
    F.pressWait = { press: F.pressStamp, at: F.lastPress, biasMs: (s && s.biasMs) || 0, verdict: null };
    F.stats.presses++; F.pressesThisDial++;
    if (F.attempt) {
      F.attempt.presses++;
      F.attempt.touched = F.lastPress;
      F.attempt.pendingLoss = null;
      const om = Math.abs((s && s.omega) || 0);
      if (om > F.attempt.maxOmega) F.attempt.maxOmega = om;
    }
    F.dialLastPress = { t: F.lastPress, via, biasMs: (s && s.biasMs) || 0, omega: s && s.omega };
    const pend = F.pend;
    cancelPend(F, io);
    L('PRESS', {
      how, via,
      delta: s ? Math.round(s.delta) : null,
      pred: s && s.pred != null ? +s.pred.toFixed(1) : null,
      mid: s && s.mid != null ? Math.round(s.mid) : null,
      width: s && s.width != null ? Math.round(s.width) : null,
      omega: s && s.omega != null ? Math.round(s.omega) : null,
      fitRms: s && s.fit && s.fit.rms != null ? +s.fit.rms.toFixed(1) : null,
      fitN: s && s.fit ? s.fit.n : null,
      fitSpan: s && s.fit && s.fit.span != null ? Math.round(s.fit.span) : null,
      lockMs: F.geoAt ? Math.round(F.lastPress - F.geoAt) : null,
      biasMs: (s && s.biasMs) || 0,
      dialPressN: F.pressesThisDial,
      gate: F.pressesThisDial === 1 ? 'first' : 'new-triangle',
      late: pend ? Math.round(t - pend.at) : null,
    });
  }

  /**
   * Arm a timer so the press lands BETWEEN animation frames, aimed at the computed crossing.
   * @param {FishCore} F
   * @param {number} at
   * @param {GeoLock} geo
   * @param {Record<string, any>} s
   * @param {number} t
   * @param {Partial<LoopIo>} [io]
   */
  function armPress(F, at, geo, s, t, io) {
    cancelPend(F, io);
    const delay = Math.max(0, at - t);
    const setTimer = (io && io.setTimeout) || function (/** @type {() => void} */ fn, /** @type {number} */ ms) { return setTimeout(fn, ms); };
    const id = setTimer(function () {
      if (!F.pend || F.pend.id !== id) return;
      F.pend = null;
      if (!F.running || F.paused || F.geo !== geo) return;
      const fireAt = io && io.now ? io.now() : at;
      doPress(F, s, 'timer', fireAt, io);
    }, delay);
    F.pend = { id, at, geo };
  }

  /**
   * End of a dial: classify verdict, settle unresolved press, update counters and pendingWin.
   * @param {FishCore} F
   * @param {number} t
   * @param {number | null | undefined} ring
   * @param {Partial<LoopIo>} [io]
   */
  function closeDial(F, t, ring, io) {
    const L = (io && io.log) || function () {};
    const presses = F.pressesThisDial;
    const heldMs = Math.round(t - (F.geoAt || t));
    const last = presses > 0 ? F.dialLastPress : null;
    const sincePress = last ? Math.round(t - last.t) : null;
    const width = Math.round((F.geo && F.geo.width) || 0);
    const widths = (F.geoTrace || [])
      .map((/** @type {any} */ r) => Number(r.w))
      .filter((/** @type {number} */ w) => isFinite(w) && w > 0);
    const widthShrink = widths.length > 1 ? Math.max(...widths) - Math.min(...widths) : 0;
    const hitMs = F.opts.hitMs || 1500;
    if (F.pressWait && !F.pressWait.verdict) {
      recordPressVerdict(F, presses > 0 && sincePress != null && sincePress <= hitMs ? 'accepted' : 'rejected', F.pressWait.biasMs, 'timing', t);
    }
    F.pressWait = null;
    const ghost = dialGhost({ presses, heldMs, width, widthShrink, travel: F.dialTravel }, F.opts);
    const stalled = dialStalled({ presses, heldMs, sincePress, ghost, width }, F.opts);
    const skipped = !ghost && presses === 0 && heldMs >= (F.opts.skipMs || 300);
    /** @type {DialVerdict} */
    const verdict = stalled ? 'stalled'
      : ghost ? 'ghost'
      : presses === 0 ? (skipped ? 'skipped' : 'no-press')
      : (sincePress != null && sincePress <= hitMs ? 'hit' : 'miss');
    F.stats.dialsClosed++;
    F.stats[DIAL_COUNTER[verdict]]++;
    if (ghost && !stalled && F.geo) {
      F.ghostGeo = {
        cx: F.geo.cx, cy: F.geo.cy, R: F.geo.R, width,
        until: t + (F.opts.ghostCooldownMs || 2000),
      };
      F.lastLockAt = 0;                       // the memo must not immediately re-lock it
    }
    if (F.attempt && verdict === 'hit') F.attempt.dialHits = (F.attempt.dialHits || 0) + 1;
    if (F.attempt && verdict === 'miss') F.attempt.dialMisses = (F.attempt.dialMisses || 0) + 1;
    if (skipped && F.attempt) F.attempt.skipped++;
    /** @type {Record<string, any>} */
    const rec = {
      heldMs, presses, verdict, sincePress,
      width,
      omega: last && last.omega != null ? Math.round(last.omega) : null,
      biasMs: last ? last.biasMs : null,
      reasons: F.geoReasons || null,
      arm: F.dialArm || null,
      trace: F.geoReasons && !(verdict === 'hit') ? F.geoTrace.slice() : null,
    };
    if (F.attempt) {
      if (!F.attempt.dialLog) F.attempt.dialLog = [];
      if (F.geo && !F.geo._armed0 && presses === 0) F.stats.locksDisarmed = (F.stats.locksDisarmed || 0) + 1;
      F.attempt.dialLog.push({
        w: rec.width, om: rec.omega, p: presses, held: heldMs, armed0: !!(F.geo && F.geo._armed0), v: verdict,
      });
      if (F.attempt.dialLog.length > 12) F.attempt.dialLog.shift();
    }
    if (!F.outcomes) F.outcomes = [];
    F.outcomes.push(rec);
    while (F.outcomes.length > 400) F.outcomes.shift();
    if (presses > 0) {
      rec.closedAt = t;
      rec.biasMs = last ? last.biasMs : null;
      if (io && io.clearPendingWin) io.clearPendingWin();
      else F.pendingWin = null;
      F.pendingWin = rec;
    }
    L('dial gone', {
      ring: ring == null ? null : +ring.toFixed(2),
      presses, heldMs, verdict, sincePress, width: rec.width, omega: rec.omega,
    });
  }

  /**
   * Advance the bot state machine by one frame at timestamp `t`.
   * @param {FishCore} F
   * @param {number} t
   * @param {Partial<LoopIo>} [io]
   */
  function stepFrame(F, t, io) {
    const o = io || {};
    const L = o.log || function () {};
    const isVisible = o.isVisible || function () {
      return typeof document === 'undefined' || document.visibilityState === 'visible';
    };
    const tap = o.tap || function () { return false; };
    const space = o.space || function () { return false; };
    const clearResultMissing = o.clearResultMissing || function () {};
    const markResultMissing = o.markResultMissing || function () {};
    const markShapeHit = o.markShapeHit || function (/** @type {number} */ at) {
      F.stats.shapeHits = (F.stats.shapeHits || 0) + 1;
      const rec = F.pendingWin;
      if (!rec) return;
      if (rec.cardMs == null && rec.closedAt != null) rec.cardMs = Math.round(at - rec.closedAt);
      rec.shapeSeen = true;
    };
    const resolveAttempt = o.resolveAttempt || function () { return null; };
    const startAttempt = o.startAttempt || function () { return null; };
    const bubbleConfirmed = o.bubbleConfirmed || function () { return true; };
    const noteBubbleTap = o.noteBubbleTap || function () {};
    const sameDial = o.sameDial || function () { return false; };
    const saveDialMemory = o.saveDialMemory || function () { return false; };

    F.lastTickAt = t;                       // the watchdog's only fact: the loop got a frame
    F.stats.frames++;
    if (!isVisible()) { F.hidden = true; return; }
    if (F.hidden) { F.hidden = false; F.hiddenPauses++; }
    if (F.paused) return;
    if (F.opts.maxMinutes > 0 && t - F.startedAt > F.opts.maxMinutes * 60000) {
      L('maxMinutes');
      if (o.stop) o.stop();
      else if (F.stop) F.stop();
      return;
    }
    // 0a. an open player profile swallows inputs and hides prompts. Try Escape once in a
    // while; the session pause (profile-open) holds the clock whether or not it lands.
    if (o.tryEscapeProfile) o.tryEscapeProfile(t);
    // A fish that has shown no dial and taken no press for a long time is over; the client's own
    // timer is 15-40 s, so this only fires when the flow itself stalled (a missed re-cast).
    if (F.attempt && F.attempt.pendingLoss && t - F.attempt.pendingLoss > (F.opts.lossGraceMs || 2500)) {
      resolveAttempt('lost', t, 'cast prompt');
    }
    if (F.attempt && t - (F.attempt.touched || F.attempt.startedAt) > (F.opts.attemptIdleMs || 25000)) {
      resolveAttempt('lost', t, 'idle');
    }

    // 0. a catch card blocks the next cast until it is tapped away. Its paper appears before its
    // text is drawn, so the card is held open until the catch has been read - tapping on sight
    // dismissed cards that had not printed their species yet, losing the record. Bounded, so a
    // card that never prints text still clears.
    const awaitingCard = !!(F.pendingWin && t - (F.pendingWin.closedAt || t) < 30000);
    if (!F.geo && t - (F.lastCard || 0) > 1500 && awaitingCard) {
      const card = o.findCatch ? o.findCatch() : (F.findCatch ? F.findCatch() : null);
      if (card) {
        clearResultMissing('catch card');
        markShapeHit(t);
        F.lastCardRect = card.w && card.h
          ? { x: card.cx - card.w / 2, y: card.cy - card.h / 2, w: card.w, h: card.h }
          : { x: card.cx - 183, y: card.cy - 203, w: 366, h: 406 };
        const r = o.recordCatch ? o.recordCatch(card) : (F.recordCatch ? F.recordCatch(card) : 'empty');
        if (r === 'trophy-wait') { F.stats.cardWaits = (F.stats.cardWaits || 0) + 1; return; }
        if (r !== 'logged') {
          if (F.cardWait == null) F.cardWait = t;
          if (t - F.cardWait < 2500) { F.stats.cardWaits = (F.stats.cardWaits || 0) + 1; return; }
          L('catch text missing', { frac: card.frac, why: F.parseWhy });
          if (o.captureTextCursor) o.captureTextCursor();
          else F.txtAt = o.now ? o.now() : t;
          F.stats.textGaps = (F.stats.textGaps || 0) + 1;
        }
        tap(card.cx, card.cy);
        F.lastCard = t; F.cardWait = null; F.lastCardRect = null; F.cardUntil = 0;
        F.stats.cards = (F.stats.cards || 0) + 1;
        L('catch card dismissed', { via: card.via, frac: card.frac, log: r });
        return;
      }
    }

    // 0b. A catch card that lands while the next dial is already locked used to be invisible:
    // look for the card whenever a press is awaiting its verdict, and while it is up hold fire.
    if (F.pendingWin && t - (F.pendingWin.closedAt || t) < 30000 && t - (F.cardScan || 0) > 120) {
      F.cardScan = t;
      const c = o.findCatch ? o.findCatch() : (F.findCatch ? F.findCatch() : null);
      if (c) {
        clearResultMissing('catch card');
        markShapeHit(t);
        F.cardUntil = t + 2200;
        F.lastCardRect = c.w && c.h
          ? { x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h }
          : { x: c.cx - 183, y: c.cy - 203, w: 366, h: 406 };
        L('catch card over dial', { frac: c.frac, cx: c.cx, cy: c.cy, dial: !!F.geo });
      }
    }

    // 1. a bubble is always the next thing to press (CAST! or REEL!, same shape)
    const b = o.findBubble ? o.findBubble() : (F.findBubble ? F.findBubble() : null);
    if (b) {
      clearResultMissing('cast prompt');
      if (F.lastBubbleAt && t - F.lastBubbleAt > (F.opts.castRungResetMs || 10000)) F.bubbleMiss = 0;
      F.lastBubble = b; F.lastBubbleAt = t;
      if (F.attempt) {
        const diag = refreshLossDiagnostic(F.attempt, b, t, F.bubblePrev, awaitingCard);
        if (!awaitingCard || (diag && diag.confirmed)) {
          if (!F.attempt.pendingLoss) {
            if (t - (F.attempt.presses ? (F.attempt.touched || 0) : 0) > (F.opts.lossGraceMs || 2500)) {
              resolveAttempt('lost', t, 'cast prompt');
            } else {
              F.attempt.pendingLoss = t;
              L('attempt loss pending', Object.assign({ n: F.attempt.n }, diag));
            }
          }
        }
      }
      if (t - F.lastPress > F.opts.bubbleDebounceMs) {
        const rung = (F.bubbleMiss = (F.bubbleMiss || 0) + 1);
        F.lastRung = rung;
        F.needsSeat = false;                                  // a prompt is up: the character is seated
        const rec = castRecovery(rung);
        var isBox = b.via !== 'anywhere';
        if (isBox) {
          F.hint = { x: b.cx, y: b.cy + 53 };
          F.dialAnyFail = 0; F.dialAnyAt = 0;    // a cast is new evidence: recover promptly again
        }
        var confirmed = bubbleConfirmed(b, t);
        var tapOk = !!(rec.tap && confirmed);
        if (tapOk) tap(b.cx, b.cy);
        if (tapOk) noteBubbleTap(t);
        F.lastBubbleCause = { tap: tapOk, space: !!rec.space, glyph: b.glyph === true, at: t };
        F.lastPress = t;
        F.stats.bubbles++;
        L('bubble', { cx: b.cx, cy: b.cy, n: b.n, hint: F.hint.y, rung, via: b.via || 'box', tap: tapOk, space: rec.space, confirmed: confirmed, glyph: b.glyph === true, gdark: typeof b.gdark === 'number' ? b.gdark : null, gsoft: typeof b.gsoft === 'number' ? b.gsoft : null });
        const fireSpace = () => { F.lastSpaceTry = t; space(F.opts.spaceTarget); };
        if (rec.space) fireSpace();
        else if (!tapOk && b.via === 'anywhere' && b.glyph === true) fireSpace();
      }
      return;
    }

    // 2. a locked dial: play it
    if (F.geo) {
      const s = o.sample ? o.sample(F.geo) : (F.sample ? F.sample(F.geo) : null);
      if (!s || !s.valid || s.ring < 0.7) {
        F.dialBlinks = (F.dialBlinks || 0) + 1;
        if (++F.bad > 3) {
          if (F.pressesThisDial > 0 && t - F.lastPress < (F.opts.relockGraceMs || 450)) return;
          if (F.pressesThisDial === 0 && spinAlive(F.geo, t)) { F.stats.narrowHolds = (F.stats.narrowHolds || 0) + 1; return; }
          cancelPend(F, o);
          closeDial(F, t, s && s.ring, o);
          F.geo = null; F.bad = 0; F.pressesThisDial = 0;
        }
        return;
      }
      F.bad = 0;
      const pp = F.predProbe;
      if (pp && s.t != null && s.delta != null) {
        const dt = s.t - pp.t;
        if (dt >= 2 && dt <= 40 && !(F.lastPress && F.lastPress > pp.t)) {
          const predicted = wrap180(pp.delta + (pp.omega || 0) * dt / 1000);
          const err = wrap180(Number(s.delta) - predicted);
          if (!F.predLog) F.predLog = [];
          F.predLog.push({ err: +err.toFixed(1), om: pp.omega != null ? Math.round(pp.omega) : null, w: Math.round(Number(s.width) || 0), dt: Math.round(dt) });
          while (F.predLog.length > 400) F.predLog.shift();
        }
      }
      F.predProbe = { t: s.t, delta: s.delta, omega: s.omega };
      settlePress(F, s, F.dialBlinks, t, o);
      if (s.mid != null) {
        if (F.geo._pm != null) {
          const dm = Math.abs(wrap180(Number(s.mid) - F.geo._pm));
          if (dm < 180) F.geo._travel = (F.geo._travel || 0) + dm;
        }
        F.geo._pm = Number(s.mid);
      }
      if (!s.tracked) F.dialBlinks = (F.dialBlinks || 0) + 1;   // a blink after a press is how a new spawn shows
      // Re-arm BEFORE planPress() so a newly proven triangle can press/schedule on this same frame.
      const spawnProven = newTriangle(F.pressStamp, s, F.dialBlinks, F.opts) ||
        (F.acceptedAt != null && t - F.acceptedAt <= (F.opts.rearmAcceptedMs || 600));
      if (rearmReady(spawnProven, F.pressesThisDial, F.opts.maxPressPerDial || 12) &&
          (F.dialRejected || 0) < (F.opts.maxRejectedPerDial || 5)) F.armed = true;
      s.biasMs = F.opts.biasMs || sweepBias(F.opts.sweep, F.stats.presses);
      if (F.geoReasons) F.geoReasons[F.planReason || 'none'] = (F.geoReasons[F.planReason || 'none'] || 0) + 1;
      const plan = planPress({
        t: s.t != null ? s.t : t,
        delta: s.delta, width: s.width, omega: s.omega,
        armed: F.armed && s.tracked && t - F.lastPress > (F.opts.pressGapMs || 120),
        pendingAt: F.pend ? F.pend.at : null,
      }, {
        trigger: (F.armCfg && F.armCfg.trigger) || F.opts.trigger,
        midDeg: F.armCfg && F.armCfg.midDeg != null ? F.armCfg.midDeg : F.opts.midDeg,
        marginDeg: F.opts.marginDeg,
        leadMs: F.opts.leadMs,
        biasMs: s.biasMs,
        horizonMs: F.opts.schedHorizonMs,
        replanMs: F.opts.replanMs,
      });
      F.planReason = plan.reason;
      F.planNow = { pred: plan.pred, win: plan.win };   // what the press probe compares against
      if (s.omega != null && Math.abs(s.omega) > (F.dialMaxOmega || 0)) F.dialMaxOmega = Math.abs(s.omega);
      if (s.delta != null) {
        if (F.dialPrevDelta != null) F.dialTravel = (F.dialTravel || 0) + Math.abs(wrap180(Number(s.delta) - F.dialPrevDelta));
        F.dialPrevDelta = Number(s.delta);
      }
      if (F.cardUntil && t < F.cardUntil) { cancelPend(F, o); return; }   // paper is on top of the dial
      if (s.tracked) {
        if (!F.geoTrace) F.geoTrace = [];
        F.geoTrace.push({ t: Math.round(t - F.geoAt), d: +Number(s.delta).toFixed(1), w: Math.round(s.width || 0),
          om: s.omega == null ? null : Math.round(s.omega), r: plan.reason });
        if (F.geoTrace.length > 48) F.geoTrace.shift();
      }
      if (F.pressesThisDial === 0 && firstPressGate(s.width, s.omega, F.opts)) {
        const stable = fitStable(s.fit, F.opts);
        const budget = firstPressBudget(Number(s.width) || 0, s.omega, F.opts);
        if (!stable && firstPressCanMature(budget, F.opts)) {
          const heldMs = t - (F.geoAt || t);
          const passes = (F.geo && F.geo._travel ? F.geo._travel : 0) / 360;
          if (!(F.stats.holdPassesMax >= passes)) F.stats.holdPassesMax = passes;
          if (heldMs < budget) {
            if (!F.geo._firstHeld) {
              F.geo._firstHeld = true;
              F.stats.firstPressHeld = (F.stats.firstPressHeld || 0) + 1;
              L('first press held', {
                width: Math.round(Number(s.width) || 0),
                omega: s.omega == null ? null : Math.round(s.omega),
                fitN: s.fit ? s.fit.n : 0,
                fitSpan: s.fit ? Math.round(s.fit.span) : 0,
                fitRms: s.fit ? +s.fit.rms.toFixed(1) : null,
              });
            }
            F.planReason = 'first-fit';
            cancelPend(F, o);
            return;
          }
          if (markFirstPressForced(F.stats, F.geo)) {
            L('first press forced', {
              heldMs: Math.round(heldMs),
              budget: Math.round(budget),
              width: Math.round(Number(s.width) || 0),
              omega: s.omega == null ? null : Math.round(s.omega),
              fitN: s.fit ? s.fit.n : 0,
              fitRms: s.fit ? +s.fit.rms.toFixed(1) : null,
            });
          }
        }
      }
      if (plan.cancel) cancelPend(F, o);
      if (plan.armAt != null) armPress(F, plan.armAt, F.geo, s, t, o);
      if (plan.press) doPress(F, s, 'frame', t, o);
      return;
    }

    // 3. nothing on screen: look for a dial now and then (cheap enough at ~4 Hz)
    if (t - F.lastDialCheck > F.opts.dialCheckMs) {
      F.lastDialCheck = t;
      let g = o.lockDial ? o.lockDial(F.hint.x, F.hint.y) : (F.lockDial ? F.lockDial(F.hint.x, F.hint.y) : null);
      if (!g && F.opts.dialFallbackMs && t - Math.max(F.geoAt || 0, F.startedAt) > F.opts.dialFallbackMs) {
        g = o.dialAnywhere ? o.dialAnywhere(t) : null;
      }
      if (g) {
        F.geo = g; F.geoAt = t; F.bad = 0; F.pressesThisDial = 0; F.pressStamp = null; F.dialBlinks = 0; F.dialRejected = 0;
        g._travel = 0; g._pm = null;
        g._armed0 = !!F.armed;
        F.armed = true;                            // arc travel for this lock
        F.geoReasons = {}; F.planReason = null; F.geoTrace = []; F.dialMaxOmega = 0; F.dialTravel = 0; F.dialPrevDelta = null;
        var bc = F.lastBubbleCause, freshBc = bc && (t - bc.at) < (F.opts.castRungResetMs || 10000);
        F.lastDialCause = { tap: !!(freshBc && bc.tap), space: !!(freshBc && bc.space), unknown: !freshBc, at: freshBc ? bc.at : 0, dialAt: t };
        var dcCause = F.lastDialCause.unknown ? 'unknown' : (F.lastDialCause.tap && F.lastDialCause.space ? 'tap+space' : (F.lastDialCause.tap ? 'tap' : (F.lastDialCause.space ? 'space' : 'none')));
        F.bubbleMiss = 0; F.stallRetry = 0;                     // the ladder worked: back to the first rung
        F.bubblePrev = null;                                    // a dial proves the prompt was real: forget tap suspicion
        F.dialAnyFail = 0;                                      // the hint is good: recovery starts prompt
        F.stats.dials++;
        clearResultMissing('dial');
        if (!F.attempt) startAttempt(t);
        if (F.attempt) {
          F.attempt.dials++;
          F.attempt.touched = t;
          F.attempt.pendingLoss = null;
        }
        F.needsSeat = false;                                    // a dial means the cast took
        L('dial locked', { cx: g.cx, cy: g.cy, R: g.R, width: Math.round(g.width), arm: F.dialArm, attempt: F.attempt ? F.attempt.n : null, rung: F.lastRung || 0, cause: dcCause });
        const dialW = Number(g.width) || 0;
        if (F.attempt && dialW > 0) {
          F.attempt.widthSum += dialW;
          F.attempt.widthN += 1;
          F.attempt.maxWidth = Math.max(F.attempt.maxWidth || 0, dialW);
          F.attempt.minWidth = F.attempt.minWidth ? Math.min(F.attempt.minWidth, dialW) : dialW;
        }
        F.lastRung = 0;                                         // logged above: which rung did the casting
        if (!sameDial(F.lastGeo, g)) saveDialMemory(g);       // survives the next reload
        F.lastGeo = { cx: g.cx, cy: g.cy, R: g.R };              // the widget position for the next dial
        F.hint = { x: g.cx, y: g.cy };                           // keep dial hint on off-center seats too
      }
    }

    // 3b. A pressed dial that never produces a catch card or a cast prompt is the client's stuck
    // `waiting-for-result` state, not a missed cast. Latch it before the retry block below so the
    // normal retry and the once-a-minute seat probe both stop; a late card/prompt clears it above.
    if (resultMissingDue(F, t)) {
      markResultMissing(t, 'no catch card or cast prompt');
    }

    const seatProbe = !!(F.castHold && F.opts.seatHoldRetryMs &&
      t - Math.max(F.castHoldAt || 0, F.lastCastTry || 0) > F.opts.seatHoldRetryMs);
    if (!F.resultMissing && (!F.castHold || seatProbe) && F.opts.castRetryMs && t - Math.max(F.lastPress || 0, F.geoAt || 0, F.lastBubbleAt || 0, F.lastCastTry || 0, F.startedAt) > F.opts.castRetryMs) {
      F.lastCastTry = t;
      F.stats.castRetries = (F.stats.castRetries || 0) + 1;
      const tries = (F.stallRetry = (F.stallRetry || 0) + 1);
      const consumed = !space(F.opts.spaceTarget);
      L('cast retry', { consumed, tries, seatHold: !!F.castHold });
    }

    const seatWatch = F.opts.seatWatchdogMs;
    if (seatWatch && !F.geo && !F.needsSeat && !F.resultMissing) {
      const idle = t - Math.max(F.lastPress || 0, F.lastBubbleAt || 0, F.geoAt || 0, F.startedAt);
      if (idle > seatWatch) {
        F.needsSeat = true;
        L('needs a seat', { idleMs: Math.round(idle), why: 'no cast prompt: sit on a waterside chair' });
      }
    }
  }

  return {
    DIAL_COUNTER,
    refreshLossDiagnostic,
    cancelPend,
    pushPressProbe,
    recordPressVerdict,
    settlePress,
    probePressStart,
    doPress,
    armPress,
    closeDial,
    stepFrame,
  };
});
