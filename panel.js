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
  var BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) { try { return new URL(s.src).origin; } catch (e) { /* fall through */ } }
    return 'http://127.0.0.1:8731';
  })();
  var PREF_KEY = 'autofish.prefs';
  var POS_KEY = 'autofish.panel';
  var LIVE_KEY = 'autofish.live';
  var TICK_MS = 1000;

  var state = null;
  var baseTodayMs = 0;        // fishing minutes already logged today before this session
  var banner = '';
  var tickTimer = null;
  var placeTimer = null;
  var heartbeatAt = 0;
  var diagSent = false;       // one UI frame per session, when a run never sees a prompt
  var diagAt = 0;
  var wakeSentinel = null;
  var dragged = null;         // {x, y} once the user moved the panel
  var dragging = null;
  var collapsed = false;
  var host = null;
  var root = null;
  var ui = {};

  /* ------------------------------------------------------------- deps ----- */

  function loadScript(name, url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = BASE + url + '?t=' + Date.now();
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('cannot load ' + url)); };
      document.head.appendChild(s);
    });
  }

  async function deps() {
    if (!window.__fish) await loadScript('autofish', '/autofish.js');
    if (!window.AutoFishSession) await loadScript('session', '/session.js');
    if (!window.AutoFishLayout) await loadScript('layout', '/layout.js');
  }

  /* ------------------------------------------------------------ prefs ----- */

  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function loadPrefs() {
    var p = readJSON(PREF_KEY, {});
    var prefs = {};
    ['durationMs', 'cooldownMs', 'dailyCapMs'].forEach(function (k) {
      if (typeof p[k] === 'number') prefs[k] = p[k];
    });
    if (p.window && p.window.start && p.window.stop) {
      prefs.window = { on: !!p.window.on, start: p.window.start, stop: p.window.stop };
    }
    prefs.resumeAfterReload = !!p.resumeAfterReload;
    prefs.hideUpsell = !!p.hideUpsell;
    return prefs;
  }

  function savePrefs() {
    writeJSON(PREF_KEY, {
      durationMs: state.durationMs,
      cooldownMs: state.cooldownMs,
      dailyCapMs: state.dailyCapMs,
      window: state.window,
      resumeAfterReload: !!window.__panel.resumeAfterReload,
      hideUpsell: !!window.__panel.hideUpsell
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
  var upsellTimer = null;

  function upsellRoot() {
    var desc = document.getElementById(UPSELL_ID);
    if (!desc) return null;
    // display:none from our own tag would empty getClientRects() and make the sweep untag the root
    // it just tagged, i.e. show the modal again every 500 ms. A root we are hiding still counts.
    if (!desc.closest('[' + UPSELL_ATTR + ']') && !desc.getClientRects().length) return null;
    var node = desc;
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
  var FOCUS_NOTE = 'focus session active — focus fishing needs Cozier, casts are refused';

  function inFocusSession() {
    try { return /\bFOCUS\b/.test(document.title); } catch (e) { return false; }
  }

  /* ------------------------------------------------------------ server ---- */

  function dayKey(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    d = d || new Date();
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  async function loadToday() {
    try {
      var r = await fetch(BASE + '/sessions?day=' + dayKey(), { cache: 'no-store' });
      var j = await r.json();
      baseTodayMs = (j.minutes || 0) * 60000;
    } catch (e) { baseTodayMs = 0; }
  }

  function postSessionRow(reason, minutes, catches) {
    try {
      fetch(BASE + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ started_at: new Date(state.startedAt || Date.now()).toISOString(), minutes: minutes, catches: catches, reason: reason })
      }).then(function (r) { if (!r.ok) banner = 'session log rejected the row'; }).catch(function () { banner = 'session log offline — the session still works'; });
    } catch (e) { banner = 'session log offline — the session still works'; }
  }

  /**
   * Send one PNG of the game's UI layer to the local server. A run that pastes in the game but never
   * reacts is almost always looking at the wrong pixels; with the frame on disk the detector can be
   * corrected from what the game actually drew instead of from guesses.
   */
  function captureDiag(note) {
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

  function fish() { return window.__fish; }

  var RUNNERS = {
    startCore: function (a) { fish().start({ maxMinutes: a.maxMinutes }); },
    stopCore: function () { try { fish().stop(); } catch (e) {} },
    pauseCore: function () { try { fish().pause(); } catch (e) {} },
    resumeCore: function () { try { fish().resume(); } catch (e) {} },
    wakeLock: function () { acquireWakeLock(); },
    releaseWakeLock: function () { releaseWakeLock(); },
    persist: function () { savePrefs(); writeHeartbeat(); },
    sessionRow: function (a) { postSessionRow(a.reason, a.minutes, a.catches); },
    refuse: function (a) {
      banner = a.reason === 'cooldown' ? 'cooling down — wait for the timer' : 'daily cap reached — no more fishing today';
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
    var out = window.AutoFishSession.reduce(state, fact);
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
      writeJSON(LIVE_KEY, { startedAt: state.startedAt, phase: state.phase, minutes: Math.round(state.fishingMs / 60000), at: Date.now() });
    } else {
      try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
    }
  }

  function checkInterrupted() {
    var live = readJSON(LIVE_KEY, null);
    if (!live) return '';
    try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
    var minutes = typeof live.minutes === 'number' ? live.minutes : 0;
    postSessionRow('reload', minutes, 0);
    var resume = loadPrefs().resumeAfterReload;
    if (resume && state.window.on && window.AutoFishSession.withinWindow(state.window, Date.now())) {
      dispatch({ type: 'start', at: Date.now() });
      return 'session resumed after the reload';
    }
    return 'session interrupted by a reload — not resumed';
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
    '.card{width:264px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.45);backdrop-filter:blur(10px);overflow:hidden}',
    '.head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:rgba(255,255,255,.04);cursor:grab}',
    '.head:active{cursor:grabbing}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#5a6470;flex:none}',
    '.dot.running{background:#5ad18b;box-shadow:0 0 0 3px rgba(90,209,139,.18)}',
    '.dot.waiting{background:#f2c14e}.dot.paused{background:#f08a4b}.dot.cooldown{background:#7aa2f7}',
    '.title{font-weight:600;letter-spacing:.2px;flex:1}',
    '.chip{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#aab4bf;border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:1px 7px}',
    '.icon{border:0;background:transparent;color:#9aa4ae;font-size:14px;cursor:pointer;padding:2px 4px;border-radius:6px}',
    '.icon:hover{background:rgba(255,255,255,.08);color:#e8ecef}',
    '.body{padding:10px;display:flex;flex-direction:column;gap:9px}',
    '.row{display:flex;align-items:center;gap:6px}',
    '.label{flex:1;color:#aab4bf}',
    '.step{display:flex;align-items:center;gap:2px;background:rgba(255,255,255,.05);border-radius:9px;padding:2px}',
    '.step button{border:0;background:transparent;color:#cfd6dd;width:24px;height:22px;border-radius:7px;cursor:pointer;font-size:14px;line-height:1}',
    '.step button:hover{background:rgba(255,255,255,.10)}',
    '.step button:disabled{opacity:.3;cursor:default}',
    '.val{min-width:64px;text-align:center;font-variant-numeric:tabular-nums}',
    '.meters{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding-top:2px;border-top:1px solid rgba(255,255,255,.08)}',
    '.m{display:flex;justify-content:space-between;color:#9aa4ae}',
    '.m b{color:#e8ecef;font-weight:600;font-variant-numeric:tabular-nums}',
    '.primary{width:100%;border:0;border-radius:10px;padding:9px;font:inherit;font-weight:600;cursor:pointer;background:#2f7d5a;color:#eafff2}',
    '.primary.stop{background:#a33a3a;color:#ffecec}',
    '.primary:disabled{opacity:.45;cursor:default}',
    '.banner{font-size:11px;color:#f2c14e;background:rgba(242,193,78,.10);border-top:1px solid rgba(242,193,78,.22);padding:6px 10px}',
    '.banner:empty{display:none}',
    '.banner.seat{color:#ffc0b0;background:rgba(255,120,90,.14);border-top-color:rgba(255,120,90,.34)}',
    '.banner.focus{color:#cfe0ff;background:rgba(122,162,247,.12);border-top-color:rgba(122,162,247,.30)}',
    '.dot.stalled{background:#ff6b6b;box-shadow:0 0 0 3px rgba(255,107,107,.20)}',
    '.banner.stall{color:#ffb3b3;background:rgba(255,90,90,.14);border-top-color:rgba(255,90,90,.34)}',
    '.logbox{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}',
    '.strip{display:flex;gap:4px}',
    '.tier{flex:1;display:flex;flex-direction:column;align-items:center;line-height:1.25}',
    '.tier b{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}',
    '.tier span{font-size:8px;letter-spacing:.4px;text-transform:uppercase;color:#8b95a0}',
    '.last{font-size:10.5px;color:#9aa4ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pill{width:48px;height:48px;border-radius:14px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}',
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
    var chip = el('div', 'chip', 'idle');
    var min = el('button', 'icon', '–');
    min.title = 'collapse';
    head.append(dot, title, chip, min);

    var body = el('div', 'body');

    body.append(
      stepperRow('Session', 'dur', 5, 240),
      stepperRow('Cooldown', 'cool', 5, 120),
      stepperRow('Daily cap', 'cap', 30, 480)
    );

    // clock window
    var winRow = el('div', 'row');
    var winLabel = el('div', 'label', 'Clock window');
    var winToggle = el('button', 'icon', 'off');
    winToggle.title = 'run only between two times';
    winRow.append(winLabel, winToggle);
    body.appendChild(winRow);

    var timeRow = el('div', 'row');
    timeRow.appendChild(stepper('from', 15));
    timeRow.appendChild(stepper('to', 15));
    body.appendChild(timeRow);

    // cosmetic only: quietens the in-session Cozier upsell, see setUpsellHidden()
    var upsellRow = el('div', 'row');
    var upsellLabel = el('div', 'label', 'Cozier popup');
    var upsellToggle = el('button', 'icon', upsellOn ? 'on' : 'off');
    upsellToggle.title = 'hide the in-session Cozier upsell (cosmetic: a free account still cannot fish in focus)';
    upsellRow.append(upsellLabel, upsellToggle);
    body.appendChild(upsellRow);

    var meters = el('div', 'meters');
    meters.append(
      meter('left'), meter('catches'), meter('presses'), meter('today')
    );
    body.appendChild(meters);

    // Catch history. The core writes it on every parsed catch; the panel only reads it, so a
    // reload of the game still shows yesterday's ledger.
    var logBox = el('div', 'logbox');
    var strip = el('div', 'strip');
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
    var lastCatch = el('div', 'last', 'no catches yet');
    logBox.append(strip, lastCatch);
    body.appendChild(logBox);

    var primary = el('button', 'primary', 'Start');
    body.appendChild(primary);

    var bannerEl = el('div', 'banner');

    card.append(head, body, bannerEl);
    var pill = el('div', 'pill hide', '🎣');
    wrap.append(card, pill);
    root.appendChild(wrap);

    document.documentElement.appendChild(host);

    // stepperRow()/stepper()/meter() registered their pieces on ui as they built the DOM;
    // merge rather than replace, or every one of those references is lost.
    Object.assign(ui, {
      wrap: wrap, card: card, head: head, dot: dot, chip: chip, minBtn: min,
      winToggle: winToggle, timeRow: timeRow, upsellToggle: upsellToggle,
      primary: primary, banner: bannerEl, pill: pill,
      tierCells: tierCells, lastCatch: lastCatch
    });

    // stop the game seeing our clicks (bubble phase: our handlers already ran)
    ['pointerdown', 'pointerup', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel'].forEach(function (type) {
      host.addEventListener(type, function (e) { e.stopPropagation(); }, false);
    });
    host.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    min.addEventListener('click', function () { setCollapsed(true); });
    pill.addEventListener('click', function () { setCollapsed(false); });
    primary.addEventListener('click', function () {
      if (state.phase === 'idle' || state.phase === 'cooldown') dispatch({ type: 'start', at: Date.now() });
      else dispatch({ type: 'stop', at: Date.now(), reason: 'user' });
    });
    winToggle.addEventListener('click', function () {
      dispatch({ type: 'config', at: Date.now(), patch: { window: { on: !state.window.on } } });
      savePrefs();
    });
    upsellToggle.addEventListener('click', function () {
      setUpsellHidden(!upsellOn);
      savePrefs();
    });
    head.addEventListener('pointerdown', startDrag);

    restorePosition();
    render();
  }

  function meter(name) {
    var row = el('div', 'm');
    var label = el('span', null, name);
    var value = el('b', null, '—');
    row.append(label, value);
    ui['m' + name.charAt(0).toUpperCase() + name.slice(1)] = value;
    return row;
  }

  function stepperRow(labelText, key, min, max) {
    var row = el('div', 'row');
    var label = el('div', 'label', labelText);
    var box = el('div', 'step');
    var minus = el('button', null, '−');
    var val = el('div', 'val', '');
    var plus = el('button', null, '+');
    box.append(minus, val, plus);
    row.append(label, box);
    ui[key] = { val: val, minus: minus, plus: plus, min: min, max: max, key: key };
    bindStep(minus, plus, key, -1, 1);
    return row;
  }

  function stepper(labelText, minutes) {
    var label = el('div', 'val', '');
    var box = el('div', 'step');
    var minus = el('button', null, '−');
    var plus = el('button', null, '+');
    box.style.flex = '1';
    box.append(minus, label, plus);
    ui['time_' + labelText] = { val: label, minus: minus, plus: plus, which: labelText, step: minutes };
    bindClock(minus, plus, labelText, minutes);
    return box;
  }

  /** Press-and-hold with acceleration, so 5-minute steps can still cross an hour. */
  function bindStep(minus, plus, key, dl, dr) {
    var timer = null;
    var speed = 0;
    function apply(delta) {
      var conf = keyConf(key);
      var next = clamp(state[conf.field] + delta * conf.unit, conf.min, conf.max);
      if (next === state[conf.field]) return;
      var patch = {};
      patch[conf.field] = next;
      dispatch({ type: 'config', at: Date.now(), patch: patch });
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

  // Ranges are for people who want to leave it fishing overnight: a 12 h session and a
  // 24 h daily cap are reachable, and the cooldown can go down to one minute. The cap is
  // still the thing that stops an abandoned tab from fishing for days.
  function keyConf(key) {
    if (key === 'dur') return { field: 'durationMs', min: 5 * 60000, max: 720 * 60000, unit: 5 * 60000 };
    if (key === 'cool') return { field: 'cooldownMs', min: 1 * 60000, max: 120 * 60000, unit: 1 * 60000 };
    return { field: 'dailyCapMs', min: 30 * 60000, max: 1440 * 60000, unit: 60 * 60000 };
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function parseClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : 0;
  }
  function clockText(minutesOfDay) {
    var m = ((minutesOfDay % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function bindClock(minus, plus, which, stepMinutes) {
    function nudge(delta) {
      var key = which === 'from' ? 'start' : 'stop';
      var next = clockText(parseClock(state.window[key]) + delta * stepMinutes);
      var patch = { window: { on: state.window.on, start: state.window.start, stop: state.window.stop } };
      patch.window[key] = next;
      dispatch({ type: 'config', at: Date.now(), patch: patch });
      savePrefs();
    }
    minus.addEventListener('click', function () { nudge(-1); });
    plus.addEventListener('click', function () { nudge(1); });
  }

  /* ------------------------------------------------------------ render ---- */

  function minutesText(ms) {
    var total = Math.max(0, Math.round(ms / 60000));
    if (total >= 60) return Math.floor(total / 60) + 'h ' + String(total % 60).padStart(2, '0');
    return total + ' min';
  }

  /**
   * The ledger is the panel's only real history: fill the rarity strip and the last-catch line.
   * Everything here is a read - a broken ledger must never make the panel throw.
   */
  function renderLog() {
    if (!ui.tierCells) return;
    var book = null;
    try { book = (fish() && fish().log) ? fish().log() : null; } catch (e) { book = null; }
    var byTier = {};
    (book && book.byRarity || []).forEach(function (r) { byTier[r.rarity] = r.n || 0; });
    ui.tierCells.forEach(function (cell) {
      var n = byTier[cell.name] || 0;
      cell.num.textContent = String(n);
      cell.num.style.opacity = n ? '1' : '.35';
    });
    var last = book && book.last;
    if (!last) {
      ui.lastCatch.textContent = 'no catches yet';
      ui.lastCatch.title = 'the ledger fills as the bot lands fish';
      return;
    }
    var bits = [last.species];
    if (last.weight) bits.push(last.weight);
    if (last.rarity && last.rarity !== 'Unknown') bits.push((last.derived ? '~' : '') + last.rarity);
    if (last.at) bits.push(new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    ui.lastCatch.textContent = bits.join(' · ');
    ui.lastCatch.title = 'last catch' + (last.derived ? ' — rarity from the built-in catalogue, the card printed none' : '');
  }

  function render() {
    if (!ui.card) return;
    var phase = state.phase;
    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}
    // A stalled core still looks like "running" from the outside - the phase never changed, the
    // frames did. Say what is actually happening, in the place the phase is printed.
    var stalled = !!(status && status.running && status.stalled);
    ui.chip.textContent = stalled ? 'stalled' : phase;
    ui.dot.className = 'dot ' + (stalled ? 'stalled' : phase);
    ui.winToggle.textContent = state.window.on ? 'on' : 'off';
    ui.winToggle.style.color = state.window.on ? '#5ad18b' : '#9aa4ae';
    ui.timeRow.style.display = state.window.on ? '' : 'none';
    renderUpsellToggle();

    ui.dur.val.textContent = minutesText(state.durationMs);
    ui.cool.val.textContent = minutesText(state.cooldownMs);
    ui.cap.val.textContent = minutesText(state.dailyCapMs);
    ui.time_from.val.textContent = state.window.start;
    ui.time_to.val.textContent = state.window.stop;

    var stats = (status && status.stats) || {};

    if (phase === 'running') ui.mLeft.textContent = minutesText(state.durationMs - state.fishingMs) + ' left';
    else if (phase === 'cooldown' && state.cooldownUntil) ui.mLeft.textContent = minutesText(state.cooldownUntil - Date.now()) + ' cool';
    else if (phase === 'waiting') ui.mLeft.textContent = 'at ' + state.window.start;
    else ui.mLeft.textContent = minutesText(state.durationMs);
    ui.mCatches.textContent = String((stats.cards || state.catchCount || 0));
    ui.mPresses.textContent = String(stats.presses || 0);
    ui.mToday.textContent = minutesText(baseTodayMs + state.fishingMs) + ' / ' + minutesText(state.dailyCapMs);
    renderLog();

    var primary = ui.primary;
    if (phase === 'running' || phase === 'paused' || phase === 'waiting') {
      primary.textContent = 'Stop';
      primary.className = 'primary stop';
      primary.disabled = false;
    } else if (phase === 'cooldown') {
      var left = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
      primary.textContent = left > 0 ? 'Cooling down ' + minutesText(left) : 'Start';
      primary.className = 'primary';
      primary.disabled = left > 0;
    } else {
      primary.textContent = 'Start';
      primary.className = 'primary';
      primary.disabled = false;
    }

    // The single most confusing stop: the core is running but the game will not bite because the
    // character is standing up. Fishing in lofi.town is seat-based (the CAST! prompt is only emitted
    // from the sit-down path), so nothing the bot can click will start a cast - only sitting down
    // again will. Say that plainly, ahead of the log-offline chatter.
    // A stall outranks everything: the session is not running however the phase reads, and the
    // clock has stopped, so the player needs to know before the budget does.
    var stallNote = stalled ? 'loop stalled — the game stopped giving the bot frames; the clock is paused' : '';
    var seatNote = '';
    if (status && status.needsSeat && (phase === 'running' || phase === 'paused')) {
      seatNote = 'clock paused — nothing to bite: sit on a chair by the water';
    }
    // A focus session outranks the log-offline chatter: the run will look alive while the game
    // refuses every cast, which is the most expensive way to spend a budget.
    var focus = inFocusSession();
    var focusNote = focus ? FOCUS_NOTE : '';
    var note = stallNote || seatNote || focusNote || banner;
    ui.banner.textContent = note;
    if (stallNote) ui.banner.className = 'banner stall';
    else if (seatNote) ui.banner.className = 'banner seat';
    else if (focus && !banner) ui.banner.className = 'banner focus';
    else ui.banner.className = 'banner';
    ui.banner.style.display = note ? '' : 'none';

    // Observable from the outside even though the shadow root is closed.
    if (host) {
      host.dataset.phase = phase;
      host.dataset.catches = String(stats.cards || state.catchCount || 0);
      if (status && status.needsSeat) host.dataset.needsSeat = '1'; else delete host.dataset.needsSeat;
      if (focus) host.dataset.focus = '1'; else delete host.dataset.focus;
      if (stalled) host.dataset.stalled = '1'; else delete host.dataset.stalled;
    }

    place();
  }

  /* ------------------------------------------------------------ layout ---- */

  function zoneRect() {
    var f = fish();
    if (!f || !f.zones) return null;
    try {
      var z = f.zones();
      return window.AutoFishLayout.unionRect([z.bubble, z.dial, z.card, z.hintZone]);
    } catch (e) { return null; }
  }

  function place() {
    if (!host || dragging) return;
    var L = window.AutoFishLayout;
    if (!L) return;
    var size = collapsed ? { w: 48, h: 48 } : { w: 264, h: ui.card.getBoundingClientRect().height || 300 };
    var zone = zoneRect();
    var exclude = zone ? L.inflate(zone, 12) : null;
    var res = L.place({
      panel: size,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      exclude: exclude,
      topInset: 72,
      preferred: dragged || null
    });
    if (res === 'pill') {
      if (!collapsed) { setCollapsed(true); return; }
      res = { x: window.innerWidth - 60, y: 12, w: 48, h: 48 };
    }
    host.style.left = Math.round(res.x) + 'px';
    host.style.top = Math.round(res.y) + 'px';
    ui.wrap.className = 'wrap';
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
    if (e.button != null && e.button !== 0) return;
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
    if (!dragging) return;
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
    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}

    if (state.phase === 'idle' || state.phase === 'cooldown') {
      // keep wall clocks honest and let a cooldown end on its own
      if (state.phase === 'cooldown' && state.cooldownUntil && Date.now() >= state.cooldownUntil) {
        dispatch({ type: 'tick', at: Date.now(), visible: document.visibilityState === 'visible', catches: 0, errors: 0, todayMs: baseTodayMs, seat: false });
        banner = '';
      } else {
        render();
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
      // a stalled core must not be charged for time it never fished
      stalled: !!(status && status.running && status.stalled)
    });

    // 20 s running with zero prompts found means the detector is blind; grab one frame so the
    // shape of the real bubble can be measured rather than guessed. Once per session.
    if (!diagSent && state.phase === 'running' && status && status.stats && !status.stats.bubbles) {
      if (!diagAt) diagAt = Date.now();
      if (Date.now() - diagAt > 20000) { diagSent = true; captureDiag('no-prompt-after-20s'); }
    }

    if (Date.now() - heartbeatAt > 30000) { heartbeatAt = Date.now(); writeHeartbeat(); }
    if (banner && state.phase === 'running' && banner.indexOf('offline') === -1) { /* keep guard text visible */ }

    render();
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

    var S = window.AutoFishSession;
    var prefs = loadPrefs();
    state = S.createState(prefs.window ? { window: prefs.window, durationMs: prefs.durationMs, cooldownMs: prefs.cooldownMs, dailyCapMs: prefs.dailyCapMs } : prefs);
    window.__panel = window.__panel || {};
    window.__panel.resumeAfterReload = !!prefs.resumeAfterReload;

    await loadToday();

    // A core already running from a previous session is not ours to guess about.
    var before = null;
    try { before = fish().status ? fish().status() : null; } catch (e) {}
    if (before && before.running) { try { fish().stop(); } catch (e) {} banner = 'stopped a session that was already running'; }

    build();
    if (prefs.hideUpsell) setUpsellHidden(true); // cosmetic: see setUpsellHidden()
    mountAdoption();
    banner = checkInterrupted() || banner;

    tickTimer = setInterval(tick, TICK_MS);
    placeTimer = setInterval(place, 250);
    window.addEventListener('resize', place);
    document.addEventListener('visibilitychange', onVisible);

    window.__panel.mounted = true;
    window.__panel.state = function () { return state; };
    window.__panel.dispatch = dispatch;
    window.__panel.unmount = unmount;
    window.__panel.captureDiag = captureDiag;
    window.__panel.focus = inFocusSession;
    tick();
  }

  function onVisible() {
    if (document.visibilityState === 'visible' && (state.phase === 'running' || state.phase === 'waiting')) acquireWakeLock();
  }

  function mountAdoption() {
    // The page can drop our host on navigation inside the SPA; put it back.
    if (mount.timer) clearInterval(mount.timer);
    mount.timer = setInterval(function () {
      if (!host || !document.documentElement.contains(host)) {
        try { document.documentElement.appendChild(host); } catch (e) {}
      }
    }, 2000);
  }

  function unmount() {
    if (tickTimer) clearInterval(tickTimer);
    if (placeTimer) clearInterval(placeTimer);
    if (mount.timer) clearInterval(mount.timer);
    window.removeEventListener('resize', place);
    document.removeEventListener('visibilitychange', onVisible);
    releaseWakeLock();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (window.__panel) window.__panel.mounted = false;
  }

  mount();
})();
