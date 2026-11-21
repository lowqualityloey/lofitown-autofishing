/* session.js — pure session state machine for the AutoFish panel.
 * No DOM, no timers, no I/O: the panel feeds facts in and executes the actions out.
 * Browser global: AutoFishSession. CommonJS: require('./session.js').
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

  function createState(overrides) {
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
      stalled: false
    };
    if (overrides) {
      for (var k in overrides) {
        if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
        if (k === 'window') {
          s.window = { on: !!overrides.window.on, start: overrides.window.start, stop: overrides.window.stop };
        } else {
          s[k] = overrides[k];
        }
      }
    }
    return s;
  }

  function clone(state) {
    var s = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) s[k] = state[k];
    s.window = { on: state.window.on, start: state.window.start, stop: state.window.stop };
    return s;
  }

  function minutesOfDay(at) {
    var d = new Date(at);
    return d.getHours() * 60 + d.getMinutes();
  }

  function parseClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    if (!m) return 0;
    return (Number(m[1]) % 24) * 60 + Number(m[2]);
  }

  /** Is 'at' inside the configured clock window (local time)? A stop before start crosses midnight. */
  function withinWindow(win, at) {
    if (!win || !win.on) return true;
    var start = parseClock(win.start);
    var stop = parseClock(win.stop);
    var now = minutesOfDay(at);
    if (start === stop) return true;              // a 24h window, not an empty one
    if (start < stop) return now >= start && now < stop;
    return now >= start || now < stop;            // crosses midnight
  }

  function isActive(phase) {
    return phase === 'running' || phase === 'paused' || phase === 'waiting';
  }

  /** Local midnight for 'at'. A run can outlive the day it began, and only the time after this
   * instant belongs to the new day's cap. */
  function localDayStart(at) {
    var d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** Credit [from, at] as fishing. The whole stretch is session time, but only its tail after local
   * midnight is today's, so one night that crosses midnight cannot spend two days' cap. */
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

  /** A paused run can cross midnight without fishing a frame; its carry still moves. */
  function rollDay(s, at) {
    var day = localDayStart(at);
    if (!s.dayStartMs) s.dayStartMs = day;
    else if (s.dayStartMs !== day) {
      s.carriedMs = s.fishingMs || 0;
      s.dayStartMs = day;
    }
  }

  /** How much of the live session may spend the current day's cap. */
  function todayFishingMs(s) {
    return Math.max(0, (s.fishingMs || 0) - (s.carriedMs || 0));
  }

  function stopSession(s, at, reason) {
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
    s.seatOverrideUntil = null;
    s.retryAt = null;
    s.lastTickAt = null;
    return [
      { type: 'stopCore' },
      { type: 'releaseWakeLock' },
      { type: 'sessionRow', reason: s.stopReason, minutes: Math.round(sessionMs / 60000), catches: s.catchCount },
      { type: 'persist' }
    ];
  }

  var NO_CATCH_MS = 10 * 60 * 1000;   // nothing bites for this long -> check the page
  var CAST_STALL_MS = 90 * 1000;       // post-catch, no prompt and no dial this long -> the cast never landed
  // cast-stall, player-block and profile-open share no-catch's bounded retry: pause, retry, then stop.
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

  function paused(s, at, reason) {
    s.phase = 'paused';
    s.pauseReason = reason;
    s.lastTickAt = null;
    s.visibleSince = null;
    if (retryable(reason)) s.retryAt = at + RETRY_DELAY_MS;
    // 'seat' is the one pause that must NOT stop the core: the core is the only thing watching for
    // the cast prompt to come back, and it is what clears needsSeat when the player sits down again.
    // Keeping it alive is only safe if it cannot ACT while it waits: an unthrottled cast retry puts
    // a line in the water, which removes the prompt the pause is waiting for, so the two would wait
    // forever (measured live 2026-11-02: 69 retries, paused on seat, line out, no recovery).
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

  function runningAgain(s, at) {
    var wasSeat = s.pauseReason === 'seat';
    s.phase = 'running';
    s.pauseReason = null;
    s.retryAt = null;
    s.visibleSince = null;
    s.hiddenSince = null;
    s.seatSince = null;
    s.lastTickAt = at;
    var actions = wasSeat ? [{ type: 'holdCasts', on: false }] : [];
    return { state: s, actions: actions.concat([{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }]) };
  }

  function tickPaused(s, at, fact) {
    if (typeof fact.todayMs === 'number') s.todayMs = fact.todayMs;
    rollDay(s, at);
    // A user pause is an explicit hold: the tab coming back, a seat appearing or a catch landing
    // must not resume it behind the user's back. Only the Resume button (or a fresh Start) does.
    if (s.pauseReason === 'user') return { state: s, actions: [] };
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
      if (fact.focus) return { state: s, actions: [] };
      return runningAgain(s, at);
    }
    // A focus hold is a decision, not a stall. If the hold engages while a guard already has the run
    // paused (player-block, no-catch), it takes the pause over, so that guard's retry can never slip
    // a tick of fishing through mid-session. A user pause still outranks it, above.
    if (fact.focus) return paused(s, at, 'focus');
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

  function reduce(state, fact) {
    var s = clone(state);
    var actions = [];
    // A fact without an explicit clock used to fall back to 0, which made the next real tick credit
    // (now - 0) milliseconds of fishing time and stop the session as a daily-cap hit. Fall back to
    // the wall clock instead; every caller that cares passes its own at.
    var at = Number(fact.at) || Date.now();

    if (fact.type === 'config') {
      var patch = fact.patch || {};
      for (var k in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        if (k === 'window') {
          s.window = {
            on: patch.window.on === undefined ? s.window.on : !!patch.window.on,
            start: patch.window.start === undefined ? s.window.start : patch.window.start,
            stop: patch.window.stop === undefined ? s.window.stop : patch.window.stop
          };
        } else {
          s[k] = patch[k];
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
      return { state: s, actions: stopSession(s, at, fact.reason) };
    }


    if (fact.type === 'pause') {
      // Pause is a hold, not a stop: the session, its length and today's budget all survive, and no
      // cooldown is started. Time up to this instant is credited; the hold itself is not fishing.
      if (s.phase !== 'running') return { state: s, actions: [] };
      if (s.lastTickAt != null) credit(s, s.lastTickAt, at);
      s.phase = 'paused';
      s.pauseReason = fact.reason === 'focus' ? 'focus' : 'user';
      s.lastTickAt = null;
      s.hiddenSince = null;
      s.visibleSince = null;
      s.seatSince = null;
      s.retryAt = null;
      return { state: s, actions: [{ type: 'pauseCore' }, { type: 'releaseWakeLock' }, { type: 'persist' }] };
    }

    if (fact.type === 'resume') {
      if (s.phase !== 'paused') return { state: s, actions: [] };
      rollDay(s, at);
      // Do not resume straight into a boundary: the next tick would stop the session immediately and
      // the user would see a resume that did nothing. The cap and the window are checked up front.
      if (s.todayMs + todayFishingMs(s) >= s.dailyCapMs) return { state: s, actions: [{ type: 'refuse', reason: 'daily-cap' }] };
      if (s.window.on && !withinWindow(s.window, at)) return { state: s, actions: [{ type: 'refuse', reason: 'window' }] };
      var fromSeat = s.pauseReason === 'seat';
      s.phase = 'running';
      s.pauseReason = null;
      s.retryAt = null;
      s.hiddenSince = null;
      s.visibleSince = null;
      s.seatSince = null;
      // The seat fact comes from the core's own watchdog and can stay true while a line is already
      // out. Pausing again on the very next tick made Resume look broken; a short grace window lets
      // the user act (reel, or let the retry cast) before the seat hold is re-applied.
      s.seatOverrideUntil = fromSeat ? at + SEAT_OVERRIDE_MS : null;
      s.lastTickAt = at;
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
      var sinceCatch = at - (s.lastCatchAt == null ? s.startedAt : s.lastCatchAt);
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

  return { DEFAULTS: DEFAULTS, createState: createState, reduce: reduce, withinWindow: withinWindow, parseClock: parseClock };
});
