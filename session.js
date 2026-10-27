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
    window: { on: false, start: '21:00', stop: '23:00' }
  };

  function createState(overrides) {
    var s = {
      phase: 'idle',
      durationMs: DEFAULTS.durationMs,
      cooldownMs: DEFAULTS.cooldownMs,
      dailyCapMs: DEFAULTS.dailyCapMs,
      window: { on: DEFAULTS.window.on, start: DEFAULTS.window.start, stop: DEFAULTS.window.stop },
      fishingMs: 0,
      todayMs: 0,
      startedAt: null,
      lastTickAt: null,
      pauseReason: null,
      hiddenSince: null,
      visibleSince: null,
      retryAt: null,
      retries: 0,
      cooldownUntil: null,
      lastCatchAt: null,
      catchCount: 0,
      errWindowAt: null,
      errCount: 0,
      errTotal: 0,
      stopReason: null
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

  function stopSession(s, at, reason) {
    if (s.phase === 'running' && s.lastTickAt != null) s.fishingMs += Math.max(0, at - s.lastTickAt);
    s.phase = 'cooldown';
    s.cooldownUntil = at + s.cooldownMs;
    s.stopReason = reason || 'user';
    s.pauseReason = null;
    s.retryAt = null;
    s.lastTickAt = null;
    return [
      { type: 'stopCore' },
      { type: 'releaseWakeLock' },
      { type: 'sessionRow', reason: s.stopReason, minutes: Math.round(s.fishingMs / 60000), catches: s.catchCount },
      { type: 'persist' }
    ];
  }

  var NO_CATCH_MS = 10 * 60 * 1000;   // nothing bites for this long -> check the page
  var RETRY_DELAY_MS = 60 * 1000;
  var MAX_RETRIES = 3;
  var HIDDEN_PAUSE_MS = 5000;         // the game freezes while the tab is hidden
  var HIDDEN_STOP_MS = 120 * 1000;
  var RESUME_AFTER_MS = 3000;         // stay back this long before trusting the tab again
  var ERR_WINDOW_MS = 60 * 1000;
  var ERR_LIMIT = 20;

  function paused(s, at, reason) {
    s.phase = 'paused';
    s.pauseReason = reason;
    s.lastTickAt = null;
    s.visibleSince = null;
    if (reason === 'no-catch') s.retryAt = at + RETRY_DELAY_MS;
    var actions = [{ type: 'pauseCore' }];
    if (reason === 'hidden') actions.push({ type: 'releaseWakeLock' });
    actions.push({ type: 'persist' });
    return { state: s, actions: actions };
  }

  function runningAgain(s, at) {
    s.phase = 'running';
    s.pauseReason = null;
    s.retryAt = null;
    s.visibleSince = null;
    s.hiddenSince = null;
    s.lastTickAt = at;
    return { state: s, actions: [{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }] };
  }

  function tickPaused(s, at, fact) {
    if (typeof fact.todayMs === 'number') s.todayMs = fact.todayMs;
    var visible = fact.visible !== false;
    if (s.pauseReason === 'hidden') {
      if (!visible) {
        if (s.hiddenSince == null) s.hiddenSince = at;
        if (at - s.hiddenSince > HIDDEN_STOP_MS) return { state: s, actions: stopSession(s, at, 'hidden') };
        return { state: s, actions: [] };
      }
      if (s.visibleSince == null) { s.visibleSince = at; return { state: s, actions: [] }; }
      if (at - s.visibleSince >= RESUME_AFTER_MS) return runningAgain(s, at);
      return { state: s, actions: [] };
    }
    if (s.pauseReason === 'no-catch') {
      if (s.retryAt != null && at >= s.retryAt) {
        if (s.retries >= MAX_RETRIES) return { state: s, actions: stopSession(s, at, 'no-catch') };
        s.retries += 1;
        s.lastCatchAt = at;
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
      s.catchCount = 0;
      s.retries = 0;
      s.retryAt = null;
      s.errCount = 0;
      s.errWindowAt = null;
      s.errTotal = 0;
      s.pauseReason = null;
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

    if (fact.type === 'resume') {
      if (s.phase !== 'paused') return { state: s, actions: [] };
      s.phase = 'running';
      s.pauseReason = null;
      s.lastTickAt = at;
      return { state: s, actions: [{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }] };
    }

    if (fact.type === 'tick') {
      if (s.phase === 'cooldown') {
        if (s.cooldownUntil != null && at >= s.cooldownUntil) {
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

      // 1. the game only runs while the tab is visible: a hidden stretch is not fishing time
      if (!visible) {
        if (s.hiddenSince == null) s.hiddenSince = at;
        s.lastTickAt = at;
        if (at - s.hiddenSince > HIDDEN_STOP_MS) return { state: s, actions: stopSession(s, at, 'hidden') };
        if (at - s.hiddenSince > HIDDEN_PAUSE_MS) return paused(s, at, 'hidden');
        return { state: s, actions: [] };
      }
      s.hiddenSince = null;

      if (s.lastTickAt != null) s.fishingMs += Math.max(0, at - s.lastTickAt);
      s.lastTickAt = at;

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
      if (typeof fact.todayMs === 'number' && s.todayMs + s.fishingMs >= s.dailyCapMs) {
        return { state: s, actions: stopSession(s, at, 'daily-cap') };
      }

      // 6. duration
      if (s.fishingMs >= s.durationMs) {
        return { state: s, actions: stopSession(s, at, 'duration') };
      }

      // 7. nothing has bitten in a while
      var sinceCatch = at - (s.lastCatchAt == null ? s.startedAt : s.lastCatchAt);
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
