// @ts-check
/* session.js — pure session state machine for the AutoFish panel.
 * No DOM, no timers, no I/O: the panel feeds facts in and executes the actions out.
 * Browser global: AutoFishSession. CommonJS: require('./session.js').
 */
/**
 * @param {any} root
 * @param {() => AutoFishSessionApi} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    durationMs: 60 * 60 * 1000,
    cooldownMs: 30 * 60 * 1000,
    dailyCapMs: 4 * 60 * 60 * 1000,
    hiddenStopMs: 2 * 60 * 1000,
    chain: false,
    window: { on: false, start: '21:00', stop: '23:00' }
  };

  /**
   * @param {Partial<SessionState>} [overrides]
   * @returns {SessionState}
   */
  function createState(overrides) {
    /** @type {SessionState} */
    var s = {
      phase: 'idle',
      durationMs: DEFAULTS.durationMs,
      cooldownMs: DEFAULTS.cooldownMs,
      dailyCapMs: DEFAULTS.dailyCapMs,
      hiddenStopMs: DEFAULTS.hiddenStopMs,
      chain: DEFAULTS.chain,
      window: { on: DEFAULTS.window.on, start: DEFAULTS.window.start, stop: DEFAULTS.window.stop },
      fishingMs: 0,
      todayMs: 0,
      carriedMs: 0,          // session time fished before the current local day began
      dayStartMs: 0,         // local midnight of the day todayMs belongs to
      startedAt: null,
      lastTickAt: null,
      pauseReason: null,
      pausedAt: null,
      hiddenSince: null,
      visibleSince: null,
      retryAt: null,
      retries: 0,
      seatOverrideUntil: null,
      cooldownUntil: null,
      lastCatchAt: null,
      catchCount: 0,
      errWindowAt: null,
      errCount: 0,
      errTotal: 0,
      stopReason: null,
      stalled: false,
      blindPauseMs: 0,       // deliberate pause time since the last prompt/dial
      blindPauseAt: null,    // start of a deliberate pause that is still open
      blindBubbleMs: null,
      blindDialMs: null,
      blindHiddenPause: false // this hidden episode was seen and credited by the reducer
    };
    if (overrides) {
      for (var k in overrides) {
        if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
        if (k === 'window' && overrides.window) {
          s.window = { on: !!overrides.window.on, start: overrides.window.start, stop: overrides.window.stop };
        } else {
          /** @type {any} */ (s)[k] = /** @type {any} */ (overrides)[k];
        }
      }
    }
    return s;
  }

  /**
   * @param {SessionState} state
   * @returns {SessionState}
   */
  function clone(state) {
    /** @type {any} */
    var s = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) s[k] = /** @type {any} */ (state)[k];
    s.window = { on: state.window.on, start: state.window.start, stop: state.window.stop };
    return s;
  }

  /**
   * @param {number} at
   * @returns {number}
   */
  function minutesOfDay(at) {
    var d = new Date(at);
    return d.getHours() * 60 + d.getMinutes();
  }

  /**
   * @param {string} hhmm
   * @returns {number}
   */
  function parseClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    if (!m) return 0;
    return (Number(m[1]) % 24) * 60 + Number(m[2]);
  }

  /**
   * Is 'at' inside the configured clock window (local time)? A stop before start crosses midnight.
   * @param {ScheduleWindow | null | undefined} win
   * @param {number} at
   * @returns {boolean}
   */
  function withinWindow(win, at) {
    if (!win || !win.on) return true;
    var start = parseClock(win.start);
    var stop = parseClock(win.stop);
    var now = minutesOfDay(at);
    if (start === stop) return true;              // a 24h window, not an empty one
    if (start < stop) return now >= start && now < stop;
    return now >= start || now < stop;            // crosses midnight
  }

  /**
   * @param {SessionPhase} phase
   * @returns {boolean}
   */
  function isActive(phase) {
    return phase === 'running' || phase === 'paused' || phase === 'waiting';
  }

  /**
   * Local midnight for 'at'. A run can outlive the day it began, and only the time after this
   * instant belongs to the new day's cap.
   * @param {number} at
   * @returns {number}
   */
  function localDayStart(at) {
    var d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /**
   * Credit [from, at] as fishing. The whole stretch is session time, but only its tail after local
   * midnight is today's, so one night that crosses midnight cannot spend two days' cap.
   * @param {SessionState} s
   * @param {number} from
   * @param {number} at
   * @returns {void}
   */
  function credit(s, from, at) {
    var delta = Math.max(0, at - from);
    if (!delta) return;
    var day = localDayStart(at);
    if (!s.dayStartMs) {
      s.dayStartMs = day;
    } else if (s.dayStartMs !== day) {
      // Everything fished before this midnight, plus the pre-midnight part of this stretch.
      s.carriedMs = (s.fishingMs || 0) + Math.max(0, Math.min(delta, day - from));
      s.dayStartMs = day;
    }
    s.fishingMs += delta;
  }

  /**
   * A paused run can cross midnight without fishing a frame; its carry still moves.
   * @param {SessionState} s
   * @param {number} at
   * @returns {void}
   */
  function rollDay(s, at) {
    var day = localDayStart(at);
    if (!s.dayStartMs) s.dayStartMs = day;
    else if (s.dayStartMs !== day) {
      s.carriedMs = s.fishingMs || 0;
      s.dayStartMs = day;
    }
  }

  /**
   * How much of the live session may spend the current day's cap.
   * @param {SessionState} s
   * @returns {number}
   */
  function todayFishingMs(s) {
    return Math.max(0, (s.fishingMs || 0) - (s.carriedMs || 0));
  }

  /**
   * @param {SessionState} s
   * @param {number} at
   * @param {string | null | undefined} reason
   * @param {Record<string, unknown> | null} [diag]
   * @returns {SessionAction[]}
   */
  function stopSession(s, at, reason, diag) {
    if (s.phase === 'running' && s.lastTickAt != null) credit(s, s.lastTickAt, at);
    rollDay(s, at);
    // The session's minutes become today's minutes - but only the part fished after local midnight.
    // Keeping them in fishingMs meant a restart forgot them: the cap under-counted and the panel's
    // "today" dropped back to the base.
    var sessionMs = s.fishingMs;
    s.todayMs = (s.todayMs || 0) + todayFishingMs(s);
    s.fishingMs = 0;
    s.carriedMs = 0;
    // A schedule boundary is not a rest. The clock window and the daily cap end the run until the
    // next window or the next day; forcing a 30-minute cooldown on top made the panel look stuck and
    // could make a second session collide with a closed window. Only a real stop rests.
    var rest = reason !== 'daily-cap' && reason !== 'window';
    s.phase = rest ? 'cooldown' : 'idle';
    s.cooldownUntil = rest ? at + s.cooldownMs : null;
    s.stopReason = reason || 'user';
    s.pauseReason = null;
    s.pausedAt = null;
    s.seatOverrideUntil = null;
    s.retryAt = null;
    s.lastTickAt = null;
    return [
      { type: 'stopCore' },
      { type: 'releaseWakeLock' },
      { type: 'sessionRow', reason: s.stopReason, minutes: Math.round(sessionMs / 60000), catches: s.catchCount, diag: diag || null },
      { type: 'persist' }
    ];
  }

  var NO_CATCH_MS = 10 * 60 * 1000;   // nothing bites for this long -> check the page
  var CAST_STALL_MS = 90 * 1000;       // post-catch, no prompt and no dial this long -> the cast never landed
  // cast-stall, player-block and profile-open share no-catch's bounded retry: pause, retry, then stop.
  /**
   * @param {PauseReason | null} reason
   * @returns {reason is 'no-catch' | 'cast-stall' | 'player-block' | 'profile-open'}
   */
  function retryable(reason) {
    return reason === 'no-catch' || reason === 'cast-stall' || reason === 'player-block' || reason === 'profile-open';
  }

  var RETRY_DELAY_MS = 60 * 1000;
  var MAX_RETRIES = 3;
  var HIDDEN_PAUSE_MS = 5000;         // the game freezes while the tab is hidden
  var HIDDEN_STOP_MS = 120 * 1000;
  var RESUME_AFTER_MS = 3000;         // stay back this long before trusting the tab again
  var ERR_WINDOW_MS = 60 * 1000;
  var ERR_LIMIT = 20;
  var SEAT_STOP_MS = 30 * 60 * 1000;   // an unseated character cannot bite; give up rather than sit there forever
  var SEAT_OVERRIDE_MS = 15 * 1000;    // a Resume or retry runs this long despite the seat fact

  /**
   * A hold the user asked for, not a detector stall. Its time does not count as blindness.
   * @param {PauseReason | null} reason
   * @returns {boolean}
   */
  function deliberatePause(reason) {
    return reason === 'hidden' || reason === 'user' || reason === 'seat' || reason === 'focus';
  }

  /**
   * @param {SessionState} s
   * @param {number} at
   * @returns {void}
   */
  function beginBlindPause(s, at) {
    if (s.blindPauseAt == null) s.blindPauseAt = at;
  }

  /**
   * @param {SessionState} s
   * @param {number} at
   * @returns {void}
   */
  function endBlindPause(s, at) {
    if (s.blindPauseAt == null) return;
    s.blindPauseMs = (s.blindPauseMs || 0) + Math.max(0, at - s.blindPauseAt);
    s.blindPauseAt = null;
  }

  /**
   * A new prompt or dial starts a fresh blind interval, so earlier deliberate pauses no longer count.
   * @param {SessionState} s
   * @param {Extract<SessionFact, { type: 'tick' }>} fact
   * @param {number} at
   * @returns {void}
   */
  function observeBlindSignals(s, fact, at) {
    var bubble = typeof fact.sinceBubbleMs === 'number' ? fact.sinceBubbleMs : null;
    var dial = typeof fact.sinceDialMs === 'number' ? fact.sinceDialMs : null;
    var fresh = (bubble != null && (s.blindBubbleMs == null || bubble < s.blindBubbleMs)) ||
                (dial != null && (s.blindDialMs == null || dial < s.blindDialMs));
    if (bubble != null) s.blindBubbleMs = bubble;
    if (dial != null) s.blindDialMs = dial;
    if (fresh) {
      s.blindPauseMs = 0;
      if (s.blindPauseAt != null) s.blindPauseAt = at;
    }
  }

  /**
   * A new core has no pause history, even when a watchdog started it without a reducer action.
   * @param {SessionState} s
   * @returns {SessionState}
   */
  function clearBlindPause(s) {
    s.blindPauseMs = 0;
    s.blindPauseAt = null;
    s.blindBubbleMs = null;
    s.blindDialMs = null;
    s.blindHiddenPause = false;
    return s;
  }

  /**
   * @param {SessionState} s
   * @param {number} at
   * @param {PauseReason} reason
   * @returns {ReduceResult}
   */
  function paused(s, at, reason) {
    var wasDeliberate = deliberatePause(s.pauseReason);
    var willBeDeliberate = deliberatePause(reason);
    if (!wasDeliberate && willBeDeliberate) beginBlindPause(s, at);
    else if (wasDeliberate && !willBeDeliberate) endBlindPause(s, at);
    s.phase = 'paused';
    s.pauseReason = reason;
    s.pausedAt = at;
    s.lastTickAt = null;
    s.visibleSince = null;
    if (reason === 'hidden') s.blindHiddenPause = true;
    if (retryable(reason)) s.retryAt = at + RETRY_DELAY_MS;
    // 'seat' is the one pause that must NOT stop the core: the core is the only thing watching for
    // the cast prompt to come back, and it is what clears needsSeat when the player sits down again.
    // Keeping it alive is only safe if it cannot ACT while it waits: an unthrottled cast retry puts
    // a line in the water, which removes the prompt the pause is waiting for, so the two would wait
    // forever (measured live 2026-11-02: 69 retries, paused on seat, line out, no recovery).
    /** @type {SessionAction[]} */
    var actions = [];
    if (reason === 'seat') {
      s.seatSince = at;
      actions.push({ type: 'holdCasts', on: true });
    } else {
      actions.push({ type: 'pauseCore' });
    }
    s.seatOverrideUntil = null;          // any new hold invalidates an earlier grace window
    if (reason === 'hidden') actions.push({ type: 'releaseWakeLock' });
    actions.push({ type: 'persist' });
    return { state: s, actions: actions };
  }

  /**
   * @param {SessionState} s
   * @param {number} at
   * @returns {ReduceResult}
   */
  function runningAgain(s, at) {
    var wasSeat = s.pauseReason === 'seat';
    if (deliberatePause(s.pauseReason)) endBlindPause(s, at);
    s.phase = 'running';
    s.pauseReason = null;
    s.pausedAt = null;
    s.retryAt = null;
    s.visibleSince = null;
    s.hiddenSince = null;
    s.seatSince = null;
    s.lastTickAt = at;
    /** @type {SessionAction[]} */
    var actions = wasSeat ? [{ type: 'holdCasts', on: false }] : [];
    return { state: s, actions: actions.concat([{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }]) };
  }

  /**
   * @param {SessionState} s
   * @param {number} at
   * @param {Extract<SessionFact, { type: 'tick' }>} fact
   * @returns {ReduceResult}
   */
  function tickPaused(s, at, fact) {
    if (typeof fact.todayMs === 'number') s.todayMs = fact.todayMs;
    rollDay(s, at);
    // A user pause is an explicit hold: the tab coming back, a seat appearing or a catch landing
    // must not resume it behind the user's back. Only the Resume button (or a fresh Start) does.
    if (s.pauseReason === 'user') return { state: s, actions: [] };
    // A missing result is the game's own input lock, not a temporary guard: no tick and no
    // automatic retry can clear it. The panel tells the player to reload the tab; Stop still ends
    // the session normally.
    if (s.pauseReason === 'result-missing') return { state: s, actions: [] };

    // A focus hold is a decision, not a guard: it takes over a hidden or seat pause before
    // those branches can resume or stop the run. The user hold above still wins.
    if (fact.focus) {
      if (s.pauseReason === 'focus') return { state: s, actions: [] };
      var wasSeat = s.pauseReason === 'seat';
      var focusPaused = paused(s, at, 'focus');
      s.seatSince = null;
      s.hiddenSince = null;
      if (wasSeat) focusPaused.actions.unshift({ type: 'holdCasts', on: false });
      return focusPaused;
    }
    var visible = fact.visible !== false;
    if (s.pauseReason === 'hidden') {
      if (!visible) {
        if (s.hiddenSince == null) s.hiddenSince = at;
        if (at - s.hiddenSince > (s.hiddenStopMs || HIDDEN_STOP_MS)) return { state: s, actions: stopSession(s, at, 'hidden') };
        return { state: s, actions: [] };
      }
      if (s.visibleSince == null) { s.visibleSince = at; return { state: s, actions: [] }; }
      if (at - s.visibleSince >= RESUME_AFTER_MS) return runningAgain(s, at);
      return { state: s, actions: [] };
    }
    if (s.pauseReason === 'seat') {
      // The character's clock stops, the wall clock does not: while the seat pause holds, the
      // schedule and the day's budget keep moving. Do not sit paused past a closed window or into a
      // cap that is already spent - that would resume straight into an immediate stop.
      if (s.window.on && !withinWindow(s.window, at)) {
        return { state: s, actions: stopSession(s, at, 'window') };
      }
      if (typeof fact.todayMs === 'number' && s.todayMs >= s.dailyCapMs) {
        return { state: s, actions: stopSession(s, at, 'daily-cap') };
      }
      // still unseated: burn no time, but do not nag forever
      if (fact.seat === false) return runningAgain(s, at);
      if (s.seatSince != null && at - s.seatSince > SEAT_STOP_MS) {
        return { state: s, actions: stopSession(s, at, 'no-seat') };
      }
      return { state: s, actions: [] };
    }
    if (s.pauseReason === 'focus') {
      // A focus hold ends when the session does, never on a timer: the panel clears the fact.
      return runningAgain(s, at);
    }
    if (retryable(s.pauseReason)) {
      if (s.retryAt != null && at >= s.retryAt) {
        if (s.retries >= MAX_RETRIES) return { state: s, actions: stopSession(s, at, s.pauseReason) };
        s.retries += 1;
        s.lastCatchAt = at;
        // The seat fact can still be true because the watchdog saw a line already out, not a
        // standing character. A user Resume gets a grace window for exactly that reason; an
        // automatic retry needs one too, or its very next tick pauses on seat before the retry's
        // cast can bring the prompt back, leaving the seat probe to recover it a minute later.
        s.seatOverrideUntil = at + SEAT_OVERRIDE_MS;
        return runningAgain(s, at);
      }
    }
    return { state: s, actions: [] };
  }

  /**
   * @param {SessionState} state
   * @param {SessionFact} fact
   * @returns {ReduceResult}
   */
  function reduce(state, fact) {
    var s = clone(state);
    // A fact without an explicit clock used to fall back to 0, which made the next real tick credit
    // (now - 0) milliseconds of fishing time and stop the session as a daily-cap hit. Fall back to
    // the wall clock instead; every caller that cares passes its own at.
    var at = Number(fact.at) || Date.now();

    if (fact.type === 'config') {
      var patch = fact.patch || {};
      for (var k in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        if (k === 'window' && patch.window) {
          s.window = {
            on: patch.window.on === undefined ? s.window.on : !!patch.window.on,
            start: patch.window.start === undefined ? s.window.start : patch.window.start,
            stop: patch.window.stop === undefined ? s.window.stop : patch.window.stop
          };
        } else {
          /** @type {any} */ (s)[k] = /** @type {any} */ (patch)[k];
        }
      }
      return { state: s, actions: [{ type: 'persist' }] };
    }

    if (fact.type === 'start') {
      if (isActive(s.phase)) return { state: s, actions: [] };
      if (s.cooldownUntil != null && at < s.cooldownUntil) {
        return { state: s, actions: [{ type: 'refuse', reason: 'cooldown' }] };
      }
      if (s.todayMs >= s.dailyCapMs) {
        return { state: s, actions: [{ type: 'refuse', reason: 'daily-cap' }] };
      }
      s.fishingMs = 0;
      s.carriedMs = 0;
      s.dayStartMs = localDayStart(at);
      s.catchCount = 0;
      s.retries = 0;
      s.retryAt = null;
      s.errCount = 0;
      s.errWindowAt = null;
      s.errTotal = 0;
      s.pauseReason = null;
      s.pausedAt = null;
      clearBlindPause(s);
      s.seatOverrideUntil = null;
      s.hiddenSince = null;
      s.visibleSince = null;
      s.stopReason = null;
      s.startedAt = at;
      s.lastTickAt = at;
      s.lastCatchAt = at;
      if (!withinWindow(s.window, at)) {
        s.phase = 'waiting';
        return { state: s, actions: [{ type: 'persist' }] };
      }
      s.phase = 'running';
      return {
        state: s,
        actions: [
          { type: 'startCore', maxMinutes: Math.ceil(s.durationMs / 60000) + 2 },
          { type: 'wakeLock' },
          { type: 'persist' }
        ]
      };
    }

    if (fact.type === 'stop') {
      if (!isActive(s.phase)) return { state: s, actions: [] };
      return { state: s, actions: stopSession(s, at, fact.reason, fact.diag) };
    }

    if (fact.type === 'hidden-start') {
      // A new hidden episode. Do not clear the marker if the reducer is already inside the hidden
      // pause; only a fresh episode should hand the gap back to the visibility return.
      if (!(s.phase === 'paused' && s.pauseReason === 'hidden')) s.blindHiddenPause = false;
      return { state: s, actions: [] };
    }

    if (fact.type === 'hidden-return') {
      // If the reducer saw the hidden pause, it credits that pause on resume. The panel only fills
      // in a gap the reducer never saw (a throttled background tab). A user/seat/focus hold already
      // has its own pause credit, so it covers the gap as well.
      if (s.blindHiddenPause) return { state: s, actions: [] };
      var hiddenMs = Math.max(0, Number(fact.hiddenMs) || 0);
      var active = s.phase === 'running' || s.phase === 'paused';
      var covered = s.phase === 'paused' && deliberatePause(s.pauseReason);
      if (hiddenMs && active && !covered) s.blindPauseMs = (s.blindPauseMs || 0) + hiddenMs;
      return { state: s, actions: [] };
    }

    if (fact.type === 'pause') {
      // Pause is a hold, not a stop: the session, its length and today's budget all survive, and no
      // cooldown is started. Time up to this instant is credited; the hold itself is not fishing.
      if (s.phase !== 'running') return { state: s, actions: [] };
      if (s.lastTickAt != null) credit(s, s.lastTickAt, at);
      s.phase = 'paused';
      s.pauseReason = fact.reason === 'focus' ? 'focus' : 'user';
      if (deliberatePause(s.pauseReason)) beginBlindPause(s, at);
      s.pausedAt = at;
      s.lastTickAt = null;
      s.hiddenSince = null;
      s.visibleSince = null;
      s.seatSince = null;
      s.retryAt = null;
      return { state: s, actions: [{ type: 'pauseCore' }, { type: 'releaseWakeLock' }, { type: 'persist' }] };
    }

    if (fact.type === 'resume') {
      if (s.phase !== 'paused') return { state: s, actions: [] };
      // Resume cannot deliver the game's missing result; it would re-pause on the next tick. Refuse
      // it explicitly so the panel can say to reload the game tab instead.
      if (s.pauseReason === 'result-missing') return { state: s, actions: [{ type: 'refuse', reason: 'result-missing' }] };
      rollDay(s, at);
      // Do not resume straight into a boundary: the next tick would stop the session immediately and
      // the user would see a resume that did nothing. The cap and the window are checked up front.
      if (s.todayMs + todayFishingMs(s) >= s.dailyCapMs) return { state: s, actions: [{ type: 'refuse', reason: 'daily-cap' }] };
      if (s.window.on && !withinWindow(s.window, at)) return { state: s, actions: [{ type: 'refuse', reason: 'window' }] };
      if (deliberatePause(s.pauseReason)) endBlindPause(s, at);
      var fromSeat = s.pauseReason === 'seat';
      s.phase = 'running';
      s.pauseReason = null;
      s.pausedAt = null;
      // A hold is not a stretch without a bite: both the no-catch and cast-stall clocks start from
      // this, and leaving the pre-pause catch time here made the first tick after a long hold pause
      // again immediately (measured live 2026-11-24: resume, then pauseReason 'no-catch' 0.9 s later).
      s.lastCatchAt = at;
      s.retryAt = null;
      s.hiddenSince = null;
      s.visibleSince = null;
      s.seatSince = null;
      // The seat fact comes from the core's own watchdog and can stay true while a line is already
      // out. Pausing again on the very next tick made Resume look broken; a short grace window lets
      // the user act (reel, or let the retry cast) before the seat hold is re-applied.
      s.seatOverrideUntil = fromSeat ? at + SEAT_OVERRIDE_MS : null;
      s.lastTickAt = at;
      /** @type {SessionAction[]} */
      var actions = fromSeat ? [{ type: 'holdCasts', on: false }] : [];
      return { state: s, actions: actions.concat([{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }]) };
    }

    if (fact.type === 'skip-cooldown') {
      // The cooldown is self-imposed, so it needs an escape hatch. The user still gets a confirmation
      // in the panel; this fact only clears the wait and lets the next start be a real start.
      if (s.phase !== 'cooldown') return { state: s, actions: [] };
      s.phase = 'idle';
      s.cooldownUntil = null;
      s.stopReason = null;
      return { state: s, actions: [{ type: 'persist' }] };
    }

    if (fact.type === 'tick') {
      observeBlindSignals(s, fact, at);
      if (s.phase === 'cooldown') {
        if (s.cooldownUntil != null && at >= s.cooldownUntil) {
          // Optional chaining: rest, then run again, for an unattended night. It is still bounded
          // by the clock window and the daily cap, and a hidden tab never starts a run.
          var canChain = s.chain && fact.visible !== false && withinWindow(s.window, at) && (s.todayMs || 0) < s.dailyCapMs;
          if (canChain) {
            s.phase = 'running';
            s.cooldownUntil = null;
            s.stopReason = null;
            s.fishingMs = 0;
            s.carriedMs = 0;
            s.dayStartMs = localDayStart(at);
            s.catchCount = 0;
            s.retries = 0;
            s.errCount = 0;
            s.errTotal = 0;
            s.startedAt = at;
            s.lastTickAt = at;
            s.lastCatchAt = at;
            clearBlindPause(s);
            return {
              state: s,
              actions: [
                { type: 'startCore', maxMinutes: Math.ceil(s.durationMs / 60000) + 2 },
                { type: 'wakeLock' },
                { type: 'persist' }
              ]
            };
          }
          s.phase = 'idle';
          s.cooldownUntil = null;
          return { state: s, actions: [{ type: 'persist' }] };
        }
        return { state: s, actions: [] };
      }
      if (s.phase === 'waiting') {
        if (withinWindow(s.window, at)) {
          s.phase = 'running';
          s.startedAt = at;
          s.lastTickAt = at;
          clearBlindPause(s);
          return {
            state: s,
            actions: [
              { type: 'startCore', maxMinutes: Math.ceil(s.durationMs / 60000) + 2 },
              { type: 'wakeLock' },
              { type: 'persist' }
            ]
          };
        }
        return { state: s, actions: [] };
      }
      if (s.phase === 'paused') return tickPaused(s, at, fact);
      if (s.phase !== 'running') return { state: s, actions: [] };

      var visible = fact.visible !== false;
      if (typeof fact.todayMs === 'number') s.todayMs = fact.todayMs;

      // 0. a focus session is a hold the user asked for: credit the time fished so far, then stop
      // the clock and the core. Not retryable - nothing is broken, the player is focusing.
      if (fact.focus) {
        if (s.lastTickAt != null) credit(s, s.lastTickAt, at);
        return paused(s, at, 'focus');
      }

      // 1. the game only runs while the tab is visible: a hidden stretch is not fishing time
      if (!visible) {
        if (s.hiddenSince == null) s.hiddenSince = at;
        s.lastTickAt = at;
        if (at - s.hiddenSince > (s.hiddenStopMs || HIDDEN_STOP_MS)) return { state: s, actions: stopSession(s, at, 'hidden') };
        if (at - s.hiddenSince > HIDDEN_PAUSE_MS) return paused(s, at, 'hidden');
        return { state: s, actions: [] };
      }
      s.hiddenSince = null;

      // 1a. A win-like attempt that never produced a catch card or a cast prompt leaves the game
      // waiting for its fishing result. It disables input until that result arrives, so no retry or
      // seat probe can help; pause the clock and the core with a distinct, non-retryable reason.
      if (fact.resultMissing === true) {
        if (s.lastTickAt != null) credit(s, s.lastTickAt, at);
        return paused(s, at, 'result-missing');
      }

      // 1b. not seated means the game will never offer a cast prompt: pause before crediting any
      // time, so an overnight session does not spend its budget waiting for a chair. A user Resume
      // buys a short grace window, so the same fact cannot re-pause the very next tick.
      if (fact.seat === true) {
        if (!(s.seatOverrideUntil != null && at < s.seatOverrideUntil)) return paused(s, at, 'seat');
      } else if (s.seatOverrideUntil != null) {
        s.seatOverrideUntil = null;      // seated again: the window has nothing left to override
      }

      // 1c. a stalled core is not fishing. The loop can lose its animation frames while the tab
      // still reads as visible (an occluded window), and the panel used to keep charging the budget
      // for frames that never happened - measured live 2026-10-28 at 10.7 minutes of silence.
      if (fact.stalled === true) {
        s.stalled = true;
        s.lastTickAt = at;                 // no credit: no frames, no fishing time
      } else {
        s.stalled = false;
        if (s.lastTickAt != null) credit(s, s.lastTickAt, at);
        s.lastTickAt = at;
      }

      // 2. catches (also the no-catch clock)
      if (typeof fact.catches === 'number') {
        if (fact.catches > s.catchCount) s.lastCatchAt = at;
        s.catchCount = fact.catches;
      }

      // 3. an error burst means the page changed under us
      if (typeof fact.errors === 'number') {
        var prevErr = s.errTotal || 0;
        if (fact.errors > prevErr) {
          if (s.errWindowAt == null || at - s.errWindowAt > ERR_WINDOW_MS) {
            s.errWindowAt = at;
            s.errCount = 0;
          }
          s.errCount += fact.errors - prevErr;
          if (s.errCount > ERR_LIMIT) return { state: s, actions: stopSession(s, at, 'errors') };
        }
        s.errTotal = fact.errors;
      }

      // 4. the clock window closing ends the session; 5. so does the daily cap
      if (s.window.on && !withinWindow(s.window, at)) {
        return { state: s, actions: stopSession(s, at, 'window') };
      }
      if (typeof fact.todayMs === 'number' && s.todayMs + todayFishingMs(s) >= s.dailyCapMs) {
        return { state: s, actions: stopSession(s, at, 'daily-cap') };
      }

      // 6. duration
      if (s.fishingMs >= s.durationMs) {
        return { state: s, actions: stopSession(s, at, 'duration') };
      }

      // 7. nothing has bitten in a while
      var sinceCatch = at - (s.lastCatchAt == null ? (s.startedAt || 0) : s.lastCatchAt);
      // A profile modal open over the game blocks prompts without stopping the clock: pause
      // with a named reason instead of burning the session as a generic no-catch.
      // a profile modal open over the game blocks prompts and swallows inputs: pause first,
      // before the tap-suppression backstop below ever gets its three fruitless taps
      if (fact.profileOpen === true) {
        return paused(s, at, 'profile-open');
      }
      if (fact.playerBlocked === true) {
        return paused(s, at, 'player-block');
      }
      // Post-catch, neither a prompt nor a dial for 90 s means the cast never landed
      // (missed reel, line out, or a modal swallowing inputs) — still short of the 10-minute
      // no-bite watchdog, so pause early with a distinct reason and the same bounded retry.
      if (sinceCatch > CAST_STALL_MS && sinceCatch <= NO_CATCH_MS &&
          typeof fact.sinceBubbleMs === 'number' && typeof fact.sinceDialMs === 'number' &&
          fact.sinceBubbleMs > CAST_STALL_MS && fact.sinceDialMs > CAST_STALL_MS) {
        return paused(s, at, 'cast-stall');
      }
      if (sinceCatch > NO_CATCH_MS) {
        if (s.retries >= MAX_RETRIES) return { state: s, actions: stopSession(s, at, 'no-catch') };
        return paused(s, at, 'no-catch');
      }
      return { state: s, actions: [] };
    }

    return { state: s, actions: [] };
  }

  /**
   * The panel owns the phase; the core owns the frames. A tick loop that threw before its dispatch
   * leaves the phase at `running` with a core that has stopped, and nothing used to revive it -
   * measured live 2026-11-24: `phase: running`, `fishingMs` no longer moving, core `running: false`.
   * This predicate is pure so the zombie case is testable without a page; panel.js asks it every
   * 5 s from a timer that is separate from the tick loop.
   * @param {SessionState | null | undefined} state
   * @param {CoreStatusLike | null | undefined} status
   * @returns {'revive' | null}
   */
  function coreGuard(state, status) {
    if (!state || state.phase !== 'running') return null;
    if (!status || typeof status.running !== 'boolean') return null;
    return status.running === false ? 'revive' : null;
  }

  var REVIVE_WINDOW_MS = 10 * 60 * 1000;   // rolling window for crash-loop accounting
  var REVIVE_CAP = 3;                      // restarts allowed inside it before the session stops

  /**
   * A core that keeps dying is not a liveness problem any more. Three restarts in ten minutes means
   * the game (or the page) is broken, and restarting it for hours hides that. The window is rolling
   * and times are pruned on every call; a refused revive is not recorded, so a stop at the cap keeps
   * the three timestamps that caused it. Pure, so the cap has a unit test.
   * @param {number[] | null | undefined} times
   * @param {number} now
   * @returns {ReviveGateResult}
   */
  function reviveGate(times, now) {
    /** @type {number[]} */
    var kept = [];
    (times || []).forEach(function (t) {
      if (typeof t === 'number' && now - t < REVIVE_WINDOW_MS) kept.push(t);
    });
    if (kept.length >= REVIVE_CAP) return { allow: false, times: kept };
    kept.push(now);
    return { allow: true, times: kept };
  }

  var BLIND_WARN_MS = 3 * 60 * 1000;   // a detector this blind is not waiting for a bite

  /**
   * A blind detector is not a slow bite. doctor() names it after 45 s, but a real blind run pauses
   * as cast-stall at 90 s and keeps retrying, so this measures the silence itself: the newer of the
   * last prompt and the last dial, or the current core run when neither has been seen. The age is
   * capped at that run's own age (and the session's) because the core keeps `geoAt` across a new
   * session and a reload starts a fresh detector; without the cap, a dial from yesterday could make
   * a fresh run look blind at once. Deliberate user/seat/focus holds, and hidden gaps reported by the
   * panel's visibility return, are subtracted; cast-stall and no-catch are detector failures and
   * still count. Returns the raw silence age, or null; blindWarning applies the three-minute
   * boundary. Pure, so both the boundary and the raw age are testable.
   * @param {BlindFacts | null | undefined} s
   * @returns {number | null}
   */
  function blindSilence(s) {
    if (!s || s.running !== true || s.stalled || s.visible === false) return null;
    var active = s.phase === 'running' ||
      (s.phase === 'paused' && (s.pauseReason === 'cast-stall' || s.pauseReason === 'no-catch'));
    if (!active) return null;
    var sessionAge = typeof s.startedAt === 'number' && typeof s.now === 'number'
      ? s.now - s.startedAt : null;
    var runAge = typeof s.runAgeMs === 'number' ? s.runAgeMs : null;
    var cap = runAge != null ? runAge : sessionAge;
    if (sessionAge != null && cap != null) cap = Math.min(cap, sessionAge);
    /** @type {number[]} */
    var ages = [];
    if (typeof s.sinceBubbleMs === 'number') ages.push(s.sinceBubbleMs);
    if (typeof s.sinceDialMs === 'number') ages.push(s.sinceDialMs);
    var blindMs = ages.length ? Math.min.apply(null, ages) : cap;
    if (blindMs != null && cap != null) blindMs = Math.min(blindMs, cap);
    var pauseMs = typeof s.pauseMs === 'number' && isFinite(s.pauseMs) ? Math.max(0, s.pauseMs) : 0;
    if (blindMs != null) blindMs = Math.max(0, blindMs - pauseMs);
    return blindMs;
  }

  /**
   * The warning boundary: the same silence, or null while it is still a plausible bite wait.
   * @param {BlindFacts | null | undefined} s
   * @returns {number | null}
   */
  function blindWarning(s) {
    var blindMs = blindSilence(s);
    return blindMs != null && blindMs >= BLIND_WARN_MS ? blindMs : null;
  }

  return { DEFAULTS: DEFAULTS, createState: createState, reduce: reduce, withinWindow: withinWindow, parseClock: parseClock, coreGuard: coreGuard, reviveGate: reviveGate, blindSilence: blindSilence, blindWarning: blindWarning, clearBlindPause: clearBlindPause };
});
