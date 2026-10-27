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
    return prefs;
  }

  function savePrefs() {
    writeJSON(PREF_KEY, {
      durationMs: state.durationMs,
      cooldownMs: state.cooldownMs,
      dailyCapMs: state.dailyCapMs,
      window: state.window,
      resumeAfterReload: !!window.__panel.resumeAfterReload
    });
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
    '.pill{width:48px;height:48px;border-radius:14px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}',
    '.hide{display:none}'
  ].join('\n');

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

    var meters = el('div', 'meters');
    meters.append(
      meter('left'), meter('catches'), meter('presses'), meter('today')
    );
    body.appendChild(meters);

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
      winToggle: winToggle, timeRow: timeRow, primary: primary, banner: bannerEl, pill: pill
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
  }

  function keyConf(key) {
    if (key === 'dur') return { field: 'durationMs', min: 5 * 60000, max: 240 * 60000, unit: 5 * 60000 };
    if (key === 'cool') return { field: 'cooldownMs', min: 5 * 60000, max: 120 * 60000, unit: 5 * 60000 };
    return { field: 'dailyCapMs', min: 30 * 60000, max: 480 * 60000, unit: 15 * 60000 };
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

  function render() {
    if (!ui.card) return;
    var phase = state.phase;
    ui.chip.textContent = phase;
    ui.dot.className = 'dot ' + phase;
    ui.winToggle.textContent = state.window.on ? 'on' : 'off';
    ui.winToggle.style.color = state.window.on ? '#5ad18b' : '#9aa4ae';
    ui.timeRow.style.display = state.window.on ? '' : 'none';

    ui.dur.val.textContent = minutesText(state.durationMs);
    ui.cool.val.textContent = minutesText(state.cooldownMs);
    ui.cap.val.textContent = minutesText(state.dailyCapMs);
    ui.time_from.val.textContent = state.window.start;
    ui.time_to.val.textContent = state.window.stop;

    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}
    var stats = (status && status.stats) || {};

    if (phase === 'running') ui.mLeft.textContent = minutesText(state.durationMs - state.fishingMs) + ' left';
    else if (phase === 'cooldown' && state.cooldownUntil) ui.mLeft.textContent = minutesText(state.cooldownUntil - Date.now()) + ' cool';
    else if (phase === 'waiting') ui.mLeft.textContent = 'at ' + state.window.start;
    else ui.mLeft.textContent = minutesText(state.durationMs);
    ui.mCatches.textContent = String((stats.cards || state.catchCount || 0));
    ui.mPresses.textContent = String(stats.presses || 0);
    ui.mToday.textContent = minutesText(baseTodayMs + state.fishingMs) + ' / ' + minutesText(state.dailyCapMs);

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

    ui.banner.textContent = banner;
    ui.banner.style.display = banner ? '' : 'none';

    // Observable from the outside even though the shadow root is closed.
    if (host) {
      host.dataset.phase = phase;
      host.dataset.catches = String(stats.cards || state.catchCount || 0);
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
    var r = host.getBoundingClientRect();
    dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    host.setPointerCapture && host.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
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
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
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
        dispatch({ type: 'tick', at: Date.now(), visible: document.visibilityState === 'visible', catches: 0, errors: 0, todayMs: baseTodayMs });
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
      todayMs: baseTodayMs
    });

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
