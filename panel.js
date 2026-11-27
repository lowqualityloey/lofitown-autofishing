// @ts-check
/* panel.js — the AutoFish control panel, injected into the lofi.town page.
 *
 * Loaded by the bookmarklet (or the userscript) from fishserve. It pulls autofish.js, session.js
 * and layout.js from the same server if they are not already on the page, then renders a
 * shadow-DOM HUD that owns the session: start/stop, length, clock window, guards, wake lock.
 *
 * Nothing here talks to the game except through window.__fish.
 */
(function () {
  'use strict';

  if (window.__panel && window.__panel.mounted) return;

  // The server that served this file is the server we talk to. Deriving it from our own
  // <script src> means the bookmarklet can point at any port (WSL forwards Windows localhost
  // into the distro, and 8731 may already be taken on the Windows side).
  // null when the panel was inlined in the userscript: there is no server to talk to, and the
  // session clock must not depend on one. Only the bookmarklet path (a real <script src>) has one.
  var BASE = (function () {
    var s = /** @type {HTMLScriptElement | null} */ (document.currentScript);
    if (s && s.src) { try { return new URL(s.src).origin; } catch (e) { /* fall through */ } }
    return null;
  })();
  var PREF_KEY = 'autofish.prefs';
  var POS_KEY = 'autofish.panel';
  var LIVE_KEY = 'autofish.live';
  var BUDGET_KEY = 'autofish:budget:v1';
  var BUDGET_PREFIX = BUDGET_KEY + ':';
  var UPDATE_CACHE_KEY = 'autofish:update:v1';
  var UPDATE_CHECK_URL = 'https://api.github.com/repos/lowqualityloey/lofitown-autofishing-dist/releases/latest';
  var UPDATE_DOWNLOAD_URL = 'https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/latest/download/autofish.user.js';
  var UPDATE_TTL_MS = 6 * 3600 * 1000;
  var RELOAD_GUARD_KEY = 'autofish:reload-guard:v1';
  var RESULT_MISSING_RELOAD_GRACE_MS = 15000;
  var TROPHY_DB = 'autofish:trophies:v1';
  var TROPHY_STORE = 'cards';
  var TROPHY_TTL_MS = 24 * 60 * 60 * 1000;
  var TROPHY_CAP = 30;
  var TICK_MS = 1000;

  /** @type {SessionState} */
  var state = /** @type {any} */ (null);
  var logScope = 'all';       // the rarity strip shows all-time or today
  var baseTodayMs = 0;        // fishing minutes already logged today before this session
  var budgetAt = 0;           // last periodic write of BUDGET_KEY
  var budgetDay = '';         // the local day BUDGET_KEY belongs to, for a rollover mid-run
  var banner = '';
  var bannerTone = '';        // '' | 'success'
  /** @type {number | null} */
  var bannerTimer = null;
  var clearConfirmUntil = 0;
  /** @type {number | null} */
  var clearConfirmTimer = null;
  var rareChimePref = false;
  /** @type {any} */
  var audioCtx = null;
  /** @type {{ tag: string, url: string, checkedAt: number } | null} */
  var updateInfo = null;
  var updateChecking = false;
  /** @type {number | null} */
  var resultMissingSince = null;
  var trophyCounts = { total: 0, Legendary: 0, Secret: 0, variant: 0 };
  var trophyPopOpen = false;
  var trophyFilter = 'all';
  /** @type {string[]} */
  var trophyUrls = [];
  /** @type {number | null} */
  var tickTimer = null;
  /** @type {number | null} */
  var placeTimer = null;
  var heartbeatAt = 0;
  var diagSent = false;       // one UI frame per session, when a run never sees a prompt
  var diagAt = 0;
  /** @type {number | null} */
  var guardTimer = null;      // its own timer: a throw inside tick() must not also disable the check
  var TICK_GUARD_MS = 5000;
  var lastTickAt = 0;         // when tick() was last entered
  /** @type {number | null} */
  var hiddenAt = null;        // wall clock when the tab went hidden; visibility events survive timer throttling
  var tickErrors = 0;
  var lastTickError = '';
  var zombieRevives = 0;
  /** @type {number[]} */
  var reviveTimes = [];       // rolling window for the crash-loop cap; an accepted Start clears it
  /** @type {WakeLockSentinel | null} */
  var wakeSentinel = null;
  /** @type {Point | null} */
  var dragged = null;         // {x, y} once the user moved the panel
  /** @type {any} */
  var dragging = null;
  var placed = false;         // keep a clear position instead of snapping back when a card clears
  var collapsed = false;
  // The owner opened it. The game's zones can leave the layout no room, and that used to collapse
  // the panel again inside the same place() call - a pill that looks clickable and does nothing.
  // An overlapping panel the owner asked for beats a panel that refuses to open.
  var userExpanded = false;
  /** @type {HTMLDivElement | null} */
  var host = null;
  /** @type {ShadowRoot | null} */
  var root = null;
  /** @type {Record<string, any>} */
  var ui = {};

  /* ------------------------------------------------------------- deps ----- */

  /** @param {string} src @returns {Promise<void>} */
  function loadScriptFrom(src) {
    return new Promise(/** @param {(v?: void) => void} res */ function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('cannot load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /** One of our own files, from the server that served this panel. */
  function loadScript(name, url) {
    return loadScriptFrom(BASE + url + '?t=' + Date.now());
  }

  async function deps() {
    if (window.__fish && window.AutoFishSession && window.AutoFishLayout) return;
    if (!BASE) throw new Error('this panel has no server to load its dependencies from');
    if (!window.__fish) await loadScript('autofish', '/autofish.js');
    if (!window.AutoFishSession) await loadScript('session', '/session.js');
    if (!window.AutoFishLayout) await loadScript('layout', '/layout.js');
  }

  /* ------------------------------------------------------------ prefs ----- */

  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function loadPrefs() {
    var p = readJSON(PREF_KEY, {});
    var prefs = {};
    prefs.mode = p.mode === 'flow' ? 'flow' : 'timed';
    ['durationMs', 'cooldownMs', 'dailyCapMs'].forEach(function (k) {
      if (typeof p[k] === 'number') prefs[k] = p[k];
    });
    if (p.window && p.window.start && p.window.stop) {
      prefs.window = { on: !!p.window.on, start: p.window.start, stop: p.window.stop };
    }
    prefs.resumeAfterReload = !!p.resumeAfterReload;
    var capOn = p.localCapture !== undefined ? !!p.localCapture : !!(p.postCatches || p.overnight);
    prefs.localCapture = capOn;
    prefs.postCatches = capOn;
    prefs.overnight = capOn;
    prefs.hideUpsell = !!p.hideUpsell;
    prefs.focusMode = !!p.focusMode;
    prefs.rareChime = !!p.rareChime;
    if (typeof p.overnightBase === 'string') prefs.overnightBase = p.overnightBase;
    if (typeof p.hiddenStopMs === 'number') prefs.hiddenStopMs = p.hiddenStopMs;
    prefs.chain = !!p.chain;
    if (p.profile) prefs.profile = String(p.profile);
    return prefs;
  }

  function savePrefs() {
    if (!window.__panel) window.__panel = {};
    var capOn = !!overnightPref;
    writeJSON(PREF_KEY, {
      mode: state.mode === 'flow' ? 'flow' : 'timed',
      durationMs: state.durationMs,
      cooldownMs: state.cooldownMs,
      dailyCapMs: state.dailyCapMs,
      hiddenStopMs: state.hiddenStopMs,
      chain: !!state.chain,
      window: state.window,
      resumeAfterReload: !!window.__panel.resumeAfterReload,
      localCapture: capOn,
      postCatches: capOn,
      overnight: capOn,
      hideUpsell: !!window.__panel.hideUpsell,
      focusMode: !!focusPref,
      rareChime: !!rareChimePref,
      overnightBase: captureBase || '',
      profile: (window.__fish && window.__fish.logProfile) ? window.__fish.logProfile() : 'default'
    });
  }

  /* ------------------------------------------------------------ budget ---- */
  /*
   * Today's fishing time and the cooldown are local facts, not server facts. They used to live
   * only in memory (cooldown) or only in fishserve's sessions.csv (today's minutes), so a reload
   * reset the cap to zero and skipped the cooldown entirely. The server is still written to, but
   * it is a mirror: the browser now knows the budget with or without it.
   */
  /** The budget follows the profile: two accounts in one browser must not share a daily cap. */
  function profileName() {
    try {
      var f = fish();
      return (f && f.logProfile) ? f.logProfile() : 'default';
    } catch (e) { return 'default'; }
  }
  function budgetKey() {
    var p = profileName();
    return p === 'default' ? BUDGET_KEY : BUDGET_PREFIX + p;
  }

  function loadBudget() {
    var b = readJSON(budgetKey(), null) || {};
    var today = dayKey();
    var ms = typeof b.ms === 'number' && isFinite(b.ms) ? b.ms : 0;
    if (b.day && b.day !== today) ms = 0;              // a new day starts at zero
    var cd = typeof b.cooldownUntil === 'number' && b.cooldownUntil > Date.now() ? b.cooldownUntil : null;
    return { day: today, ms: ms, cooldownUntil: cd };
  }

  /** The part of the live session that belongs to the current local day. A run that started before
   * midnight carries the rest; only today's share may spend today's cap or be stored under today. */
  function todaySessionMs() {
    return Math.max(0, (state.fishingMs || 0) - (state.carriedMs || 0));
  }

  function syncBudget() {
    if (!state) return;
    baseTodayMs = state.todayMs || 0;
    writeJSON(budgetKey(), {
      day: dayKey(),
      ms: Math.round((state.todayMs || 0) + todaySessionMs()),
      cooldownUntil: state.phase === 'cooldown' && state.cooldownUntil ? state.cooldownUntil : null
    });
  }

  /* ------------------------------------------------ cozier upsell hider --- */
  /*
   * A free account that joins a focus session gets a full-screen "Fish while you focus with
   * Cozier" modal. It cannot be dismissed — closing it re-mounts it within a second — and its
   * scrim covers the game canvas, so it also swallows every click meant for the water.
   *
   * Hiding it is COSMETIC ONLY. The game itself refuses the cast for a free account in a focus
   * session: measured 2026-10-28, 25+ minutes in-session with the modal hidden, real pointer
   * clicks and Space presses gave 0 dials, while the same bot fished normally outside a session.
   * What this buys is a clear view and working clicks while the session runs; it does not and
   * cannot restore focus fishing.
   *
   * The overlay root is React's own node and may be reused for other modals, so it is tagged only
   * while the upsell's description paragraph is actually on screen, and the tag is dropped again
   * as soon as it is gone. Off by default (pref `hideUpsell`).
   */
  var UPSELL_ID = 'focus-fishing-upgrade-description';
  var UPSELL_ATTR = 'data-autofish-upsell';
  var upsellOn = false;
  /** @type {number | null} */
  var upsellTimer = null;

  function upsellRoot() {
    var desc = document.getElementById(UPSELL_ID);
    if (!desc) return null;
    // display:none from our own tag would empty getClientRects() and make the sweep untag the root
    // it just tagged, i.e. show the modal again every 500 ms. A root we are hiding still counts.
    if (!desc.closest('[' + UPSELL_ATTR + ']') && !desc.getClientRects().length) return null;
    /** @type {HTMLElement | null} */
    var node = desc;
    /** @type {HTMLElement | null} */
    var top = null;
    while (node && node !== document.documentElement) {
      var style = getComputedStyle(node);
      if (style.position === 'fixed' && String(node.className || '').indexOf('inset-0') !== -1) top = node;
      node = node.parentElement;
    }
    return top;
  }

  function sweepUpsell() {
    var target = upsellRoot();
    var marked = document.querySelectorAll('[' + UPSELL_ATTR + ']');
    for (var i = 0; i < marked.length; i++) {
      if (marked[i] !== target) marked[i].removeAttribute(UPSELL_ATTR);
    }
    if (target && !target.hasAttribute(UPSELL_ATTR)) target.setAttribute(UPSELL_ATTR, '');
  }

  function renderUpsellToggle() {
    if (!ui.upsellToggle) return;
    ui.upsellToggle.textContent = upsellOn ? 'on' : 'off';
    ui.upsellToggle.style.color = upsellOn ? '#5ad18b' : '#9aa4ae';
  }

  function setUpsellHidden(on) {
    upsellOn = !!on;
    if (window.__panel) window.__panel.hideUpsell = upsellOn;
    var css = document.getElementById('autofish-upsell-css');
    var marked = document.querySelectorAll('[' + UPSELL_ATTR + ']');
    if (upsellOn) {
      if (!css) {
        css = document.createElement('style');
        css.id = 'autofish-upsell-css';
        css.textContent = '[' + UPSELL_ATTR + ']{display:none!important}';
        document.head.appendChild(css);
      }
      sweepUpsell();
      if (!upsellTimer) upsellTimer = setInterval(sweepUpsell, 500);
    } else {
      if (upsellTimer) { clearInterval(upsellTimer); upsellTimer = null; }
      for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(UPSELL_ATTR);
      if (css) css.remove();
    }
    renderUpsellToggle();
  }

  /* ---------------------------------------------- focus-session notice ---- */
  /*
   * The game publishes the session clock in the page title ("12:34 FOCUS | lofi.town") and drops it
   * when the session ends, so the title is the only signal a page script can see. It matters because
   * focus fishing is a Cozier perk: a free account can join a session and press Start, and the run
   * will look perfectly alive (presses climb, dials do not) while the game refuses every cast. Both
   * the bot and six hand inputs produced 0 dials in 25+ minutes on 2026-10-28.
   *
   * So the panel says it out loud instead of leaving the user to wonder. It does not refuse to
   * start: a Cozier subscriber can fish in a session, and the panel cannot read the account type.
   * The run watchdog already pauses after a run of no catches (pauseReason 'no-catch'), which keeps
   * a gated session from burning the whole budget.
   */
  var FOCUS_NOTE = 'focus session active — focus fishing needs Cozier, casts are refused; "Pause in focus sessions" (Session & guards) pauses the run';

  function inFocusSession() {
    try { return /\bFOCUS\b/.test(document.title); } catch (e) { return false; }
  }

  /* ---------------------------------------------- focus mode (3.9.34) ---- */
  /*
   * The ask: stop fishing, run a focus session (solo or together), and do not see the REEL!/CAST!
   * bubble until the session ends. Two halves.
   *
   * The pause is exact: a 'focus' pause reason holds the clock and the core, is not retryable, and
   * only the toggle or the session ending lifts it (session.js).
   *
   * The bubble is painted into the game's canvas, so the only way to hide it is to erase its pixels
   * after the game draws them. 3.9.41 tries exactly that: while the hold is engaged the core clears
   * the prompt's rect in its post-render hook (gl scissor + clear), on the prompt's own canvas only.
   * Nothing is drawn over the game. Where the game merges the prompt into the world canvas the core
   * refuses - a clear there would leave a hole in the scenery - and the prompt stays visible, which
   * is the fallback. The hold itself is unchanged by any of this: it pauses, and the mask is only a
   * visual extra that can be dropped without touching the pause.
   */
  var focusOn = false;       // the hold is engaged right now
  var focusPref = false;     // the user's setting: pause in focus sessions. A session ending releases
                             // the hold; it must never change this, or the next session never engages.
  var focusSawSession = false;

  function renderFocusToggle() {
    if (!ui.focusToggle) return;
    ui.focusToggle.textContent = focusOn ? 'on' : 'off';
    ui.focusToggle.style.color = focusOn ? '#5ad18b' : '#9aa4ae';
  }

  /**
   * Engage or release focus mode. opts.session records that the game's own session drove it, which
   * is what lets its end release the hold; a manual toggle stays until the user turns it off.
   */
  function setFocusMode(on, opts) {
    var o = opts || {};
    on = !!on;
    if (on === focusOn) return;
    focusOn = on;
    if (window.__panel) window.__panel.focusMode = on;
    if (on) {
      focusSawSession = !!o.session;
      if (state.phase === 'running') dispatch({ type: 'pause', at: Date.now(), reason: 'focus' });
      applyPromptMask();
    } else {
      focusSawSession = false;
      clearPromptMask();
      if (state.pauseReason === 'focus') dispatch({ type: 'resume', at: Date.now() });
    }
    renderFocusToggle();
    render();
  }

  /**
   * Called every tick: with the pref on, a session starting engages the hold; a session-driven hold
   * releases when it ends. A manual toggle is left alone in both directions.
   */
  function focusTick() {
    var session = inFocusSession();
    if (focusOn && session) focusSawSession = true;
    if (focusOn && focusSawSession && !session) setFocusMode(false);
    else if (!focusOn && session && focusPref) setFocusMode(true, { session: true });
    // The prompt can appear somewhere else between sessions, so the rect is refreshed every tick
    // while the hold is engaged. No rect (the detector has not seen one) means no mask at all.
    if (focusOn) applyPromptMask();
  }

  /**
   * Ask the core to erase the CAST!/REEL! bubble while the hold is engaged. The rect is the one the
   * detector already reports; the core refuses when the prompt shares the world canvas, because a
   * clear there would punch a hole in the scenery rather than reveal it.
   */
  function applyPromptMask() {
    // The core finds every element on the UI layer itself - the prompt bubble and the lure button -
    // so the panel only says "hide it while the hold is engaged", never where it is.
    try { if (window.__fish && window.__fish.setPromptMask) window.__fish.setPromptMask({ resolve: true }); } catch (e) {}
  }

  function clearPromptMask() {
    try { if (window.__fish && window.__fish.setPromptMask) window.__fish.setPromptMask(null); } catch (e) {}
  }

  /* ------------------------------------------------- overnight capture ---- */
  /*
   * The night that died: the sampler was pasted into the console, the page reloaded, and the paste
   * went with it - data/runs jumps from 07:18Z to 15:01Z (2026-11-17), and the page's 250-row store
   * only reached back to 12:12Z, so 7 h 43 m of a 634-attempt run was never written down.
   *
   * So the setting lives here. mount() loads the sampler again whenever the page comes back, and a
   * line under the meters says whether it is armed, how many posts it has made and when it last
   * wrote one: an armed capture whose POSTs fail looks exactly like a quiet night otherwise.
   *
   * The sampler reads the page's __fish.exportRun() and posts back to the origin that served it, so
   * it has to come from that same fishserve. The bookmarklet path already knows the origin (BASE).
   * The inlined userscript has no server of its own, so it is told once and the address is kept
   * with the pref - a reload or a browser restart arms again without asking. The amber status line
   * asks for the address again, for a fishserve that moved.
   */
  var overnightPref = false;
  var captureBase = '';
  var captureState = 'off';     // off | arming | armed | error
  var captureError = '';
  var captureEditReady = false; // the amber line accepts a corrected address
  var captureDashReady = false; // the green armed line opens fishserve /dashboard
  var captureArming = false;    // one load in flight; a tick can ask again while it runs
  var captureRetryAt = 0;       // when the next self-heal attempt is due
  var captureRetries = 0;       // attempts since it was last healthy
  var CAPTURE_BACKOFF = [30000, 60000, 120000, 300000];
  // The sampler posts every five minutes, so two misses mean it is not writing. One constant
  // because the status line and the heal must agree on what "stale" means.
  var CAPTURE_STALE_MS = 11 * 60 * 1000;

  function captureStatus() {
    try { return window.__overnight ? window.__overnight.status() : null; } catch (e) { return null; }
  }

  /** The fishserve origin the sampler comes from, or '' when nothing has ever told this page. */
  function captureServer() {
    var base = String(captureBase || BASE || '').replace(/\/+$/, '');
    return /^https?:\/\/[^/]+:\d+$/.test(base) ? base : '';
  }

  function captureClearBackoff() {
    captureRetryAt = 0;
    captureRetries = 0;
  }

  function captureStale(st) {
    return !!(st && st.last && Date.now() - Date.parse(st.last.at) > CAPTURE_STALE_MS);
  }

  function syncCaptureUrl() {
    if (!window.__panel) window.__panel = {};
    var on = !!overnightPref;
    window.__panel.localCapture = on;
    window.__panel.overnight = on;
    window.__panel.postCatches = on;
    var server = BASE || captureServer();
    var post = (on && server) ? server + '/catch' : null;
    try { if (window.__fish && window.__fish.tune) window.__fish.tune({ logUrl: post }); } catch (e) {}
  }

  async function armOvernight() {
    if (captureArming) return false;     // the heal timer can come due while a load is in flight
    var server = captureServer();
    if (!server) {
      captureState = 'error';
      captureError = 'no address — click Local capture';
      renderCapture();
      return false;
    }
    var live = captureStatus();
    // A remount in the same page (the SPA can drop and rebuild the panel) must not stack a second
    // timer on the same run, and neither must a heal.
    if (live && !live.stopped) {
      captureState = 'armed';
      captureError = '';
      captureClearBackoff();
      renderCapture();
      return true;
    }
    captureArming = true;
    captureState = 'arming';
    captureError = '';
    renderCapture();
    try {
      // The sampler posts back to the origin that served it, not to a guessed port, so a fishserve
      // on another host or port is written where it was loaded from.
      window.__overnightBase = server;
      try {
        await loadScriptFrom(server + '/overnight.js?t=' + Date.now());
      } catch (e) {
        captureState = 'error';
        captureError = 'no answer (start "node fishserve.js" or click to edit address)';
        return false;
      }
      if (!captureStatus()) {
        // The sampler throws before it installs itself when __fish.exportRun is missing on the page.
        captureState = 'error';
        captureError = 'the sampler did not start — is the bot loaded on this page?';
        return false;
      }
      captureState = 'armed';
      captureClearBackoff();
      return true;
    } finally {
      captureArming = false;
      renderCapture();   // repaint with the flag down; the tick retries if this failed
    }
  }

  function disarmOvernight() {
    try { if (window.__overnight) window.__overnight.stop(); } catch (e) {}
    window.__overnight = null;
    captureState = 'off';
    captureError = '';
    captureClearBackoff();
    renderCapture();
  }

  /**
   * Ask once for the fishserve origin. The answer is kept with the pref, so a reload does not ask
   * again. A cancelled answer returns '' and changes nothing; a malformed one also says why.
   */
  function askCaptureAddress() {
    var msg = 'Optional — only needed if you run "node fishserve.js" on your PC for catches.csv and 5-minute run snapshots.\n' +
      'Click Cancel to fish normally (Catch history already saves in your browser).\n\n' +
      'Enter fishserve URL (default http://127.0.0.1:8731):';
    var typed = window.prompt(msg, captureBase || '');
    var base = String(typed == null ? '' : typed).trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+:\d+$/.test(base)) {
      banner = base ? 'capture needs an address like http://127.0.0.1:PORT' : '';
      return '';
    }
    captureBase = base;
    banner = '';
    return base;
  }

  /**
   * Correct a stale address from the amber line. The old sampler is stopped first, or it would keep
   * posting to the origin that no longer answers; the pref stays on and the capture arms again from
   * the corrected origin. Cancelling changes nothing, so the toggle can still turn it off.
   */
  function editCaptureAddress() {
    if (BASE) return;                      // a served panel has only the origin that served it
    if (!askCaptureAddress()) return;
    try { if (window.__overnight) window.__overnight.stop(); } catch (e) {}
    window.__overnight = null;
    captureState = 'off';
    captureError = '';
    captureClearBackoff();
    syncCaptureUrl();
    savePrefs();
    armOvernight();
    render();
  }

  /**
   * The pref says on, so the sampler should be posting. When it is not - the script never came back
   * after a reload, fishserve was down when it did, or the last POST failed - fix it here instead of
   * waiting for someone to read a line under the meters at 3 a.m. A missing address is the one
   * exception: only the toggle can supply one, and a prompt nobody is looking at helps no one.
   *
   * A dead sampler is loaded again; a live one that cannot write is nudged with __overnight.now()
   * rather than stacked. Both wait on a backoff stamped before each attempt, so fishserve is asked
   * at most once per step (30 s at first, then 5 m) even while it is down. Called from tick(), not
   * render(): painting the panel must not start network work.
   */
  function healCapture() {
    if (!overnightPref || captureArming) return;
    if (!captureServer()) return;   // only the toggle can supply an address
    var st = captureStatus();
    var why = '';
    if (captureState === 'error') why = 'arm';
    else if (!st || st.stopped) why = 'dead';
    else if (st.lastError) why = 'post';
    else if (captureStale(st)) why = 'stale';
    if (!why) { captureClearBackoff(); return; }
    var now = Date.now();
    if (!captureRetryAt) { captureRetryAt = now + CAPTURE_BACKOFF[0]; return; }
    if (now < captureRetryAt) return;
    captureRetryAt = now + CAPTURE_BACKOFF[Math.min(captureRetries++, CAPTURE_BACKOFF.length - 1)];
    if (why === 'post' || why === 'stale') {
      // Its timer is still running, so forcing one snapshot retries the POST without loading a
      // second sampler over the first.
      try { if (window.__overnight) window.__overnight.now(); } catch (e) {}
      return;
    }
    armOvernight();
  }

  /** Eleven minutes is two missed five-minute posts: armed-but-dead, said out loud. */
  function renderCapture() {
    if (ui.captureToggle) {
      ui.captureToggle.textContent = overnightPref ? 'on' : 'off';
      ui.captureToggle.style.color = overnightPref ? '#5ad18b' : '#9aa4ae';
    }
    var st = captureStatus();
    var line = '';
    var tone = '';
    var armed = false;
    if (!overnightPref) {
      line = '';
    } else if (captureState === 'arming') {
      line = 'capture: loading the sampler from ' + (captureServer() || '?') + '…';
    } else if (captureState === 'error') {
      line = 'capture: ' + captureError;
      tone = 'warn';
    } else if (!st || st.stopped) {
      line = 'capture: the sampler is not running · re-arming';
      tone = 'warn';
    } else if (st.lastError) {
      line = 'capture armed · ' + st.posts + ' posted · last post failed: ' + st.lastError;
      tone = 'warn';
      armed = true;
    } else if (!st.last) {
      line = 'capture armed · first post in flight';
      tone = 'on';
      armed = true;
    } else {
      line = 'capture armed · ' + st.posts + (st.posts === 1 ? ' post' : ' posts') + ' · last ' +
        new Date(st.last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (captureStale(st)) { line += ' · stale (fishserve gone?)'; tone = 'warn'; }
      else tone = 'on';
      armed = true;
    }
    captureEditReady = !!(overnightPref && !BASE && tone === 'warn');
    captureDashReady = !!(overnightPref && armed && !captureEditReady && captureServer());
    if (captureDashReady) line += ' · ↗ dashboard';
    if (ui.captureLine) {
      ui.captureLine.textContent = line;
      ui.captureLine.className = 'capture' + (line ? '' : ' hide') + (tone ? ' ' + tone : '');
      ui.captureLine.title = overnightPref
        ? 'posts __fish.exportRun() to ' + (captureServer() || 'fishserve') + ' every five minutes; data/runs keeps one file per post' +
          (captureRetryAt ? '; retrying on a backoff (30 s to 5 m)' : '') +
          (captureEditReady ? '; click to change the fishserve address' : '') +
          (captureDashReady ? '; click to open overnight dashboard' : '')
        : 'sample this run every five minutes, and load the sampler again after a reload';
      ui.captureLine.style.cursor = (captureEditReady || captureDashReady) ? 'pointer' : '';
      if (captureEditReady || captureDashReady) {
        ui.captureLine.setAttribute('role', 'button');
        ui.captureLine.tabIndex = 0;
      } else {
        ui.captureLine.removeAttribute('role');
        ui.captureLine.tabIndex = -1;
      }
    }
    if (host) {
      if (!overnightPref) delete host.dataset.capture;
      else host.dataset.capture = armed ? (tone === 'warn' ? 'stale' : 'armed') : 'error';
    }
  }

  /* ------------------------------------------------------------ server ---- */

  function dayKey(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    d = d || new Date();
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  async function loadToday() {
    // The local budget already answered; the server is only a mirror and may not exist at all.
    // An inlined userscript has no BASE of its own, so the address the owner gave "Overnight
    // capture" is the one server this page knows - the same fallback postSessionRow uses. Without
    // it the page wrote its session rows and never read them back, so a lost budget reset the day.
    // Rows carry a profile, so ask for this profile's day instead of summing every account.
    var local = baseTodayMs || 0;
    var origin = BASE || captureServer();
    if (!origin) return;
    try {
      var r = await fetch(origin + '/sessions?day=' + dayKey() + '&profile=' + encodeURIComponent(profileName()), { cache: 'no-store' });
      var j = await r.json();
      var server = (j.minutes || 0) * 60000;
      // Whichever knows about more fishing today wins; a failed fetch keeps the local budget.
      baseTodayMs = Math.max(local, server);
    } catch (e) { baseTodayMs = local; }
  }

  function postSessionRow(reason, minutes, catches, startedAt, note) {
    // fishserve is also where the overnight sampler posts. An inlined panel has no BASE of its own,
    // so the address the owner gave the capture is the one server this page knows; without it there
    // is nowhere to log and the local budget has to answer alone.
    var server = BASE || captureServer();
    if (!server) return;
    // Every profile logs its own row: sessions.csv ends with a profile column, so the morning
    // report can bound a named profile's night and loadToday() reads back only this profile.
    try {
      // The caller owns the start time: a reload row has no state.startedAt yet (mount has not run
      // a session), so the old || Date.now() fallback made every interrupted row claim to begin at
      // page load. Measured live 2026-11-21: started_at 05:08:07.212Z, logged 05:08:07.856Z.
      var started = new Date(startedAt || state.startedAt || Date.now()).toISOString();
      fetch(server + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ started_at: started, minutes: minutes, catches: catches, reason: reason, profile: profileName(), note: note || '' })
      }).then(function (r) { if (!r.ok) banner = 'session log rejected the row'; }).catch(function () { banner = 'session log offline — the session still works'; });
    } catch (e) { banner = 'session log offline — the session still works'; }
  }

  /**
   * Send one PNG of the game's UI layer to the local server. A run that pastes in the game but never
   * reacts is almost always looking at the wrong pixels; with the frame on disk the detector can be
   * corrected from what the game actually drew instead of from guesses.
   */
  function captureDiag(note) {
    if (!BASE) return;                       // no server: nothing to upload to, and no alarm to raise
    try {
      var f = fish();
      if (!f || !f.captureUI) { banner = 'this core cannot grab a frame'; return; }
      f.captureUI();
      setTimeout(function () {
        var shot = f._shot;
        if (typeof shot !== 'string' || shot.indexOf('data:image') !== 0) { banner = 'could not grab a frame to send'; return; }
        fetch(BASE + '/diag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: note, png: shot, stats: f.stats, viewport: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio })
        }).then(function (r) { banner = r.ok ? 'sent a game frame to ' + BASE + ' for diagnosis' : 'diagnosis upload was rejected'; })
          .catch(function () { banner = 'diagnosis upload failed (fishserve offline?)'; });
      }, 400);
    } catch (e) { banner = 'diagnosis failed: ' + ((e && e.message) || e); }
  }

  /* ---------------------------------------------------------- actions ----- */

  /** @returns {FishApi} */
  function fish() { return /** @type {FishApi} */ (/** @type {unknown} */ (window.__fish)); }

  /** The core latch, including the short window before the session reducer has seen it. */
  function resultMissingNow() {
    if (state && state.pauseReason === 'result-missing') return true;
    try {
      var s = fish() && fish().status ? fish().status() : null;
      return !!(s && s.resultMissing);
    } catch (e) { return false; }
  }

  /** Which build this tab is running. The bundle stamps __fish.version from package.json. */
  function versionLabel() {
    var api = fish();
    var v = api && api.version;
    if (!v) return '';
    return v === 'dev' ? 'dev' : 'v' + v;
  }

  /* --------------------------------------------------- update check badge ---- */

  function parseSemver(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  function isNewerVer(remoteTag, localTag) {
    if (!remoteTag || !localTag || localTag === 'dev') return false;
    var r = parseSemver(remoteTag);
    var l = parseSemver(localTag);
    if (!r || !l) return false;
    for (var i = 0; i < 3; i++) {
      if (r[i] > l[i]) return true;
      if (r[i] < l[i]) return false;
    }
    return false;
  }

  function renderVerBadge() {
    if (!ui.ver) return;
    var api = fish();
    var local = (api && api.version) || '';
    var hasUpdate = !BASE && updateInfo && isNewerVer(updateInfo.tag, local);
    if (hasUpdate && updateInfo) {
      ui.ver.textContent = versionLabel() + ' → ' + updateInfo.tag;
      ui.ver.className = 'ver update';
      ui.ver.title = 'update available (' + updateInfo.tag + ') — click to install in Tampermonkey';
      ui.ver.setAttribute('role', 'button');
      ui.ver.tabIndex = 0;
    } else {
      ui.ver.textContent = versionLabel();
      ui.ver.className = 'ver';
      ui.ver.title = 'build ' + (local || 'unknown');
      ui.ver.removeAttribute('role');
      ui.ver.tabIndex = -1;
    }
  }

  async function checkForUpdate(force) {
    if (BASE || updateChecking || typeof fetch !== 'function') return;
    var cached = readJSON(UPDATE_CACHE_KEY, null);
    if (!force && cached && cached.tag && cached.checkedAt && Date.now() - cached.checkedAt < UPDATE_TTL_MS) {
      updateInfo = cached;
      renderVerBadge();
      return;
    }
    updateChecking = true;
    try {
      var res = await fetch(UPDATE_CHECK_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res || !res.ok) return;
      var data = await res.json();
      if (!data || !data.tag_name) return;
      var downloadUrl = UPDATE_DOWNLOAD_URL;
      if (Array.isArray(data.assets)) {
        for (var i = 0; i < data.assets.length; i++) {
          var a = data.assets[i];
          if (a && a.name === 'autofish.user.js' && a.browser_download_url) {
            downloadUrl = a.browser_download_url;
            break;
          }
        }
      }
      updateInfo = { tag: String(data.tag_name), url: downloadUrl, checkedAt: Date.now() };
      writeJSON(UPDATE_CACHE_KEY, updateInfo);
      renderVerBadge();
    } catch (e) { /* network/CSP failures stay quiet */ } finally {
      updateChecking = false;
    }
  }

  /* ---------------------------------------------- Web Audio rare catch chime ---- */

  function isTrophyCatchRow(row) {
    if (!row) return false;
    return row.rarity === 'Legendary' || row.rarity === 'Secret' || !!row.shiny || !!row.golden;
  }

  function unlockAudio() {
    try {
      var Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
      return audioCtx;
    } catch (e) { return null; }
  }

  function playRareChime(row) {
    if (!rareChimePref) return;
    var ctx = unlockAudio();
    if (!ctx) return;
    try {
      var notes = (row && row.rarity === 'Secret') ? [1046.5, 1318.5, 1567.98]
        : (row && row.rarity === 'Legendary') ? [880, 1108.73, 1318.51]
          : [783.99, 987.77];
      var t = ctx.currentTime;
      notes.forEach(function (freq, idx) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + idx * 0.08);
        gain.gain.setValueAtTime(0.0001, t + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.08, t + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.08 + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + idx * 0.08);
        osc.stop(t + idx * 0.08 + 0.4);
      });
    } catch (e) {}
  }

  /* --------------------------------------------------- ledger CSV download ---- */

  function showTempBanner(msg, tone, ttlMs) {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    banner = msg || '';
    bannerTone = tone || '';
    render();
    if (ttlMs && ttlMs > 0) {
      bannerTimer = setTimeout(function () {
        bannerTimer = null;
        if (banner === msg) {
          banner = '';
          bannerTone = '';
          render();
        }
      }, ttlMs);
    }
  }

  function downloadLedgerCsv() {
    var f = fish();
    var csv = (f && f.logCsv) ? f.logCsv() : '';
    if (!csv || csv.indexOf('\n') < 0) {
      showTempBanner('no catch history to export yet', '', 4000);
      return;
    }
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'autofish-' + profileName() + '-' + dayKey() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
      showTempBanner('downloaded ' + a.download, 'success', 4000);
    } catch (e) {
      showTempBanner('CSV download unavailable in this browser', '', 4000);
    }
  }

  /* ----------------------------------------------- IndexedDB trophy viewer ---- */

  /** @returns {Promise<IDBDatabase>} */
  function openTrophyDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      try {
        var req = indexedDB.open(TROPHY_DB, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(TROPHY_STORE)) {
            var store = db.createObjectStore(TROPHY_STORE, { keyPath: 'id' });
            store.createIndex('at', 'at', { unique: false });
            store.createIndex('profile', 'profile', { unique: false });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('idb open error')); };
      } catch (e) { reject(e); }
    });
  }

  /**
   * Run one IndexedDB readwrite operation against the trophy store and always close the DB handle.
   * @template T
   * @param {(store: IDBObjectStore, tx: IDBTransaction) => Promise<T>} work
   * @param {T} fallback
   * @returns {Promise<T>}
   */
  async function withTrophyStore(work, fallback) {
    /** @type {IDBDatabase | null} */
    var db = null;
    try {
      db = await openTrophyDb();
      var tx = db.transaction(TROPHY_STORE, 'readwrite');
      return await work(tx.objectStore(TROPHY_STORE), tx);
    } catch (e) {
      return fallback;
    } finally {
      if (db) try { db.close(); } catch (e) {}
    }
  }

  function idbGetAll(store) {
    return new Promise(function (res) {
      var r = store.getAll();
      r.onsuccess = function () { res(Array.isArray(r.result) ? r.result : []); };
      r.onerror = function () { res([]); };
    });
  }

  function pruneTrophiesInStore(store, prof, now) {
    return idbGetAll(store).then(function (all) {
      var cutoff = now - TROPHY_TTL_MS;
      /** @type {any[]} */
      var keptForProf = [];
      all.forEach(function (rec) {
        if (!rec || typeof rec.at !== 'number' || rec.at < cutoff) {
          try { store.delete(rec.id); } catch (e) {}
        } else if ((rec.profile || 'default') === prof) {
          keptForProf.push(rec);
        }
      });
      keptForProf.sort(function (a, b) { return a.at - b.at; });
      while (keptForProf.length > TROPHY_CAP) {
        var oldest = keptForProf.shift();
        try { store.delete(oldest.id); } catch (e) {}
      }
    });
  }

  async function saveTrophyCard(row, blob) {
    if (!row || !isTrophyCatchRow(row)) return;
    await withTrophyStore(async function (store, tx) {
      var at = typeof row.t === 'number' ? row.t : Date.now();
      var prof = String(row.profile || profileName() || 'default');
      store.put({
        id: at + ':' + Math.random().toString(36).slice(2, 7),
        at: at,
        profile: prof,
        species: String(row.species || 'Unknown'),
        rarity: String(row.rarity || ''),
        weight: String(row.weight || ''),
        value: String(row.value || ''),
        shiny: !!row.shiny,
        golden: !!row.golden,
        blob: blob || null,
      });
      await pruneTrophiesInStore(store, prof, Date.now());
      await new Promise(function (res) { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
    }, undefined);
    await refreshTrophyCounts();
    if (trophyPopOpen) renderTrophyPop();
  }

  async function listTrophyCards(prof) {
    var target = String(prof || profileName() || 'default');
    return withTrophyStore(async function (store) {
      await pruneTrophiesInStore(store, target, Date.now());
      var rows = await idbGetAll(store);
      return rows
        .filter(function (r) { return (r.profile || 'default') === target; })
        .sort(function (a, b) { return b.at - a.at; });
    }, []);
  }

  async function clearTrophyCards(prof) {
    var target = String(prof || profileName() || 'default');
    await withTrophyStore(async function (store, tx) {
      var rows = await idbGetAll(store);
      rows.forEach(function (rec) {
        if ((rec.profile || 'default') === target) {
          try { store.delete(rec.id); } catch (e) {}
        }
      });
      await new Promise(function (res) { tx.oncomplete = res; tx.onerror = res; });
    }, undefined);
    await refreshTrophyCounts();
    if (trophyPopOpen) renderTrophyPop();
  }

  async function refreshTrophyCounts() {
    var rows = await listTrophyCards(profileName());
    var next = { total: rows.length, Legendary: 0, Secret: 0, variant: 0 };
    rows.forEach(function (r) {
      if (r.rarity === 'Legendary') next.Legendary++;
      if (r.rarity === 'Secret') next.Secret++;
      if (r.shiny || r.golden) next.variant++;
    });
    trophyCounts = next;
    renderLog();
  }

  function revokeTrophyUrls() {
    while (trophyUrls.length) {
      var u = trophyUrls.pop();
      try { if (u) URL.revokeObjectURL(u); } catch (e) {}
    }
  }

  function resetClearConfirm() {
    clearConfirmUntil = 0;
    if (clearConfirmTimer) { clearTimeout(clearConfirmTimer); clearConfirmTimer = null; }
    if (ui.trophyClear) {
      ui.trophyClear.textContent = 'clear';
      ui.trophyClear.classList.remove('armed');
    }
  }

  function closeTrophyPop() {
    trophyPopOpen = false;
    resetClearConfirm();
    revokeTrophyUrls();
    if (ui.trophyPop) ui.trophyPop.classList.add('hide');
    if (ui.trophyList) ui.trophyList.textContent = '';
  }

  function matchesTrophyFilter(rec, filter) {
    if (filter === 'Legendary') return rec.rarity === 'Legendary';
    if (filter === 'Secret') return rec.rarity === 'Secret';
    if (filter === 'variant') return !!(rec.shiny || rec.golden);
    return true;
  }

  async function renderTrophyPop() {
    if (!ui.trophyPop || !ui.trophyList || !trophyPopOpen) return;
    revokeTrophyUrls();
    if (ui.trophyTabs) {
      ui.trophyTabs.forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.filter === trophyFilter);
      });
    }
    ui.trophyList.textContent = '';
    ui.trophyList.appendChild(el('div', 'trophy-empty', 'Loading trophy cards…'));
    var rows = (await listTrophyCards(profileName())).filter(function (r) {
      return matchesTrophyFilter(r, trophyFilter);
    });
    if (!trophyPopOpen || !ui.trophyList) return;
    ui.trophyList.textContent = '';
    if (!rows.length) {
      ui.trophyList.appendChild(el('div', 'trophy-empty', 'No saved trophy cards in the last 24 hours.'));
      return;
    }
    rows.forEach(function (rec) {
      var item = el('div', 'trophy-item');
      if (rec.blob && typeof URL !== 'undefined' && URL.createObjectURL) {
        var img = document.createElement('img');
        img.className = 'trophy-img';
        var objUrl = URL.createObjectURL(rec.blob);
        trophyUrls.push(objUrl);
        img.src = objUrl;
        img.alt = rec.species;
        item.appendChild(img);
      }
      var info = el('div', 'trophy-info');
      var tags = [];
      if (rec.rarity) tags.push(rec.rarity);
      if (rec.shiny) tags.push('Shiny');
      if (rec.golden) tags.push('Golden');
      info.appendChild(el('div', 'trophy-name', rec.species + (tags.length ? ' · ' + tags.join(' · ') : '')));
      var sub = [rec.weight, rec.value, rec.at ? clockTime(rec.at) : ''].filter(Boolean).join(' · ');
      info.appendChild(el('div', 'trophy-sub', sub || 'captured trophy'));
      item.appendChild(info);
      ui.trophyList.appendChild(item);
    });
  }

  function openTrophyPop(filter) {
    trophyFilter = filter || 'all';
    trophyPopOpen = true;
    resetClearConfirm();
    if (ui.trophyPop) {
      ui.trophyPop.classList.remove('hide');
      try { ui.trophyPop.focus(); } catch (e) {}
    }
    renderTrophyPop();
  }

  /* ----------------------------------- bounded result-missing auto-reload ---- */

  function maybeAutoReloadResultMissing(status) {
    var missing = !!(status && status.resultMissing) || (state && state.pauseReason === 'result-missing');
    if (!missing || state.phase !== 'paused') {
      resultMissingSince = null;
      return;
    }
    if (!window.__panel || !window.__panel.resumeAfterReload) return;
    var now = Date.now();
    if (!resultMissingSince) { resultMissingSince = now; return; }
    if (now - resultMissingSince < RESULT_MISSING_RELOAD_GRACE_MS) return;
    var gateFn = window.AutoFishSession && window.AutoFishSession.reloadGate;
    var gate = gateFn ? gateFn(readJSON(RELOAD_GUARD_KEY, []), now) : { allow: false, times: [] };
    if (!gate.allow) {
      resultMissingSince = now; // quiet until window rolls over
      banner = 'waiting-for-result reload cap (2/hour) reached — click Reload game manually';
      return;
    }
    writeJSON(RELOAD_GUARD_KEY, gate.times);
    postSessionRow(
      'result-missing-reload',
      Math.round((state.fishingMs || 0) / 60000),
      state.catchCount || 0,
      state.startedAt,
      'auto-reload after waiting-for-result lock'
    );
    writeJSON(LIVE_KEY, {
      startedAt: state.startedAt,
      phase: state.phase,
      pauseReason: 'result-missing',
      autoReload: true,
      minutes: Math.round((state.fishingMs || 0) / 60000),
      catches: state.catchCount || 0,
      at: now,
    });
    try { window.location.reload(); } catch (e) {
      banner = 'reload the game tab to clear the waiting-for-result lock';
    }
  }

  /** The profile picker: every ledger or budget key that exists, plus the one in use. */
  function fillProfiles() {
    if (!ui.profile) return;
    var f = fish();
    var current = (f && f.logProfile) ? f.logProfile() : 'default';
    var names = [];
    try { names = (f && f.logProfiles) ? f.logProfiles() : []; } catch (e) { names = []; }
    // A profile that has a budget/cooldown but no catch yet has no ledger key, so logProfiles()
    // would drop it as soon as the user switches away. Keep those selectable too.
    try {
      var st = window.localStorage;
      for (var i = 0; i < (st.length || 0); i++) {
        var k = st.key(i);
        if (k && k.indexOf(BUDGET_PREFIX) === 0) {
          var n = k.slice(BUDGET_PREFIX.length);
          if (n && names.indexOf(n) < 0) names.push(n);
        }
      }
    } catch (e) { /* a blocked store simply has no discoverable profiles */ }
    if (names.indexOf('default') < 0) names.unshift('default');
    if (names.indexOf(current) < 0) names.push(current);
    ui.profile.textContent = '';
    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      ui.profile.appendChild(opt);
    });
    ui.profile.value = current;
  }

  function activePhase() {
    return state && (state.phase === 'running' || state.phase === 'paused' || state.phase === 'waiting');
  }

  /**
   * A profile is a history partition, so it owns its day budget and its cooldown too. Switching one
   * mid-session would silently move the cap underneath a live run, so it is only allowed while idle.
   */
  function switchProfile(name) {
    var f = fish();
    if (!f || !f.logProfile) return false;
    if (activePhase()) {
      banner = 'stop the session before switching profiles';
      render();
      return false;
    }
    f.logProfile(name);
    savePrefs();
    var b = loadBudget();
    baseTodayMs = b.ms;
    budgetDay = b.day;
    state.todayMs = b.ms;
    state.fishingMs = 0;
    state.catchCount = 0;
    var flow = state.mode === 'flow';
    state.cooldownUntil = flow ? null : b.cooldownUntil;
    state.phase = (!flow && b.cooldownUntil) ? 'cooldown' : 'idle';
    state.stopReason = null;
    state.pauseReason = null;
    state.startedAt = null;
    state.lastTickAt = null;
    banner = '';
    syncBudget();
    fillProfiles();
    refreshTrophyCounts();
    if (trophyPopOpen) renderTrophyPop();
    renderLog();
    render();
    return true;
  }

  /** @satisfies {Record<SessionAction['type'], (a: any) => void>} */
  var RUNNERS = {
    startCore: function (a) {
      // A new core has a fresh detector. The watchdog starts it without a reducer action, so clear
      // the old pause credit here rather than carrying it across the restart.
      if (window.AutoFishSession && state && window.AutoFishSession.clearBlindPause) {
        window.AutoFishSession.clearBlindPause(state);
      }
      // A second Start in the same page must see the minutes the first session just logged; the
      // reducer has already reset fishingMs, so the day's total has to come from the store.
      baseTodayMs = loadBudget().ms;
      var server = BASE || captureServer();
      var post = (window.__panel && (window.__panel.localCapture || window.__panel.postCatches) && server) ? server + '/catch' : null;
      fish().start({
        maxMinutes: a.maxMinutes,
        logUrl: post,
      });
    },
    stopCore: function () { try { fish().stop(); } catch (e) {} },
    pauseCore: function () { try { fish().pause(); } catch (e) {} },
    resumeCore: function () { try { fish().resume(); } catch (e) {} },
    // A seat pause leaves the core running to watch for the prompt. This flag forbids the one act
    // that would destroy what it is watching for: a cast retry that puts a line in the water.
    holdCasts: function (a) { try { fish().holdCasts(!!a.on); } catch (e) {} },
    wakeLock: function () { acquireWakeLock(); },
    releaseWakeLock: function () { releaseWakeLock(); },
    persist: function () { savePrefs(); writeHeartbeat(); syncBudget(); },
    sessionRow: function (a) { postSessionRow(a.reason, a.minutes, a.catches, undefined, guardNote(a.diag)); },
    refuse: function (a) {
      if (a.reason === 'cooldown') banner = 'cooling down — wait for the timer, or use Start now';
      else if (a.reason === 'result-missing') banner = 'game is waiting for a fishing result — reload the game tab, then start again';
      else if (a.reason === 'window') banner = 'clock window is closed — start after ' + state.window.start;
      else banner = 'daily cap reached — no more fishing today';
    }
  };

  function apply(actions) {
    (actions || []).forEach(function (a) {
      var run = RUNNERS[a.type];
      if (run) { try { run(a); } catch (e) { banner = 'action ' + a.type + ' failed: ' + e.message; } }
    });
    render();
  }

  function dispatch(fact) {
    // Only an accepted Start begins a new crash-loop budget. A refused Start during cooldown used
    // to clear the window too, erasing the evidence of the loop that put the session there.
    var startedAt = state.startedAt;
    var out = /** @type {AutoFishSessionApi} */ (window.AutoFishSession).reduce(state, fact);
    if (fact.type === 'start' && out.state.startedAt !== startedAt) reviveTimes = [];
    state = out.state;
    apply(out.actions);
    return out;
  }

  /* -------------------------------------------------------- wake lock ----- */

  async function acquireWakeLock() {
    if (!navigator.wakeLock) { banner = 'this browser cannot hold the screen awake'; return; }
    try {
      wakeSentinel = await navigator.wakeLock.request('screen');
      wakeSentinel.addEventListener('release', function () { wakeSentinel = null; });
    } catch (e) {
      wakeSentinel = null;
      banner = 'screen may sleep — the game freezes when it does';
    }
  }

  function releaseWakeLock() {
    if (wakeSentinel) { try { wakeSentinel.release(); } catch (e) {} wakeSentinel = null; }
  }

  /* --------------------------------------------------------- heartbeat ---- */

  function writeHeartbeat() {
    if (state.phase === 'running' || state.phase === 'paused' || state.phase === 'waiting') {
      // catches travels with the heartbeat: a reload row cannot report what the record never kept.
      writeJSON(LIVE_KEY, { startedAt: state.startedAt, phase: state.phase, minutes: Math.round(state.fishingMs / 60000), catches: state.catchCount, at: Date.now() });
    } else {
      try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
    }
  }

  function checkInterrupted() {
    var live = readJSON(LIVE_KEY, null);
    if (!live) return '';
    try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
    var minutes = typeof live.minutes === 'number' ? live.minutes : 0;
    var catches = typeof live.catches === 'number' ? live.catches : 0;
    var startedAt = typeof live.startedAt === 'number' ? live.startedAt : null;
    // The row is dated by the session's own start, not by this page load. fishserve buckets a row
    // on localDay(started_at), so an honest start files an overnight record under the day it began
    // and keeps those minutes out of today's cap. The old fallback made every interrupted row claim
    // to start now (live 2026-11-21: started_at 05:08:07.212Z, logged 05:08:07.856Z), which is how
    // a 110 minute night was counted against a 5.4 minute day.
    postSessionRow('reload', minutes, catches, startedAt);
    if (!loadPrefs().resumeAfterReload) return 'session interrupted by a reload — not resumed';
    // A hold is explicit: a reload must not turn a paused session into a running one, except a
    // bounded result-missing auto-reload where waiting-for-result forced the pause itself.
    if (live.phase === 'paused' && !live.autoReload) return 'paused session ended by the reload — start again when ready';
    if (state.phase === 'cooldown') return 'session ended by the reload — cooling down';
    if (state.mode !== 'flow' && state.todayMs >= state.dailyCapMs) return 'session ended by the reload — daily cap reached';
    // start() itself honours the clock window: outside it the session waits instead of fishing.
    dispatch({ type: 'start', at: Date.now() });
    return state.phase === 'waiting' ? 'waiting for the clock window after the reload' : 'session resumed after the reload';
  }

  /* -------------------------------------------------------------- DOM ----- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  var CSS = [
    ':host{all:initial}',
    '.wrap{position:relative;font:12px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8ecef;user-select:none;-webkit-user-select:none}',
    '.card{position:relative;width:264px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.45);backdrop-filter:blur(10px);overflow:hidden}',
    '.head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:rgba(255,255,255,.04);cursor:grab}',
    '.head:active{cursor:grabbing}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#5a6470;flex:none}',
    '.dot.running{background:#5ad18b;box-shadow:0 0 0 3px rgba(90,209,139,.18)}',
    '.dot.waiting{background:#f2c14e}.dot.paused{background:#f08a4b}.dot.cooldown{background:#7aa2f7}',
    '.title{font-weight:600;letter-spacing:.2px;flex:1}',
    '.ver{flex:none;font-size:10px;color:#9aa4ae;letter-spacing:.3px;font-variant-numeric:tabular-nums}',
    '.ver.update{cursor:pointer;color:#5ad18b;background:rgba(90,209,139,.14);border:1px solid rgba(90,209,139,.35);border-radius:99px;padding:1px 6px}',
    '.ver.update:hover{background:rgba(90,209,139,.24)}',
    '.ver:empty{display:none}',
    '.chip{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#aab4bf;border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:1px 7px}',
    '.icon{border:0;background:transparent;color:#9aa4ae;font-size:14px;cursor:pointer;padding:2px 4px;border-radius:6px}',
    '.icon:hover{background:rgba(255,255,255,.08);color:#e8ecef}',
    'button:focus-visible,.pill:focus-visible,[role="button"]:focus-visible,.sel:focus-visible{outline:2px solid #5ad18b;outline-offset:2px;border-radius:6px}',
    '.body{padding:10px;display:flex;flex-direction:column;gap:9px}',
    '.row{display:flex;align-items:center;gap:6px}',
    '.label{flex:1;color:#aab4bf}',
    '.step{display:flex;align-items:center;gap:2px;background:rgba(255,255,255,.05);border-radius:9px;padding:2px}',
    '.step button{border:0;background:transparent;color:#cfd6dd;width:24px;height:22px;border-radius:7px;cursor:pointer;font-size:14px;line-height:1}',
    '.step button:hover{background:rgba(255,255,255,.10)}',
    '.step button:disabled{opacity:.3;cursor:default}',
    '.val{min-width:64px;width:64px;text-align:center;font:inherit;font-variant-numeric:tabular-nums;color:#e8ecef;background:transparent;border:1px solid transparent;border-radius:7px;padding:2px 3px;outline:none}',
    '.val:hover{border-color:rgba(255,255,255,.12)}',
    '.val:focus{border-color:rgba(90,209,139,.55);background:rgba(255,255,255,.06)}',
    '.val[aria-invalid]{border-color:#a33a3a;background:rgba(163,58,58,.12)}',
    '.meters{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding-top:2px;border-top:1px solid rgba(255,255,255,.08)}',
    '.m{display:flex;justify-content:space-between;color:#9aa4ae}',
    '.m b{color:#e8ecef;font-weight:600;font-variant-numeric:tabular-nums}',
    '.actions{display:flex;gap:6px}',
    '.primary{flex:1;border:0;border-radius:10px;padding:9px;font:inherit;font-weight:600;cursor:pointer;background:#2f7d5a;color:#eafff2}',
    '.primary.stop{background:#a33a3a;color:#ffecec}',
    '.primary:disabled{opacity:.45;cursor:default}',
    '.secondary{flex:none;border:0;border-radius:10px;padding:9px 10px;font:inherit;font-weight:600;cursor:pointer;background:rgba(255,255,255,.10);color:#dfe5ea}',
    '.secondary:hover{background:rgba(255,255,255,.16)}',
    '.secondary:disabled{opacity:.45;cursor:default}',
    '.banner{font-size:11px;color:#f2c14e;background:rgba(242,193,78,.10);border-top:1px solid rgba(242,193,78,.22);padding:6px 10px}',
    '.banner:empty{display:none}',
    '.banner.seat{color:#ffc0b0;background:rgba(255,120,90,.14);border-top-color:rgba(255,120,90,.34)}',
    '.banner.focus{color:#cfe0ff;background:rgba(122,162,247,.12);border-top-color:rgba(122,162,247,.30)}',
    '.banner.info{color:#cfd6dd;background:rgba(255,255,255,.05);border-top-color:rgba(255,255,255,.12)}',
    '.dot.stalled{background:#ff6b6b;box-shadow:0 0 0 3px rgba(255,107,107,.20)}',
    '.banner.stall{color:#ffb3b3;background:rgba(255,90,90,.14);border-top-color:rgba(255,90,90,.34)}',
    '.banner.result{color:#ffd0a0;background:rgba(255,145,80,.14);border-top-color:rgba(255,145,80,.34)}',
    '.banner.blind{color:#ffc9a8;background:rgba(255,120,60,.14);border-top-color:rgba(255,120,60,.34)}',
    '.banner.success{color:#5ad18b;background:rgba(90,209,139,.12);border-top-color:rgba(90,209,139,.34)}',
    '.logbox{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}',
    '.loghead{display:flex;align-items:center;gap:4px}',
    '.logmeta{font-size:10px;color:#9aa4ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.logmeta.clickable,.tier.clickable{cursor:pointer;border-radius:6px;padding:1px 2px}',
    '.logmeta.clickable:hover,.tier.clickable:hover{background:rgba(255,255,255,.08)}',
    '.icon.csv{font-size:10px;font-weight:600;padding:2px 5px;color:#b8c2cc}',
    '.icon.danger{color:#ff8fa3}.icon.danger.armed{background:rgba(255,107,107,.16);color:#ffb3b3}',
    '.strip{display:flex;gap:4px}',
    '.tier{flex:1;display:flex;flex-direction:column;align-items:center;line-height:1.25}',
    '.tier b{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}',
    '.tier span{font-size:9.5px;letter-spacing:.3px;text-transform:uppercase;color:#9aa4ae}',
    '.last{font-size:10.5px;color:#9aa4ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sel{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e8ecef;font:inherit;font-size:11px;padding:2px 4px;max-width:104px}',
    '.sel option{background:#12161c;color:#e8ecef}',
    '.perfbox{display:flex;flex-direction:column;gap:2px;padding:6px 4px 2px;border-top:1px solid rgba(255,255,255,.08);cursor:pointer;border-radius:6px}',
    '.perfbox:hover{background:rgba(255,255,255,.04)}',
    '.perf{font-size:10px;color:#9aa4ae;font-variant-numeric:tabular-nums;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.capture{font-size:10px;color:#9aa4ae;font-variant-numeric:tabular-nums;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:4px}',
    '.capture[role="button"]:hover{text-decoration:underline}',
    '.capture.on{color:#5ad18b}.capture.warn{color:#f2c14e}',
    '.subhead{font-size:9.5px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#8b95a0;padding-top:4px;border-top:1px solid rgba(255,255,255,.06)}',
    '.subhead:first-child{padding-top:0;border-top:0}',
    '.timedgrp{display:flex;flex-direction:column;gap:9px}',
    '.icon.mode{width:auto;min-width:44px;padding:0 7px;font-size:10.5px;font-weight:600;border-radius:7px}',
    '.perfjson{margin:4px 0 0;max-height:150px;overflow:auto;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfd6dd;white-space:pre-wrap;word-break:break-word;user-select:text;-webkit-user-select:text}',
    '.sec{border-top:1px solid rgba(255,255,255,.08)}',
    '.sechead{display:flex;align-items:center;gap:7px;width:100%;border:0;background:transparent;color:#aab4bf;font:inherit;font-size:11px;letter-spacing:.3px;padding:8px 0 7px;cursor:pointer;text-align:left}',
    '.sechead:hover{color:#e8ecef}',
    '.sechead:focus-visible{outline:2px solid rgba(90,209,139,.55);outline-offset:2px;border-radius:6px}',
    '.chev{flex:none;display:inline-block;font-size:9px;color:#8b95a0;transition:transform .16s cubic-bezier(.16,1,.3,1)}',
    '.sec.open .chev{transform:rotate(90deg)}',
    '.secbody{display:flex;flex-direction:column;gap:8px;padding-bottom:9px}',
    '.pill{width:48px;height:48px;padding:0;color:#e8ecef;border-radius:14px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}',
    '.trophy-pop{position:absolute;inset:0;z-index:10;background:#12161c;min-height:280px;display:flex;flex-direction:column;gap:6px;padding:10px}',
    '.trophy-head{display:flex;align-items:center;gap:6px}',
    '.trophy-title{flex:1;font-weight:600;font-size:11.5px;color:#e8ecef}',
    '.trophy-tabs{display:flex;gap:4px}',
    '.trophy-tab{border:0;background:rgba(255,255,255,.06);color:#9aa4ae;font:inherit;font-size:10px;padding:3px 7px;border-radius:99px;cursor:pointer}',
    '.trophy-tab.active{background:rgba(90,209,139,.18);color:#5ad18b}',
    '.trophy-list{flex:1;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}',
    '.trophy-foot{display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;color:#8b95a0}',
    '.trophy-item{display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px}',
    '.trophy-img{width:100%;height:auto;border-radius:6px;display:block}',
    '.trophy-name{font-size:11px;font-weight:600;color:#e8ecef}',
    '.trophy-sub{font-size:10px;color:#9aa4ae}',
    '.trophy-empty{font-size:11px;color:#8b95a0;text-align:center;padding:24px 8px}',
    '.hide{display:none}'
  ].join('\n');

  // The eight rarity tiers the game uses, in ascending order. The strip shows all of them so an
  // empty tier reads as "none yet" instead of vanishing.
  var TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas'];
  var TIER_COLORS = {
    Common: '#aab4bf', Uncommon: '#7fd6a1', Rare: '#6cb6ff', Epic: '#b58cff',
    Legendary: '#f2c14e', Secret: '#ff8fa3', Halloween: '#ff9f5a', Christmas: '#8fe3e0'
  };

  function build() {
    ui = {};
    host = document.createElement('div');
    host.id = 'autofish-panel';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);


    var wrap = el('div', 'wrap');
    var card = el('div', 'card');

    var head = el('div', 'head');
    var dot = el('div', 'dot');
    var title = el('div', 'title', 'AutoFish');
    var ver = el('div', 'ver', versionLabel());
    ver.title = 'build ' + ((fish() && fish().version) || 'unknown');
    var chip = el('div', 'chip', 'idle');
    var min = el('button', 'icon', '–');
    min.type = 'button';
    min.title = 'collapse';
    min.setAttribute('aria-label', 'Collapse AutoFish panel');
    head.append(dot, title, ver, chip, min);

    var body = el('div', 'body');

    // Two tiers. A running session asks one question at a glance - is it working, and how much
    // budget is left - so the counters, the ledger and the Start/Pause pair stay on the surface,
    // while everything decided once (lengths, guards, profile, frame report) folds away below.
    var setSec = section('Session & guards');
    var diagSec = section('Diagnostics');

    setSec.body.appendChild(el('div', 'subhead', 'Schedule'));

    var modeRow = el('div', 'row');
    var modeLabel = el('div', 'label', 'Mode');
    var modeToggle = el('button', 'icon mode', 'Timed');
    modeToggle.type = 'button';
    modeToggle.title = 'Flow: fish nonstop until Stop · Timed: bounded by session, cooldown and daily cap';
    modeRow.append(modeLabel, modeToggle);
    setSec.body.appendChild(modeRow);

    var timedWrap = el('div', 'timedgrp');
    timedWrap.append(
      stepperRow('Session', 'dur'),
      stepperRow('Cooldown', 'cool'),
      stepperRow('Daily time cap', 'cap')
    );

    // clock window
    var winRow = el('div', 'row');
    var winLabel = el('div', 'label', 'Clock window');
    var winToggle = el('button', 'icon', 'off');
    winToggle.type = 'button';
    winToggle.title = 'run only between two times';
    winRow.append(winLabel, winToggle);
    timedWrap.appendChild(winRow);

    var timeRow = el('div', 'row');
    timeRow.appendChild(stepper('from', 15));
    timeRow.appendChild(stepper('to', 15));
    timedWrap.appendChild(timeRow);

    // Rest, then run again in Timed mode.
    var chainRow = el('div', 'row');
    var chainLabel = el('div', 'label', 'Auto-start next run');
    var chainToggle = el('button', 'icon', 'off');
    chainToggle.type = 'button';
    chainToggle.title = 'after the cooldown, start the next session on its own (still bounded by the window and the cap)';
    chainRow.append(chainLabel, chainToggle);
    timedWrap.appendChild(chainRow);
    setSec.body.appendChild(timedWrap);

    setSec.body.appendChild(el('div', 'subhead', 'Safety guards'));
    setSec.body.appendChild(stepperRow('Stop when hidden', 'hidden'));

    // cosmetic only: quietens the in-session Cozier upsell, see setUpsellHidden()
    var upsellRow = el('div', 'row');
    var upsellLabel = el('div', 'label', 'Cozier popup');
    var upsellToggle = el('button', 'icon', upsellOn ? 'on' : 'off');
    upsellToggle.type = 'button';
    upsellToggle.title = 'hide the in-session Cozier upsell (cosmetic: a free account still cannot fish in focus)';
    upsellRow.append(upsellLabel, upsellToggle);
    setSec.body.appendChild(upsellRow);

    // Pause in focus sessions: stop the run while a session is active. It hides nothing - the cast
    // prompt is the game's own drawing - so the label says exactly what it does.
    var focusRow = el('div', 'row');
    var focusLabel = el('div', 'label', 'Pause in focus sessions');
    var focusToggle = el('button', 'icon', focusOn ? 'on' : 'off');
    focusToggle.type = 'button';
    focusToggle.title = 'pause autofish while a focus session is active; the cast prompt is drawn by the game and stays visible';
    focusRow.append(focusLabel, focusToggle);
    setSec.body.appendChild(focusRow);

    var reloadRow = el('div', 'row');
    var reloadLabel = el('div', 'label', 'Resume after reload');
    var reloadToggle = el('button', 'icon', (window.__panel && window.__panel.resumeAfterReload) ? 'on' : 'off');
    reloadToggle.type = 'button';
    reloadToggle.title = 'start a session again after a page reload; also allows bounded (<=2/h) recovery from waiting-for-result locks';
    reloadRow.append(reloadLabel, reloadToggle);
    setSec.body.appendChild(reloadRow);

    setSec.body.appendChild(el('div', 'subhead', 'Alerts & capture'));

    var chimeRow = el('div', 'row');
    var chimeLabel = el('div', 'label', 'Rare catch chime');
    var chimeToggle = el('button', 'icon', rareChimePref ? 'on' : 'off');
    chimeToggle.type = 'button';
    chimeToggle.title = 'play a gentle Web Audio chime on Legendary, Secret, Shiny, or Golden catches';
    chimeRow.append(chimeLabel, chimeToggle);
    setSec.body.appendChild(chimeRow);

    // Unified fishserve opt-in: streams catches to catches.csv and loads the 5-minute sampler.
    var captureRow = el('div', 'row');
    var captureLabel = el('div', 'label', 'Local capture');
    var captureToggle = el('button', 'icon', overnightPref ? 'on' : 'off');
    captureToggle.type = 'button';
    captureToggle.title = 'optional (needs "node fishserve.js"): stream catches.csv & 5m snapshots; Catch history already saves in your browser';
    // The row is the control, not the 14 px switch: the status line tells the owner to click
    // capture, and that has to work wherever on the row they click.
    captureRow.style.cursor = 'pointer';
    captureRow.title = captureToggle.title;
    captureRow.append(captureLabel, captureToggle);
    setSec.body.appendChild(captureRow);

    // One ledger per profile, because two accounts in one browser used to share one history.
    var profRow = el('div', 'row');
    var profLabel = el('div', 'label', 'Profile');
    var profSel = document.createElement('select');
    profSel.className = 'sel';
    profSel.setAttribute('aria-label', 'Active catch profile');
    profSel.title = 'which catch history this panel reads and writes';
    var profAdd = el('button', 'icon', '+');
    profAdd.type = 'button';
    profAdd.setAttribute('aria-label', 'New profile');
    profAdd.title = 'new profile with its own catch history and daily budget';
    var profReset = el('button', 'icon', '↺');
    profReset.type = 'button';
    profReset.setAttribute('aria-label', 'Clear profile catch history');
    profReset.title = 'clear this profile’s catch history (cannot be undone)';
    profRow.append(profLabel, profSel, profAdd, profReset);
    setSec.body.appendChild(profRow);

    var meters = el('div', 'meters');
    meters.append(
      meter('left', 'Timer'), meter('catches'), meter('presses'), meter('today')
    );
    body.appendChild(meters);

    // Always on the surface while capture is on, not folded into the settings: the whole point is
    // to see that the night is being written down without opening anything.
    var captureLine = el('div', 'capture hide', '');
    body.appendChild(captureLine);

    // Pause/Resume is the primary action while a session is alive; Stop is separate because it is
    // the one that starts the cooldown. Putting it ahead of Catch history keeps the main control
    // in one steady place at the top of the card.
    var primary = el('button', 'primary', 'Start');
    primary.type = 'button';
    var secondary = el('button', 'secondary hide', 'Stop');
    secondary.type = 'button';
    var actions = el('div', 'actions');
    actions.append(primary, secondary);
    body.appendChild(actions);

    // Catch history. The core writes it on every parsed catch; the panel only reads it, so a
    // reload of the game still shows yesterday's ledger.
    var logBox = el('div', 'logbox');
    var strip = el('div', 'strip');
    /** @type {Array<{ name: string, num: HTMLElement, cell?: HTMLElement }>} */
    var tierCells = TIER_NAMES.map(function (name) {
      var cell = el('div', 'tier');
      var num = el('b', null, '0');
      var tag = el('span', null, name.slice(0, 3));
      cell.title = name + ' caught';
      cell.style.color = TIER_COLORS[name];
      cell.append(num, tag);
      strip.appendChild(cell);
      return { name: name, num: num };
    });
    // A catch the catalogue does not know is logged as Unknown. It used to have no cell at all, so
    // the strip read all zeros while the ledger filled - which looks exactly like "not recording".
    var unknownCell = el('div', 'tier');
    var unknownNum = el('b', null, '0');
    var unknownTag = el('span', null, 'UNK');
    unknownCell.title = 'caught and logged, but the card printed no rarity and the species is not in the built-in catalogue';
    unknownCell.style.color = TIER_COLORS.Common;
    unknownCell.style.display = 'none';
    unknownCell.append(unknownNum, unknownTag);
    strip.appendChild(unknownCell);
    tierCells.push({ name: 'Unknown', num: unknownNum, cell: unknownCell });
    var logHead = el('div', 'loghead');
    var logLabel = el('div', 'label', 'Catch history');
    var logTrophiesBtn = el('button', 'icon csv', 'Trophies');
    logTrophiesBtn.type = 'button';
    logTrophiesBtn.title = 'view saved Legendary, Secret, Shiny, and Golden catch cards (kept 24h)';
    logTrophiesBtn.setAttribute('aria-label', 'View 24-hour trophy cards');
    var logCsvBtn = el('button', 'icon csv', '↓ CSV');
    logCsvBtn.type = 'button';
    logCsvBtn.title = 'download catch history as CSV';
    logCsvBtn.setAttribute('aria-label', 'Download catch history as CSV');
    var logToggle = el('button', 'icon', 'all');
    logToggle.type = 'button';
    logToggle.title = 'switch the rarity strip between all-time and today';
    logHead.append(logLabel, logTrophiesBtn, logCsvBtn, logToggle);
    var logTotal = el('div', 'last', 'all 0 · today 0');
    var logMeta = el('div', 'logmeta', '');
    var lastCatch = el('div', 'last', 'no catches yet');
    logBox.append(logHead, logTotal, strip, logMeta, lastCatch);
    body.appendChild(logBox);

    // The frame report, on screen. DevTools is not always within reach - Zen takes no synthetic
    // keystrokes, so __fish.perf() cannot be read there - and these are the numbers that decide
    // whether a build needs another detour. Same source; a click expands the whole report.
    var perfBox = el('div', 'perfbox');
    perfBox.setAttribute('role', 'button');
    perfBox.tabIndex = 0;
    perfBox.setAttribute('aria-expanded', 'false');
    var perfLine = el('div', 'perf', 'No frames measured yet');
    var accLine = el('div', 'perf', 'No attempts yet');
    var accMore = el('div', 'perf', '');
    var perfMore = el('div', 'perf', '');
    // The four detector shares are split over two lines: at 9.5px the single line reached 241-252 px
    // in the 244 px card once the shares were three digits wide, and a second line cannot be
    // outgrown by a digit the way a single one can.
    var perfRate = el('div', 'perf', '');
    var perfJson = el('pre', 'perfjson hide', '');
    perfBox.title = 'frame budget and fish accuracy; click or press Enter for the full calibration report';
    perfBox.append(perfLine, accLine, accMore, perfMore, perfRate, perfJson);
    diagSec.body.appendChild(perfBox);

    // Tier 2 lives below the run view, never above it.
    body.append(setSec.el, diagSec.el);

    var bannerEl = el('div', 'banner');
    bannerEl.setAttribute('role', 'status');
    bannerEl.setAttribute('aria-live', 'polite');

    var trophyPop = el('div', 'trophy-pop hide');
    trophyPop.setAttribute('role', 'dialog');
    trophyPop.setAttribute('aria-modal', 'true');
    trophyPop.setAttribute('aria-label', 'Trophy cards (24h)');
    trophyPop.tabIndex = -1;
    var trophyHead = el('div', 'trophy-head');
    var trophyTitle = el('div', 'trophy-title', 'Trophy cards (24h)');
    var trophyClose = el('button', 'icon', '×');
    trophyClose.type = 'button';
    trophyClose.setAttribute('aria-label', 'Close trophy viewer');
    trophyClose.title = 'close trophy viewer (Esc)';
    trophyHead.append(trophyTitle, trophyClose);
    var trophyTabsWrap = el('div', 'trophy-tabs');
    /** @type {HTMLButtonElement[]} */
    var trophyTabs = [
      { id: 'all', label: 'All' },
      { id: 'Legendary', label: 'LEG' },
      { id: 'Secret', label: 'SEC' },
      { id: 'variant', label: 'Shiny/Gold' }
    ].map(function (spec) {
      var btn = /** @type {HTMLButtonElement} */ (el('button', 'trophy-tab', spec.label));
      btn.type = 'button';
      btn.dataset.filter = spec.id;
      btn.addEventListener('click', function () {
        trophyFilter = spec.id;
        renderTrophyPop();
      });
      trophyTabsWrap.appendChild(btn);
      return btn;
    });
    var trophyList = el('div', 'trophy-list');
    var trophyFoot = el('div', 'trophy-foot');
    var trophyHint = el('span', null, 'Auto-expires after 24h');
    var trophyClear = el('button', 'icon csv danger', 'clear');
    trophyClear.type = 'button';
    trophyClear.setAttribute('aria-label', 'Clear saved trophy cards for this profile');
    trophyClear.title = 'click twice to clear saved trophy cards for this profile';
    trophyFoot.append(trophyHint, trophyClear);
    trophyPop.append(trophyHead, trophyTabsWrap, trophyList, trophyFoot);

    card.append(head, body, bannerEl, trophyPop);
    var pill = el('button', 'pill hide', '🎣');
    pill.type = 'button';
    pill.title = 'Expand AutoFish panel';
    pill.setAttribute('aria-label', 'Expand AutoFish panel');
    wrap.append(card, pill);
    root.appendChild(wrap);

    document.documentElement.appendChild(host);

    // stepperRow()/stepper()/meter() registered their pieces on ui as they built the DOM;
    // merge rather than replace, or every one of those references is lost.
    Object.assign(ui, {
      wrap: wrap, card: card, head: head, dot: dot, ver: ver, chip: chip, minBtn: min,
      modeToggle: modeToggle, timedWrap: timedWrap,
      winToggle: winToggle, timeRow: timeRow, upsellToggle: upsellToggle,
      focusToggle: focusToggle,
      chainToggle: chainToggle, reloadToggle: reloadToggle, chimeToggle: chimeToggle,
      captureToggle: captureToggle, captureLine: captureLine,
      profile: profSel, profileAdd: profAdd, profileReset: profReset,
      primary: primary, secondary: secondary, banner: bannerEl, pill: pill,
      tierCells: tierCells, unknownCell: unknownCell, lastCatch: lastCatch,
      logTrophiesBtn: logTrophiesBtn, logCsvBtn: logCsvBtn, logToggle: logToggle, logTotal: logTotal, logMeta: logMeta,
      trophyPop: trophyPop, trophyTabs: trophyTabs, trophyList: trophyList, trophyClear: trophyClear,
      perfLine: perfLine, accLine: accLine, accMore: accMore, perfMore: perfMore, perfRate: perfRate, perfJson: perfJson
    });

    // stop the game seeing our clicks (bubble phase: our handlers already ran)
    ['pointerdown', 'pointerup', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel'].forEach(function (type) {
      if (host) host.addEventListener(type, function (e) { e.stopPropagation(); }, false);
    });
    if (host) host.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    min.addEventListener('click', function () { userExpanded = false; setCollapsed(true); });
    pill.addEventListener('click', function () { userExpanded = true; setCollapsed(false); });
    perfBox.addEventListener('click', function () { togglePerf(); });
    perfBox.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      togglePerf();
    });
    function togglePerf() {
      // Expand, then read: the report is a snapshot of the last ~10 s, not a live feed.
      var hidden = perfJson.classList.toggle('hide');
      perfBox.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      if (!hidden) {
        try {
          var f = fish();
          var rep = {
            perf: f.perf(),
            accuracy: f.accuracy ? f.accuracy() : null,
            calibration: f.calibration ? f.calibration() : null,
          };
          perfJson.textContent = JSON.stringify(rep, null, 1);
        } catch (e) { perfJson.textContent = String((e && e.message) || e); }
      }
      place();
    }
    primary.addEventListener('click', function () {
      unlockAudio();
      var at = Date.now();
      if (state.phase === 'running') dispatch({ type: 'pause', at: at });
      else if (state.phase === 'paused') {
        // The only recovery from a missing game result is a page reload. Do not offer a Resume
        // that the reducer has to refuse: make the action the button names.
        if (resultMissingNow()) {
          try { window.location.reload(); } catch (e) {
            banner = 'reload the game tab to clear the waiting-for-result lock';
            render();
          }
          return;
        }
        dispatch({ type: 'resume', at: at });
      }
      else if (state.phase === 'waiting') dispatch({ type: 'stop', at: at, reason: 'user' });
      else dispatch({ type: 'start', at: at });
    });
    secondary.addEventListener('click', function () {
      var at = Date.now();
      if (state.phase === 'cooldown') {
        if (!window.confirm('The cooldown is self-imposed. Skip it and start fishing now?')) return;
        dispatch({ type: 'skip-cooldown', at: at });
        dispatch({ type: 'start', at: at });
        return;
      }
      dispatch({ type: 'stop', at: at, reason: 'user' });
    });
    modeToggle.addEventListener('click', function () {
      var next = state.mode === 'flow' ? 'timed' : 'flow';
      dispatch({ type: 'config', at: Date.now(), patch: { mode: next } });
      try {
        if (window.__fish && window.__fish.tune && (state.phase === 'running' || state.phase === 'paused')) {
          window.__fish.tune({ maxMinutes: next === 'flow' ? 0 : Math.ceil(state.durationMs / 60000) + 2 });
        }
      } catch (e) {}
      savePrefs();
      render();
    });
    winToggle.addEventListener('click', function () {
      dispatch({ type: 'config', at: Date.now(), patch: { window: { on: !state.window.on } } });
      savePrefs();
    });
    upsellToggle.addEventListener('click', function () {
      setUpsellHidden(!upsellOn);
      savePrefs();
    });
    focusToggle.addEventListener('click', function () {
      focusPref = !focusOn;   // the setting, not the live hold
      setFocusMode(focusPref);
      savePrefs();
    });
    chainToggle.addEventListener('click', function () {
      dispatch({ type: 'config', at: Date.now(), patch: { chain: !state.chain } });
      savePrefs();
    });
    reloadToggle.addEventListener('click', function () {
      if (window.__panel) window.__panel.resumeAfterReload = !window.__panel.resumeAfterReload;
      savePrefs();
      render();
    });
    chimeToggle.addEventListener('click', function () {
      rareChimePref = !rareChimePref;
      if (window.__panel) window.__panel.rareChime = rareChimePref;
      savePrefs();
      if (rareChimePref) {
        unlockAudio();
        playRareChime({ rarity: 'Legendary' });
      }
      render();
    });
    ver.addEventListener('click', function () {
      var api = fish();
      if (!BASE && updateInfo && isNewerVer(updateInfo.tag, (api && api.version) || '')) {
        window.open(updateInfo.url || UPDATE_DOWNLOAD_URL, '_blank', 'noopener');
      }
    });
    ver.addEventListener('keydown', function (e) {
      var api = fish();
      if ((e.key === 'Enter' || e.key === ' ') && !BASE && updateInfo && isNewerVer(updateInfo.tag, (api && api.version) || '')) {
        e.preventDefault();
        window.open(updateInfo.url || UPDATE_DOWNLOAD_URL, '_blank', 'noopener');
      }
    });
    captureRow.addEventListener('click', function () {
      var next = !overnightPref;
      // The inlined userscript was not served by fishserve, so it has no origin to fetch from.
      // Ask on the first click whatever the switch currently says; a cancelled/malformed answer
      // leaves local capture off so both CSV streaming and snapshots stay cleanly disabled.
      if (!captureServer()) next = !!askCaptureAddress();
      overnightPref = next;
      captureClearBackoff();
      syncCaptureUrl();
      savePrefs();
      if (next) armOvernight(); else disarmOvernight();
      render();
    });
    // An amber line is the one place that knows the address is the problem; clicking it asks for a
    // corrected origin without needing to turn the capture off first (or hand-edit the stored pref).
    // A healthy green line opens the local fishserve dashboard in a new tab.
    captureLine.addEventListener('click', function () {
      if (captureEditReady) editCaptureAddress();
      else if (captureDashReady && captureServer()) window.open(captureServer() + '/dashboard', '_blank', 'noopener');
    });
    captureLine.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (captureEditReady) {
        e.preventDefault();
        editCaptureAddress();
      } else if (captureDashReady && captureServer()) {
        e.preventDefault();
        window.open(captureServer() + '/dashboard', '_blank', 'noopener');
      }
    });
    profSel.addEventListener('change', function () {
      if (!switchProfile(profSel.value)) {
        profSel.value = profileName();
        render();
      }
    });
    profAdd.addEventListener('click', function () {
      if (activePhase()) { banner = 'stop the session before switching profiles'; render(); return; }
      var name = prompt('New profile name (its own catch history and daily budget)', 'alt');
      if (!name) return;
      switchProfile(name);
    });
    profReset.addEventListener('click', function () {
      var f = fish();
      if (!f || !f.logReset) return;
      var name = f.logProfile();
      if (!window.confirm('Clear the catch history for profile "' + name + '"? This cannot be undone.')) return;
      f.logReset();
      banner = 'catch history cleared for ' + name;
      renderLog();
      render();
    });
    logTrophiesBtn.addEventListener('click', function () { openTrophyPop('all'); });
    logCsvBtn.addEventListener('click', downloadLedgerCsv);
    logToggle.addEventListener('click', function () {
      logScope = logScope === 'today' ? 'all' : 'today';
      renderLog();
    });
    tierCells.forEach(function (cell) {
      if (cell.name !== 'Legendary' && cell.name !== 'Secret') return;
      var box = cell.num.parentElement;
      if (!box) return;
      box.classList.add('clickable');
      box.setAttribute('role', 'button');
      box.tabIndex = 0;
      box.addEventListener('click', function () { openTrophyPop(cell.name); });
      box.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openTrophyPop(cell.name);
      });
    });
    logMeta.classList.add('clickable');
    logMeta.setAttribute('role', 'button');
    logMeta.tabIndex = 0;
    logMeta.addEventListener('click', function () { openTrophyPop('variant'); });
    logMeta.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openTrophyPop('variant');
    });
    function closePopWithFocus() {
      closeTrophyPop();
      try { if (ui.logTrophiesBtn) ui.logTrophiesBtn.focus(); } catch (e) {}
    }
    trophyClose.addEventListener('click', closePopWithFocus);
    trophyPop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && trophyPopOpen) {
        e.preventDefault();
        e.stopPropagation();
        closePopWithFocus();
      }
    });
    trophyClear.addEventListener('click', function () {
      if (Date.now() > clearConfirmUntil) {
        clearConfirmUntil = Date.now() + 3000;
        trophyClear.textContent = 'confirm?';
        trophyClear.classList.add('armed');
        if (clearConfirmTimer) clearTimeout(clearConfirmTimer);
        clearConfirmTimer = setTimeout(resetClearConfirm, 3000);
        return;
      }
      resetClearConfirm();
      clearTrophyCards(profileName());
      showTempBanner('cleared saved trophy cards', 'success', 3000);
    });
    head.addEventListener('pointerdown', startDrag);
    fillProfiles();

    restorePosition();
    render();
  }

  /**
   * One folded tier-2 block: a header the user can open, and the rows it owns.
   *
   * The panel used to put ten controls, a ledger and a frame report in one column, so the one
   * decision a running session asks - Start or Pause - carried the same weight as the daily cap.
   * A real <button> header (never a div, so Enter and Space work) keeps the rows in the DOM but
   * out of the glance. place() is re-run because opening one changes the card's height.
   */
  function section(title) {
    var box = el('div', 'sec');
    var toggle = el('button', 'sechead');
    var chev = el('span', 'chev', '\u25B8');
    var name = el('span', null, title);
    toggle.append(chev, name);
    toggle.setAttribute('aria-expanded', 'false');
    var rows = el('div', 'secbody hide');
    toggle.addEventListener('click', function () {
      var open = !rows.classList.toggle('hide');
      box.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      place();
    });
    box.append(toggle, rows);
    return { el: box, body: rows };
  }

  function meter(name, labelText) {
    var row = el('div', 'm');
    var label = el('span', null, labelText || name);
    var value = el('b', null, '—');
    row.append(label, value);
    ui['m' + name.charAt(0).toUpperCase() + name.slice(1)] = value;
    return row;
  }

  function stepperRow(labelText, key) {
    var row = el('div', 'row');
    var label = el('div', 'label', labelText);
    var box = el('div', 'step');
    var minus = el('button', null, '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'Decrease ' + labelText);
    var val = el('input', 'val');
    var plus = el('button', null, '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Increase ' + labelText);
    var conf = keyConf(key);
    var hints = {
      dur: 'one session length; Pause holds it without ending it',
      cool: 'rest after Stop or a finished run; a daily-cap or clock-window stop does not use it',
      cap: 'maximum fishing TIME per day, not a fish count; 24 h is allowed',
      hidden: 'stop the run after the tab stays hidden this long (off pauses without stopping)'
    };
    label.title = hints[key] || '';
    val.type = 'text';
    val.inputMode = 'text';
    val.autocomplete = 'off';
    val.spellcheck = false;
    val.title = (conf.min === 0 ? 'off' : minutesText(conf.min)) + ' – ' + minutesText(conf.max) + ' — type a value (90, 1h 30) or use the buttons';
    val.setAttribute('aria-label', labelText + ' duration');
    box.append(minus, val, plus);
    row.append(label, box);
    ui[key] = { val: val, minus: minus, plus: plus, key: key };
    bindStep(minus, plus, key, -1, 1);
    bindTyped(val, key);
    return row;
  }

  function stepper(labelText, minutes) {
    var label = el('input', 'val');
    label.type = 'text';
    label.inputMode = 'text';
    label.autocomplete = 'off';
    label.spellcheck = false;
    label.title = 'HH:MM — type a time or use the buttons';
    label.setAttribute('aria-label', 'clock window ' + labelText);
    var box = el('div', 'step');
    var minus = el('button', null, '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'Earlier clock ' + labelText);
    var plus = el('button', null, '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Later clock ' + labelText);
    box.style.flex = '1';
    box.append(minus, label, plus);
    ui['time_' + labelText] = { val: label, minus: minus, plus: plus, which: labelText, step: minutes };
    bindClock(minus, plus, labelText, minutes, label);
    return box;
  }

  /** Press-and-hold with acceleration, so 5-minute steps can still cross an hour. */
  function bindStep(minus, plus, key, dl, dr) {
    /** @type {number | null} */
    var timer = null;
    var speed = 0;
    function apply(delta) {
      var conf = keyConf(key);
      var next = clamp(state[conf.field] + delta * conf.unit, conf.min, conf.max);
      if (next === state[conf.field]) return;
      var patch = {};
      patch[conf.field] = next;
      dispatch({ type: 'config', at: Date.now(), patch: patch });
      // pointerdown prevents the default focus change, so the input can still be focused here and
      // render() would leave its stale text alone. The stepper owns this value; write it directly.
      if (ui[key] && ui[key].val) ui[key].val.value = stepperText(key, next);
      savePrefs();
    }
    function hold(delta) {
      apply(delta);
      speed = 0;
      timer = setInterval(function () {
        speed++;
        if (speed % 4 === 0) apply(delta);          // ~4x after a second of holding
      }, 60);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    [[minus, dl], [plus, dr]].forEach(function (pair) {
      var btn = pair[0], delta = pair[1];
      btn.addEventListener('pointerdown', function (e) { e.preventDefault(); hold(delta); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { btn.addEventListener(t, stop); });
    });
    // a release outside the button must stop the repeat too, or the value keeps climbing
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('pointercancel', stop, true);
  }

  /** "90", "90 min", "1h 30", "1:30" -> minutes. Null means the text is not a duration. */
  function parseMinutes(text) {
    var s = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    var m = /^(\d+)\s*(?:m|min|mins|minute|minutes)?$/.exec(s);
    if (m) return Number(m[1]);
    m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)$/.exec(s);
    if (m) return Math.round(Number(m[1]) * 60);
    m = /^(\d+)\s*h\s*(\d{1,2})?\s*(?:m|min|mins)?$/.exec(s);
    if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
    m = /^(\d+):(\d{1,2})$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    return null;
  }

  /** Typing is the shortcut the steppers never had: exact minutes, no 40 clicks to 50. */
  function bindTyped(input, key) {
    function commit() {
      var conf = keyConf(key);
      var raw = String(input.value || '').trim().toLowerCase();
      var minutes = (key === 'hidden' && (raw === 'off' || raw === 'none')) ? 0 : parseMinutes(input.value);
      if (minutes == null) {
        input.value = stepperText(key, state[conf.field]);
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
      var next = clamp(Math.round(minutes * 60000), conf.min, conf.max);
      if (next !== state[conf.field]) {
        var patch = {};
        patch[conf.field] = next;
        dispatch({ type: 'config', at: Date.now(), patch: patch });
        savePrefs();
      }
      input.value = stepperText(key, next);
      render();
    }
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); });
    // 'change' already fires on blur when the value changed. Keeping a second blur commit would
    // immediately re-parse the restored old value and clear the aria-invalid marker, so a rejected
    // entry would look like it had been accepted.
    input.addEventListener('change', commit);
  }

  // Ranges are for people who want to leave it fishing overnight: a 12 h session and a
  // 24 h daily cap are reachable, and the cooldown can go down to one minute. keyConf is the
  // single source of those bounds: the steppers and the typed inputs both read it.
  function keyConf(key) {
    if (key === 'dur') return { field: 'durationMs', min: 5 * 60000, max: 720 * 60000, unit: 5 * 60000 };
    if (key === 'cool') return { field: 'cooldownMs', min: 1 * 60000, max: 120 * 60000, unit: 1 * 60000 };
    if (key === 'hidden') return { field: 'hiddenStopMs', min: 0, max: 60 * 60000, unit: 1 * 60000 };
    return { field: 'dailyCapMs', min: 30 * 60000, max: 1440 * 60000, unit: 60 * 60000 };
  }

  function stepperText(key, ms) {
    return (key === 'hidden' && ms === 0) ? 'off' : minutesText(ms);
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function parseClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : 0;
  }
  /** Strict version for a typed clock value: a typo must not silently become midnight. */
  function parseClockInput(text) {
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return clockText(h * 60 + min);
  }
  function clockText(minutesOfDay) {
    var m = ((minutesOfDay % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function bindClock(minus, plus, which, stepMinutes, input) {
    function key() { return which === 'from' ? 'start' : 'stop'; }
    function apply(next) {
      if (next === state.window[key()]) return;
      var patch = { window: { on: state.window.on, start: state.window.start, stop: state.window.stop } };
      patch.window[key()] = next;
      dispatch({ type: 'config', at: Date.now(), patch: patch });
      savePrefs();
      input.value = next;   // same focus issue as the minute steppers
    }
    function nudge(delta) {
      var next = clockText(parseClock(state.window[key()]) + delta * stepMinutes);
      apply(next);
    }
    minus.addEventListener('click', function () { nudge(-1); });
    plus.addEventListener('click', function () { nudge(1); });
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('change', commit);
    input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); });
    function commit() {
      var next = parseClockInput(input.value);
      if (!next) { input.value = state.window[key()]; input.setAttribute('aria-invalid', 'true'); return; }
      input.removeAttribute('aria-invalid');
      apply(next);
      input.value = state.window[key()];
    }
  }

  /* ------------------------------------------------------------ render ---- */

  function minutesText(ms) {
    var total = Math.max(0, Math.round(ms / 60000));
    if (total >= 60) return Math.floor(total / 60) + 'h ' + String(total % 60).padStart(2, '0');
    return total + ' min';
  }

  /** True while the user is editing this field; a tick must not overwrite a half-typed value. */
  function focused(node) {
    try { return !!root && root.activeElement === node; } catch (e) { return false; }
  }

  /**
   * The UNK cell's tooltip. The raw unknown map is cumulative, so a name the catalogue has since
   * learned keeps its old count; the worklist is what makes today's gap legible - normally one
   * open name behind every historical one.
   */
  function unknownTitle(w) {
    if (!w || !w.names) return 'caught and logged, but the card printed no rarity and the species is not in the built-in catalogue';
    var open = w.open || [];
    var rest = w.names - open.length;
    if (!open.length) return 'no open gaps - all ' + w.names + ' historical unknown names are resolved, fragments or non-fish';
    if (open.length > 1) {
      var catches = open.reduce(function (sum, e) { return sum + e.n; }, 0);
      return open.length + ' open gaps · ' + catches + ' catches · ' + rest + ' of ' + w.names +
        ' historical names are resolved, fragments or non-fish';
    }
    var top = open[0];
    var when = top.last ? new Date(top.last).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
    return '1 open gap · ' + top.name + ' (' + top.n + ' catches' + (when ? ', last ' + when : '') + ') · ' +
      rest + ' of ' + w.names + ' historical names are resolved, fragments or non-fish';
  }

  /**
   * The ledger is the panel's only real history: fill the rarity strip and the last-catch line.
   * Everything here is a read - a broken ledger must never make the panel throw.
   */
  function renderLog() {
    if (!ui.tierCells) return;
    /** @type {any} */
    var book = null;
    try { book = (fish() && fish().log) ? fish().log() : null; } catch (e) { book = null; }
    var today = (book && book.today) || { n: 0, shiny: 0, golden: 0, byRarity: [] };
    var rows = (logScope === 'today' ? today.byRarity : (book && book.byRarity)) || [];
    /** @type {Record<string, number>} */
    var byTier = {};
    rows.forEach(function (r) { byTier[r.rarity] = r.n || 0; });
    ui.tierCells.forEach(function (cell) {
      var n = byTier[cell.name] || 0;
      cell.num.textContent = String(n);
      cell.num.style.opacity = n ? '1' : '.78';
      // UNK only takes space when it has something to say
      if (cell.cell) cell.cell.style.display = n ? '' : 'none';
      if ((cell.name === 'Legendary' || cell.name === 'Secret') && cell.num.parentElement) {
        var saved = cell.name === 'Legendary' ? trophyCounts.Legendary : trophyCounts.Secret;
        cell.num.parentElement.title = cell.name + ' caught · click to view saved cards (24h: ' + saved + ')';
      }
    });
    if (ui.unknownCell) ui.unknownCell.title = unknownTitle(book && book.worklist);
    if (ui.logTrophiesBtn) {
      ui.logTrophiesBtn.textContent = trophyCounts.total ? 'Trophies (' + trophyCounts.total + ')' : 'Trophies';
      ui.logTrophiesBtn.style.color = trophyCounts.total ? '#5ad18b' : '#b8c2cc';
    }
    if (ui.logToggle) {
      ui.logToggle.textContent = logScope === 'today' ? 'today' : 'all';
      ui.logToggle.style.color = logScope === 'today' ? '#5ad18b' : '#9aa4ae';
      ui.logToggle.setAttribute('aria-pressed', logScope === 'today' ? 'true' : 'false');
      ui.logToggle.title = logScope === 'today'
        ? 'showing today — click for all-time'
        : 'showing all-time — click for today';
    }
    var daysKept = (book && book.days) || 0;
    var dayWord = daysKept === 1 ? ' day kept' : ' days kept';
    if (ui.logTotal) {
      ui.logTotal.textContent = 'all ' + (book && book.total || 0) + ' · today ' + (today.n || 0) +
        ' · shiny ' + (book && book.shiny || 0) + ' · golden ' + (book && book.golden || 0);
      ui.logTotal.title = 'all-time totals and today for this profile';
    }
    if (ui.logMeta) {
      ui.logMeta.textContent = 'today ' + (today.shiny || 0) + ' shiny · ' + (today.golden || 0) + ' golden · ' +
        daysKept + dayWord +
        (trophyCounts.total ? ' · ' + trophyCounts.total + (trophyCounts.total === 1 ? ' card' : ' cards') : '');
      ui.logMeta.title = 'profile ' + profileName() + ' · history is stored in this browser · click to view Shiny/Golden trophy cards (24h)';
    }
    var last = book && book.last;
    if (!last) {
      ui.lastCatch.textContent = 'no catches yet';
      ui.lastCatch.title = 'the ledger fills as the bot lands fish';
      return;
    }
    var bits = [last.species];
    if (last.weight) bits.push(last.weight);
    if (last.rarity && last.rarity !== 'Unknown') bits.push((last.derived ? '~' : '') + last.rarity);
    else if (last.rarity === 'Unknown') bits.push('rarity unknown');
    if (last.at) bits.push(new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    ui.lastCatch.textContent = bits.join(' · ');
    ui.lastCatch.title = last.rarity === 'Unknown'
      ? 'caught and logged, but the card printed no rarity and the species is not in the built-in catalogue'
      : 'last catch' + (last.derived ? ' — rarity from the built-in catalogue, the card printed none' : '');
  }

  /**
   * The same numbers as __fish.perf(), where a screenshot can read them: fps and the frame
   * percentiles, then each detector's share of wall time in ms per second. The share is the
   * currency that decides a fix - 8 ms/s is noise, 800 ms/s is the frame.
   */
  function renderPerf() {
    if (!ui.perfLine) return;
    if (ui.accLine) {
      /** @type {any} */
      var a = null;
      try { a = (fish() && fish().accuracy) ? fish().accuracy() : null; } catch (e) { a = null; }
      if (!a || (!a.attempts && !a.presses)) {
        ui.accLine.textContent = 'No attempts yet';
        if (ui.accMore) ui.accMore.textContent = '';
      } else {
        var n = (a.caught || 0) + (a.lost || 0);
        var rate = a.catchRate == null ? '' : ' · ' + Math.round(a.catchRate * 100) + '%';
        var narrow = (a.byWidth || []).filter(function (w) { return w.band === 'narrow'; })[0];
        var pv = a.pressVerdicts && a.pressVerdicts.observed;
        var sent = pv ? pv.total : (a.pressAccepted || 0) + (a.pressRejected || 0);
        var hit = pv ? pv.accepted : (a.pressAccepted || 0);
        var inferred = a.pressVerdicts ? a.pressVerdicts.assumed.total + a.pressVerdicts.timing.total : 0;
        ui.accLine.textContent = 'Caught ' + (a.caught || 0) + ' of ' + n + rate;
        // Two counts, both said as "x of y" so neither needs a legend: which dials it missed,
        // and whether the presses landed.
        var detail = [];
        if (narrow) detail.push('rare dials ' + narrow.caught + ' of ' + narrow.attempts);
        if (sent) detail.push(hit + ' of ' + sent + ' presses landed');
        if (ui.accMore) ui.accMore.textContent = detail.join(' · ');
        ui.accLine.title = 'fish landed out of fish attempted; the rate is catches over attempts';
        if (ui.accMore) {
          ui.accMore.title = 'rare dials are the narrow ones the rare fish paint; "presses landed" counts only the presses the game answered with a new triangle (' + inferred + ' inferred verdicts excluded)';
        }
      }
    }
    /** @type {any} */
    var p = null;
    try { p = (fish() && fish().perf) ? fish().perf() : null; } catch (e) { p = null; }
    if (!p || !p.frames) { ui.perfLine.textContent = 'No frames measured yet'; ui.perfMore.textContent = ''; ui.perfRate.textContent = ''; return; }
    ui.perfLine.textContent = p.fps + ' fps · ' + p.p50 + ' ms typical · ' + p.p95 + ' ms slow · ' + p.worst + ' ms worst';
    var r = p.rates || {};
    // Whole ms only: the tenths pushed this line to 256 px in a 244 px card and clipped the last
    // field on a live run, and at these magnitudes a tenth was never the deciding digit.
    function share(key) { return (r[key] && r[key].msPerSec != null) ? Math.round(r[key].msPerSec) : '–'; }
    ui.perfMore.textContent = 'per second: scan ' + share('snapshot') + ' · bubble ' + share('findBubble');
    ui.perfRate.textContent = 'dial ' + share('lockDial') + ' · card ' + share('findCatch') + ' ms';
  }

  /** The chair warning is only for a seat problem; an engaged focus hold owns the banner. */
  function seatNoteFor(status, phase, focusOn) {
    if (status && status.needsSeat && !focusOn && (phase === 'running' || phase === 'paused')) {
      return 'clock paused — nothing to bite: sit on a chair by the water';
    }
    return '';
  }

  /* The phase chip says "paused"; it never said why or since when, and that answer lived in
   * __panel.state. This is the same fact, in the place the player is already looking. */
  /** @satisfies {Record<PauseReason, string>} */
  var PAUSE_WHY = {
    user: 'you paused it',
    hidden: 'the tab was hidden',
    seat: 'the character was standing',
    focus: 'a focus session is running',
    'no-catch': 'nothing bit for 10 minutes',
    'cast-stall': 'the cast never landed',
    'player-block': 'a nearby player blocked the spot',
    'profile-open': 'a player profile was open',
    'result-missing': 'the game is waiting for a fishing result'
  };

  function clockTime(at) {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** '' unless the run is paused: the reason in plain words plus the clock time it happened. */
  function pauseNoteFor(s, now) {
    if (!s || s.phase !== 'paused' || !s.pauseReason) return '';
    now = now || Date.now();
    var line = 'paused';
    if (s.pausedAt) {
      line += ' ' + clockTime(s.pausedAt);
      var age = now - s.pausedAt;
      if (age >= 90 * 60 * 1000) line += ' (' + Math.round(age / 3600000) + 'h ago)';
      else if (age >= 90 * 1000) line += ' (' + Math.round(age / 60000) + ' min ago)';
    }
    line += ' · ' + (PAUSE_WHY[s.pauseReason] || s.pauseReason);
    if (s.pauseReason === 'user') line += ' · press Resume';
    else if (s.retryAt) line += ' · retrying ' + clockTime(s.retryAt);
    return line;
  }

  function render() {
    if (!ui.card) return;
    var phase = state.phase;
    /** @type {FishStatus | null} */
    var status = preStatus;
    if (!status) {
      try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}
    }
    // A stalled core still looks like "running" from the outside - the phase never changed, the
    // frames did. Say what is actually happening, in the place the phase is printed.
    var stalled = !!(status && status.running && status.stalled);
    // The core's own verdict, and only a high-severity one: the chip is the phase label the owner
    // reads at a glance, so a warning would be noise next to it. A named failure ("detector-blind",
    // "snapshot-fallback") is worth more than "running" when the bot has silently stopped working.
    /** @type {any} */
    var doc = null;
    try { doc = (fish() && fish().doctor) ? fish().doctor() : null; } catch (e) { doc = null; }
    var alarm = !!(doc && doc.severity === 'high' && !stalled);
    ui.chip.textContent = stalled ? 'stalled' : (alarm ? doc.verdict : phase);
    ui.chip.title = alarm ? doc.action : '';
    ui.dot.className = 'dot ' + (stalled ? 'stalled' : phase);
    var flow = state.mode === 'flow';
    if (ui.modeToggle) {
      ui.modeToggle.textContent = flow ? 'Flow' : 'Timed';
      ui.modeToggle.style.color = flow ? '#5ad18b' : '#9aa4ae';
    }
    if (ui.timedWrap) ui.timedWrap.style.display = flow ? 'none' : '';
    ui.winToggle.textContent = state.window.on ? 'on' : 'off';
    ui.winToggle.style.color = state.window.on ? '#5ad18b' : '#9aa4ae';
    ui.winToggle.setAttribute('aria-pressed', state.window.on ? 'true' : 'false');
    ui.timeRow.style.display = state.window.on ? '' : 'none';
    renderUpsellToggle();
    renderFocusToggle();
    renderCapture();

    if (!focused(ui.dur.val)) ui.dur.val.value = minutesText(state.durationMs);
    if (!focused(ui.cool.val)) ui.cool.val.value = minutesText(state.cooldownMs);
    if (!focused(ui.cap.val)) ui.cap.val.value = minutesText(state.dailyCapMs);
    if (!focused(ui.hidden.val)) ui.hidden.val.value = stepperText('hidden', state.hiddenStopMs);
    ui.chainToggle.textContent = state.chain ? 'on' : 'off';
    ui.chainToggle.style.color = state.chain ? '#5ad18b' : '#9aa4ae';
    ui.chainToggle.setAttribute('aria-pressed', state.chain ? 'true' : 'false');
    if (ui.reloadToggle) {
      var reloadOn = !!(window.__panel && window.__panel.resumeAfterReload);
      ui.reloadToggle.textContent = reloadOn ? 'on' : 'off';
      ui.reloadToggle.style.color = reloadOn ? '#5ad18b' : '#9aa4ae';
      ui.reloadToggle.setAttribute('aria-pressed', reloadOn ? 'true' : 'false');
    }
    if (ui.chimeToggle) {
      ui.chimeToggle.textContent = rareChimePref ? 'on' : 'off';
      ui.chimeToggle.style.color = rareChimePref ? '#5ad18b' : '#9aa4ae';
      ui.chimeToggle.setAttribute('aria-pressed', rareChimePref ? 'true' : 'false');
    }
    renderVerBadge();
    if (!focused(ui.time_from.val)) ui.time_from.val.value = state.window.start;
    if (!focused(ui.time_to.val)) ui.time_to.val.value = state.window.stop;

    /** @type {Record<string, any>} */
    var stats = (status && status.stats) || {};

    // A long-blind detector is not a slow bite: after the doctor's 45 s warning the session pauses
    // as cast-stall and retries, so the age of the silence has to outlive those pauses. The note
    // stays in the banner chain below, ahead of the cast-stall retry and any transient log-offline
    // line, so it remains visible until the detector sees something again.
    /** @type {number | null} */
    var blindMs = null;
    try {
      if (window.AutoFishSession && window.AutoFishSession.blindWarning) {
        blindMs = window.AutoFishSession.blindWarning(blindFacts(status));
      }
    } catch (e) {}
    var blindNote = '';
    if (blindMs != null) {
      blindNote = 'detector blind for ' + Math.floor(blindMs / 60000) + ' min — reload the game tab, then sit on a chair by the water';
    }

    if (flow) {
      if (phase === 'running') ui.mLeft.textContent = minutesText(state.fishingMs) + ' flow';
      else if (phase === 'paused') ui.mLeft.textContent = minutesText(state.fishingMs) + ' paused';
      else ui.mLeft.textContent = 'flow';
    } else {
      if (phase === 'running') ui.mLeft.textContent = minutesText(state.durationMs - state.fishingMs) + ' left';
      else if (phase === 'paused') ui.mLeft.textContent = minutesText(state.durationMs - state.fishingMs) + ' paused';
      else if (phase === 'cooldown' && state.cooldownUntil) ui.mLeft.textContent = minutesText(state.cooldownUntil - Date.now()) + ' cooling';
      else if (phase === 'waiting') ui.mLeft.textContent = 'at ' + state.window.start;
      else ui.mLeft.textContent = minutesText(state.durationMs);
    }
    ui.mCatches.textContent = String((stats.cards || state.catchCount || 0));
    ui.mPresses.textContent = String(stats.presses || 0);
    ui.mToday.textContent = flow
      ? minutesText((state.todayMs || 0) + todaySessionMs())
      : minutesText((state.todayMs || 0) + todaySessionMs()) + ' / ' + minutesText(state.dailyCapMs);
    renderLog();
    renderPerf();

    var resultMissing = !!(status && status.resultMissing) || state.pauseReason === 'result-missing';
    var primary = ui.primary;
    var secondary = ui.secondary;
    secondary.className = 'secondary hide';
    secondary.disabled = false;
    primary.disabled = false;
    primary.className = 'primary';
    primary.title = '';
    secondary.title = '';
    if (phase === 'running') {
      primary.textContent = 'Pause';
      primary.title = 'hold this session without ending it' + (flow ? '' : ' or starting the cooldown');
      secondary.textContent = 'Stop';
      secondary.className = 'secondary';
      secondary.title = flow ? 'end the session' : 'end the session and start the cooldown';
    } else if (phase === 'paused') {
      secondary.textContent = 'Stop';
      secondary.className = 'secondary';
      secondary.title = flow ? 'end the session' : 'end the session and start the cooldown';
      if (resultMissing) {
        primary.textContent = 'Reload game';
        primary.title = 'reload the game tab to clear its waiting-for-result lock';
      } else {
        primary.textContent = 'Resume';
        primary.title = 'continue the same session, with its remaining time';
      }
    } else if (phase === 'waiting') {
      primary.textContent = 'Stop';
      primary.className = 'primary stop';
      primary.title = 'stop waiting for the clock window';
    } else if (phase === 'cooldown') {
      var left = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
      primary.textContent = left > 0 ? 'Cooling down ' + minutesText(left) : 'Start';
      primary.disabled = left > 0;
      if (left > 0) {
        primary.title = 'the cooldown is self-imposed; use Start now to skip it';
        secondary.textContent = 'Start now';
        secondary.className = 'secondary';
        secondary.title = 'skip the rest of the cooldown and start fishing';
      }
    } else {
      primary.textContent = 'Start';
      primary.title = 'start a session';
    }

    // The single most confusing stop: the core is running but the game will not bite because the
    // character is standing up. Fishing in lofi.town is seat-based (the CAST! prompt is only emitted
    // from the sit-down path), so nothing the bot can click will start a cast - only sitting down
    // again will. Say that plainly, ahead of the log-offline chatter.
    // A stall outranks everything: the session is not running however the phase reads, and the
    // clock has stopped, so the player needs to know before the budget does.
    var stallNote = stalled ? 'loop stalled — the game stopped giving the bot frames; the clock is paused' : '';
    // A missing result is not a seat or cast problem: the game already disabled input while it
    // waits for a result that never arrived. Say what to do instead of letting the seat probe run.
    var resultNote = '';
    if (resultMissing) {
      resultNote = 'no fishing result — the game is input-locked; reload the game tab, then start again';
    }
    var seatNote = seatNoteFor(status, phase, focusOn);
    // A focus session outranks the log-offline chatter: the run will look alive while the game
    // refuses every cast, which is the most expensive way to spend a budget.
    var focus = inFocusSession();
    // The bot's own focus hold outranks the notice: this one is a decision, not a warning.
    var focusModeNote = focusOn ? 'paused for this focus session (toggle off to resume)' : '';
    var focusNote = focus ? FOCUS_NOTE : '';
    // A tap landing where no dial follows means a nearby player's name tag or an open
    // profile is swallowing the cast: pause the clock and say to move spots. A cast that
    // never lands (no prompt, no dial 90 s after a catch) gets its own retry line.
    var playerNote = '';
    if ((status && (status.playerBlocked || status.profileOpen)) || state.pauseReason === 'player-block' || state.pauseReason === 'profile-open') {
      if (phase === 'running' || phase === 'paused') playerNote = 'player in the way — move spots or close the profile';
    }
    var castNote = '';
    if (state.pauseReason === 'cast-stall' && (phase === 'running' || phase === 'paused')) {
      castNote = 'cast stalled — retrying, check for a profile popup';
    }
    var pauseNote = pauseNoteFor(state);
    // A stop is the thing the player most needs to understand, and it used to be invisible: the
    // phase went back to idle and nothing said whether the tab, the clock or the cap ended it.
    var stopNote = '';
    if (!stallNote && !seatNote && !focusNote && !banner && (phase === 'idle' || phase === 'cooldown') && state.stopReason) {
      stopNote = 'last stop: ' + state.stopReason;
      if (phase === 'cooldown' && state.cooldownUntil) {
        stopNote += ' · start after ' + new Date(state.cooldownUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (state.window.on) {
        stopNote += ' · window ' + state.window.start + '–' + state.window.stop;
      }
      if (state.chain) stopNote += ' · chaining on';
    }
    var note = stallNote || resultNote || seatNote || focusModeNote || focusNote || playerNote || blindNote || castNote || pauseNote || banner || stopNote;
    ui.banner.textContent = note;
    if (stallNote) ui.banner.className = 'banner stall';
    else if (resultNote) ui.banner.className = 'banner result';
    else if (seatNote) ui.banner.className = 'banner seat';
    else if (playerNote) ui.banner.className = 'banner seat';
    else if (blindNote) ui.banner.className = 'banner blind';
    else if ((focus || focusOn) && !banner) ui.banner.className = 'banner focus';
    else if ((pauseNote || stopNote) && !banner) ui.banner.className = 'banner info';
    else if (banner && bannerTone === 'success') ui.banner.className = 'banner success';
    else ui.banner.className = 'banner';
    ui.banner.style.display = note ? '' : 'none';

    // Observable from the outside even though the shadow root is closed.
    if (host) {
      host.dataset.phase = phase;
      host.dataset.catches = String(stats.cards || state.catchCount || 0);
      if (status && status.needsSeat) host.dataset.needsSeat = '1'; else delete host.dataset.needsSeat;
      if (resultMissing) host.dataset.resultMissing = '1'; else delete host.dataset.resultMissing;
      if (state.pauseReason) host.dataset.pauseReason = state.pauseReason; else delete host.dataset.pauseReason;
      if (focus) host.dataset.focus = '1'; else delete host.dataset.focus;
      if (focusOn) host.dataset.focusMode = '1'; else delete host.dataset.focusMode;
      if (stalled) host.dataset.stalled = '1'; else delete host.dataset.stalled;
      if (blindMs != null) host.dataset.blind = '1'; else delete host.dataset.blind;
      if ((status && status.playerBlocked) || state.pauseReason === 'player-block') host.dataset.playerBlocked = '1'; else delete host.dataset.playerBlocked;
      if ((status && status.profileOpen) || state.pauseReason === 'profile-open') host.dataset.profileOpen = '1'; else delete host.dataset.profileOpen;
    }

    place();
  }

  /* ------------------------------------------------------------ layout ---- */

  function zoneRect() {
    var f = fish();
    var L = window.AutoFishLayout;
    if (!f || !f.zones || !L) return null;
    try {
      var z = f.zones();
      return L.unionRect([z.bubble, z.dial, z.card, z.hintZone]);
    } catch (e) { return null; }
  }

  function place() {
    if (!host || dragging) return;
    var L = window.AutoFishLayout;
    if (!L) return;
    var size = collapsed ? { w: 48, h: 48 } : { w: 264, h: ui.card.getBoundingClientRect().height || 300 };
    var zone = zoneRect();
    var exclude = zone ? L.inflate(zone, 12) : null;
    // If the current position still clears the fishing UI, stay there. Recomputing the preferred
    // corner every 250 ms made the panel jump left/right every time a catch card appeared.
    if (placed) {
      var current = host.getBoundingClientRect();
      var sameSize = Math.abs(current.width - size.w) < 1 && Math.abs(current.height - size.h) < 1;
      var inside = current.left >= 0 && current.top >= 0 &&
        current.right <= window.innerWidth && current.bottom <= window.innerHeight;
      if (sameSize && inside && !L.intersects({ x: current.left, y: current.top, w: current.width, h: current.height }, exclude)) return;
    }
    var res = L.place({
      panel: size,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      exclude: exclude,
      topInset: 72,
      preferred: dragged || null
    });
    if (res === 'pill') {
      if (!collapsed) {
        if (!userExpanded) { setCollapsed(true); return; }
        // No room that clears the game, but the owner opened this on purpose: take the top-left
        // corner below the HUD strip rather than bounce back to a pill.
        res = { x: 12, y: 84, w: size.w, h: size.h };
      } else {
        res = { x: window.innerWidth - 60, y: 12, w: 48, h: 48 };
      }
    }
    host.style.left = Math.round(res.x) + 'px';
    host.style.top = Math.round(res.y) + 'px';
    placed = true;
  }

  function restorePosition() {
    var pos = readJSON(POS_KEY, null);
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') dragged = { x: pos.x, y: pos.y };
    if (pos && pos.collapsed) setCollapsed(true);
  }

  function setCollapsed(next) {
    collapsed = next;
    ui.card.classList.toggle('hide', collapsed);
    ui.pill.classList.toggle('hide', !collapsed);
    var pos = readJSON(POS_KEY, {}) || {};
    pos.collapsed = collapsed;
    writeJSON(POS_KEY, pos);
    place();
  }

  function startDrag(e) {
    if (!host || (e.button != null && e.button !== 0)) return;
    // The head is the drag handle AND the home of the collapse button. setPointerCapture(host)
    // retargets the later pointerup to the host, so the browser computes the click against the host
    // and the button's own click handler never runs - a dead button that looks alive. Leave
    // interactive children alone: no drag, no capture, and their click lands normally.
    if (e.target && e.target.closest && e.target.closest('button')) return;
    var r = host.getBoundingClientRect();
    dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { host.setPointerCapture(e.pointerId); } catch (ignored) {}
    // Capture phase on purpose: the host swallows pointerup in the bubble phase so the game never
    // sees it, and a bubble-phase window listener here would never run — the drag would follow the
    // pointer forever. Capture runs before the host handler.
    window.addEventListener('pointermove', onDrag, true);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
    window.addEventListener('blur', endDrag, true);
  }

  function onDrag(e) {
    if (!dragging || !host) return;
    var x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragging.dx));
    var y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragging.dy));
    dragged = { x: x, y: y };
    host.style.left = Math.round(x) + 'px';
    host.style.top = Math.round(y) + 'px';
  }

  function endDrag() {
    window.removeEventListener('pointermove', onDrag, true);
    window.removeEventListener('pointerup', endDrag, true);
    window.removeEventListener('pointercancel', endDrag, true);
    window.removeEventListener('blur', endDrag, true);
    if (dragging && dragged) writeJSON(POS_KEY, { x: Math.round(dragged.x), y: Math.round(dragged.y), collapsed: collapsed });
    dragging = null;
    place();
  }

  /* -------------------------------------------------------------- loop ---- */

  function tick() {
    lastTickAt = Date.now();
    try { tickOnce(); } catch (e) { noteTickError('tick', e); }
  }

  /**
   * A panel that stops ticking looks exactly like a healthy run with a frozen session clock: the
   * phase stays `running` and nothing restarts the core. Measured live 2026-11-24: the core had
   * stopped while the panel still read RUNNING. Neither the silent throw nor the zombie state was
   * visible anywhere, so both are now recorded and the banner says so.
   */
  function noteTickError(where, e) {
    tickErrors++;
    lastTickError = where + ': ' + ((e && e.message) || e);
    if (banner.indexOf('panel error') === -1) banner = 'panel error — ' + lastTickError;
    try { render(); } catch (ignored) {}
  }

  /** What the row should carry when the guard gives up: enough to diagnose the night without the tab. */
  function guardDiag() {
    /** @type {any} */
    var doctor = null;
    try { doctor = fish() && fish().doctor ? fish().doctor().verdict : null; } catch (e) {}
    return {
      revives: zombieRevives,
      windowRevives: reviveTimes.length,
      tickErrors: tickErrors,
      lastTickError: lastTickError,
      doctor: doctor,
      tickAgoMs: lastTickAt ? Date.now() - lastTickAt : null
    };
  }

  /** One line, no commas: fishserve writes it as the sessions.csv note column. */
  function guardNote(d) {
    if (!d) return '';
    var bits = ['guard revives=' + d.revives, 'windowRevives=' + d.windowRevives, 'tickErrors=' + d.tickErrors];
    if (d.lastTickError) bits.push('lastError=' + String(d.lastTickError).slice(0, 90));
    if (d.doctor) bits.push('doctor=' + d.doctor);
    if (d.tickAgoMs != null) bits.push('tickAgoMs=' + d.tickAgoMs);
    return bits.join(' ').slice(0, 200);
  }

  /** The inputs the banner and the export share, so a new signal cannot reach only one of them. */
  function blindFacts(status) {
    return {
      phase: state.phase,
      pauseReason: state.pauseReason,
      running: !!(status && status.running),
      stalled: !!(status && status.stalled),
      visible: document.visibilityState === 'visible',
      sinceBubbleMs: status ? status.sinceBubbleMs : null,
      sinceDialMs: status ? status.sinceDialMs : null,
      startedAt: state.startedAt,
      runAgeMs: status ? status.runAgeMs : null,
      pauseMs: state.blindPauseMs || 0,
      now: Date.now()
    };
  }

  /**
   * The guard/blind snapshot for __fish.exportRun(). The banner uses blindWarning(); the export
   * also carries the raw silence below three minutes, because a five-minute sampler can otherwise
   * miss a warning that rose and fell between posts.
   */
  function blindDiag() {
    if (!state) return { phase: null, pauseReason: null, silenceMs: null, warning: false };
    /** @type {FishStatus | null} */
    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}
    var facts = blindFacts(status);
    /** @type {any} */
    var out = Object.assign({}, facts, { silenceMs: null, warning: false });
    try {
      if (window.AutoFishSession) {
        if (window.AutoFishSession.blindSilence) out.silenceMs = window.AutoFishSession.blindSilence(facts);
        if (window.AutoFishSession.blindWarning) out.warning = window.AutoFishSession.blindWarning(facts) != null;
      }
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    return out;
  }

  /** What exportRun() adds when the panel is mounted; null fields when it is not. */
  function exportDiag() {
    return { guard: guardDiag(), blind: blindDiag() };
  }

  /**
   * Runs on a timer that is not the tick loop. Two facts are enough: the phase says running while
   * the core reports stopped (revive it), or no tick has been entered for a full guard interval
   * (record it). The predicate lives in session.js so the zombie case has a unit test.
   */
  function health() {
    try {
      if (!state) return;
      // A hidden tab throttles intervals, so silence there is the browser, not a broken panel.
      var silent = state.phase === 'running' && lastTickAt &&
        Date.now() - lastTickAt > TICK_GUARD_MS &&
        document.visibilityState === 'visible';
      if (silent) {
        noteTickError('watchdog', new Error('no tick for ' + (Date.now() - lastTickAt) + ' ms'));
        tick();                       // re-enter it: reporting a dead loop is not enough
      }
      /** @type {FishStatus | null} */
      var status = null;
      try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}
      if (!window.AutoFishSession) return;
      if (window.AutoFishSession.coreGuard(state, status) === 'revive') {
        // A core that keeps dying is not a liveness problem any more: after three restarts in ten
        // minutes the game is the problem, and an honest stop beats restarting for hours.
        var gate = window.AutoFishSession.reviveGate(reviveTimes, Date.now());
        reviveTimes = gate.times;
        if (!gate.allow) {
          banner = 'the fishing core kept stopping — session stopped';
          dispatch({ type: 'stop', at: Date.now(), reason: 'core-crash', diag: guardDiag() });
          return;
        }
        banner = 'the fishing core had stopped — restarted';
        RUNNERS.startCore({ maxMinutes: state.mode === 'flow' ? 0 : Math.ceil(state.durationMs / 60000) + 2 });
        zombieRevives++;
        try { render(); } catch (e) {}
      }
    } catch (e) { /* a watchdog that can throw is not a watchdog */ }
  }

  /** @type {FishStatus | null} */
  var preStatus = null;
  /** Reuse a status snapshot read by tickOnce() so render() skips a duplicate poll. */
  function renderWithStatus(s) {
    preStatus = s || null;
    try { render(); } finally { preStatus = null; }
  }

  function tickOnce() {
    // A focus session ending releases a hold it started; a manual toggle is never touched here.
    try { focusTick(); } catch (e) { noteTickError('focus', e); }
    // Outside render(): a dead or failing overnight capture is retried from the heartbeat, so a
    // repaint (a toggle, a dispatch) can never start a sampler load or a POST of its own.
    try { healCapture(); } catch (e) { noteTickError('capture', e); }
    // A run that crosses midnight starts the new day at zero, the same way a reload does.
    var dayNow = dayKey();
    if (budgetDay && dayNow !== budgetDay) {
      budgetDay = dayNow;
      baseTodayMs = 0;
      state.todayMs = 0;
    }
    /** @type {FishStatus | null} */
    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}

    if (state.phase === 'idle' || state.phase === 'cooldown') {
      // keep wall clocks honest and let a cooldown end on its own
      if (state.phase === 'cooldown' && state.cooldownUntil && Date.now() >= state.cooldownUntil) {
        dispatch({ type: 'tick', at: Date.now(), visible: document.visibilityState === 'visible', catches: 0, errors: 0, todayMs: baseTodayMs, seat: false, focus: focusOn });
        banner = '';
      } else {
        renderWithStatus(status);
      }
      return;
    }

    dispatch({
      type: 'tick',
      at: Date.now(),
      visible: document.visibilityState === 'visible',
      catches: status ? status.catchCount || 0 : 0,
      errors: status && status.stats ? status.stats.errors || 0 : 0,
      todayMs: baseTodayMs,
      // the seat fact drives the reducer: unseated pauses the clock, a prompt resumes it
      seat: !!(status && status.needsSeat),
      // the game can hold itself in waiting-for-result; the reducer owns this distinct pause
      resultMissing: !!(status && status.resultMissing),
      // a stalled core - or one that has stopped altogether - is not fishing time
      stalled: !!(status && (!status.running || status.stalled)),
      // cast-stall vs no-bite split + nearby-player guard: the reducer pauses with a named
      // reason instead of burning the session as a generic no-catch
      sinceBubbleMs: status && typeof status.sinceBubbleMs === 'number' ? status.sinceBubbleMs : null,
      sinceDialMs: status && typeof status.sinceDialMs === 'number' ? status.sinceDialMs : null,
      playerBlocked: !!(status && status.playerBlocked),
      profileOpen: !!(status && status.profileOpen),
      // the focus hold: a Start pressed during a session must not fish, and a session ending
      // is what resumes. The reducer owns the clock; this fact only reports the hold's state.
      focus: focusOn
    });

    // 20 s running with zero prompts found means the detector is blind; grab one frame so the
    // shape of the real bubble can be measured rather than guessed. Once per session.
    if (!diagSent && state.phase === 'running' && status && status.stats && !status.stats.bubbles) {
      if (!diagAt) diagAt = Date.now();
      if (Date.now() - diagAt > 20000) { diagSent = true; captureDiag('no-prompt-after-20s'); }
    }

    if (Date.now() - heartbeatAt > 30000) { heartbeatAt = Date.now(); writeHeartbeat(); }
    if (Date.now() - budgetAt > 10000) { budgetAt = Date.now(); syncBudget(); }
    if (banner && state.phase === 'running' && banner.indexOf('offline') === -1) { /* keep guard text visible */ }

    maybeAutoReloadResultMissing(status);
    renderWithStatus(status);
  }

  /* ------------------------------------------------------------- mount ---- */

  async function mount() {
    try {
      await mountInner();
    } catch (e) {
      // Never fail silently: a half-built panel is worse than none, and the game keeps running.
      window.__panel = window.__panel || {};
      window.__panel.mountError = String((e && e.stack) || e);
      console.error('AutoFish: panel failed to mount —', e);
      try { if (host && host.parentNode) host.parentNode.removeChild(host); } catch (ignored) {}
    }
  }

  async function mountInner() {
    try { await deps(); } catch (e) {
      alert('AutoFish: start fishserve first (node fishserve.js), then click the bookmarklet again.');
      throw e;
    }

    var S = /** @type {AutoFishSessionApi} */ (window.AutoFishSession);
    var prefs = loadPrefs();
    // Resolved here, before loadToday(): captureServer() reads this, and the day's read-back would
    // otherwise see no address on an inlined install and stay silent on the very first mount.
    captureBase = BASE || prefs.overnightBase || '';
    // The ledger key is per profile, and the choice has to survive a reload with the history it names.
    if (prefs.profile && fish() && fish().logProfile) fish().logProfile(prefs.profile);
    var budget = loadBudget();
    var win = prefs.window || S.DEFAULTS.window;
    var flow = prefs.mode === 'flow';
    state = S.createState({
      mode: flow ? 'flow' : 'timed',
      window: { on: !!win.on, start: win.start, stop: win.stop },
      durationMs: prefs.durationMs || S.DEFAULTS.durationMs,
      cooldownMs: prefs.cooldownMs || S.DEFAULTS.cooldownMs,
      dailyCapMs: prefs.dailyCapMs || S.DEFAULTS.dailyCapMs,
      hiddenStopMs: typeof prefs.hiddenStopMs === 'number' ? prefs.hiddenStopMs : S.DEFAULTS.hiddenStopMs,
      chain: !!prefs.chain,
      todayMs: budget.ms,
      cooldownUntil: flow ? null : budget.cooldownUntil,
      phase: (!flow && budget.cooldownUntil) ? 'cooldown' : 'idle'
    });
    baseTodayMs = budget.ms;
    budgetDay = budget.day;
    window.__panel = window.__panel || {};
    window.__panel.resumeAfterReload = !!prefs.resumeAfterReload;

    await loadToday();
    state.todayMs = baseTodayMs;
    syncBudget();

    // A core already running from a previous session is not ours to guess about.
    /** @type {FishStatus | null} */
    var before = null;
    try { before = fish().status ? fish().status() : null; } catch (e) {}
    if (before && before.running) { try { fish().stop(); } catch (e) {} banner = 'stopped a session that was already running'; }

    build();
    if (prefs.hideUpsell) setUpsellHidden(true); // cosmetic: see setUpsellHidden()
    // The setting is adopted; the hold is not. Engaging it here paused a page that has no focus
    // session and armed the prompt mask, and nothing could lift it: focusTick only auto-releases a
    // hold it saw a session drive (`focusSawSession`), which a page-load hold never is. Measured
    // live 2026-11-17 (3.9.43): title `lofi.town`, running:true, paused:true, one rect masked and
    // zero dial presses until the toggle was clicked. focusTick() engages the hold when a session
    // actually exists, which is what "pause in focus sessions" means.
    focusPref = !!prefs.focusMode;
    rareChimePref = !!prefs.rareChime;
    overnightPref = !!(prefs.localCapture || prefs.overnight || prefs.postCatches);
    syncCaptureUrl();
    captureClearBackoff();
    // The night a reload used to end: with the setting on, mount loads the sampler again. It posts
    // once immediately, so the capture line proves the path before the tab is left alone. After
    // that tick() heals it - a dead sampler or a failing post is retried on a backoff.
    if (overnightPref) armOvernight();
    mountAdoption();
    banner = checkInterrupted() || banner;
    refreshTrophyCounts();
    if (!BASE) setTimeout(function () { checkForUpdate(false); }, 1500);

    tickTimer = setInterval(tick, TICK_MS);
    guardTimer = setInterval(health, TICK_GUARD_MS);
    placeTimer = setInterval(place, 250);
    window.addEventListener('resize', place);
    hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
    document.addEventListener('visibilitychange', onVisible);

    window.__panel.mounted = true;
    window.__panel.rareChime = rareChimePref;
    window.__panel.state = function () { return state; };
    window.__panel.dispatch = dispatch;
    window.__panel.unmount = unmount;
    window.__panel.captureDiag = captureDiag;
    window.__panel.focus = inFocusSession;
    window.__panel.focusMode = focusOn;
    window.__panel.setFocusMode = setFocusMode;
    window.__panel.armOvernight = armOvernight;
    window.__panel.openTrophies = openTrophyPop;
    window.__panel.checkUpdate = checkForUpdate;
    if (fish()) {
      fish().exportDiag = exportDiag;
      fish().onCatch = function (row) {
        if (isTrophyCatchRow(row)) playRareChime(row);
      };
      fish().onTrophy = function (row, blob) {
        saveTrophyCard(row, blob);
      };
    }
    window.__panel.guard = function () {
      return { lastTickAt: lastTickAt, tickErrors: tickErrors, lastTickError: lastTickError, zombieRevives: zombieRevives };
    };
    tick();
  }

  function onVisible() {
    if (document.visibilityState === 'visible') {
      var hiddenMs = hiddenAt != null ? Math.max(0, Date.now() - hiddenAt) : 0;
      hiddenAt = null;
      // A throttled background tab can miss every hidden tick. This visibility event still knows the
      // wall time; the reducer decides whether a deliberate hold already covers it.
      if (hiddenMs && state) {
        try { dispatch({ type: 'hidden-return', at: Date.now(), hiddenMs: hiddenMs }); }
        catch (e) { noteTickError('hidden-return', e); }
      }
      if (state && (state.phase === 'running' || state.phase === 'waiting')) acquireWakeLock();
    } else {
      hiddenAt = Date.now();
      if (state) {
        try { dispatch({ type: 'hidden-start', at: Date.now() }); }
        catch (e) { noteTickError('hidden-start', e); }
      }
    }
  }

  function mountAdoption() {
    // The page can drop our host on navigation inside the SPA; put it back.
    if (/** @type {any} */ (mount).timer) clearInterval(/** @type {any} */ (mount).timer);
    /** @type {any} */ (mount).timer = setInterval(function () {
      if (!host || !document.documentElement.contains(host)) {
        try { if (host) document.documentElement.appendChild(host); } catch (e) {}
      }
    }, 2000);
  }

  function unmount() {
    closeTrophyPop();
    clearPromptMask();
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    if (tickTimer) clearInterval(tickTimer);
    if (guardTimer) clearInterval(guardTimer);
    if (placeTimer) clearInterval(placeTimer);
    if (/** @type {any} */ (mount).timer) clearInterval(/** @type {any} */ (mount).timer);

    window.removeEventListener('resize', place);
    document.removeEventListener('visibilitychange', onVisible);
    hiddenAt = null;
    releaseWakeLock();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (window.__panel) window.__panel.mounted = false;
  }

  mount();
})();
