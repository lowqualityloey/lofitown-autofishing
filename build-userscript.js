#!/usr/bin/env node
/**
 * Build the server-free userscript.
 *
 * The bookmarklet path needs three things that are hard: a terminal to run fishserve, a port
 * that has to still be alive, and a bookmarklet re-clicked after every reload. A userscript
 * removes all three - Tampermonkey runs it on page load, forever.
 *
 * So this file inlines the four pieces the bookmarklet used to fetch over HTTP - the bot core,
 * the session reducer, the placement math and the panel - verbatim and in load order. The panel
 * then mounts itself exactly as it always did; it only ever fetched those three dependencies
 * when they were missing, so with them inlined it needs no server at all. Its two server calls
 * (today's minutes, the session row) already fail softly.
 *
 * A chip is kept as the fallback UI: if the panel cannot mount, the bot must still be reachable.
 *
 *   node build-userscript.js            -> dist/autofish.user.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist', 'autofish.user.js');
// One source of truth: the header version is package.json's, so a bump cannot half-happen.
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HEADER = [
  '// ==UserScript==',
  '// @name         lofi.town AutoFish',
  '// @namespace    lofitown-autofishing',
  '// @version      ' + VERSION,
  '// @description  Casts, reels and presses the dial on lofi.town. Panel included; no server, no bookmarklet.',
  '// @match        https://app.lofi.town/*',
  '// @run-at       document-idle',
  '// @grant        none',
  '// @noframes',
  '// ==/UserScript==',
].join('\n');

/**
 * The panel owns the session (length, cooldown, guards, caught list). It mounts itself when it
 * loads, and it needs window.__fish, AutoFishSession and AutoFishLayout - all inlined above, so
 * it never calls loadScript() and never needs fishserve.
 *
 * The chip is only a fallback: if the panel is not mounted shortly after load (an exception, or
 * a page where something removed it), a small pill starts and stops the bot and remembers the
 * choice in localStorage. A fresh install starts OFF either way - an install must never press
 * keys in a tab the user only just opened.
 */
const BOOTSTRAP = `
(function () {
  'use strict';
  var KEY = 'autofish:on';
  function remembered() {
    try { return localStorage.getItem(KEY) === 'on'; } catch (e) { return false; }
  }
  function remember(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
  }
  function panelUp() { return !!(window.__panel && window.__panel.mounted); }

  var el = null;
  function paint() {
    if (!el) return;
    if (panelUp()) { try { el.remove(); } catch (e) {} el = null; return; }
    // A chip that goes blank because one status() read threw is worse than a stale label.
    try {
      var Api = window.__fish;
      if (!Api) { el.textContent = '🐟 AutoFish · waiting for the game'; return; }
      var st = Api.status();
      var acc = st.accuracy || {};
      var label = st.running ? 'on' : 'off';
      el.textContent = '🐟 AutoFish · ' + label + ' · ' + (acc.caught || 0) + ' caught';
      el.style.background = st.running ? '#b9f6c9' : '#f1e6c9';
    } catch (e) {
      el.textContent = '🐟 AutoFish · ready';
    }
  }

  function makeChip() {
    var node = document.createElement('div');
    node.id = 'autofish-chip';
    node.style.cssText = [
      'position:fixed', 'left:14px', 'bottom:54px', 'z-index:2147483647',
      'font:600 12px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif',
      'color:#0f2f1c', 'background:#f1e6c9', 'border:1px solid rgba(15,47,28,.25)',
      'border-radius:999px', 'padding:7px 12px', 'cursor:pointer',
      '-webkit-user-select:none', 'user-select:none', 'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      'white-space:nowrap'
    ].join(';');
    node.title = 'AutoFish: click to start or stop';
    (document.body || document.documentElement).appendChild(node);
    return node;
  }

  function toggle() {
    var Api = window.__fish;
    if (!Api) return;
    if (Api.running) { Api.stop(); remember(false); }
    else { Api.start(); remember(true); }
    paint();
  }

  function showChip() {
    if (el || panelUp()) return;
    el = makeChip();
    el.addEventListener('click', toggle);
    setInterval(paint, 1000);
    if (remembered()) { try { window.__fish.start(); } catch (e) {} }
    paint();
  }

  // The panel's mount is async (it reads prefs and today's minutes), so give it a moment before
  // deciding it failed. These timers are the only thing the chip waits on.
  [800, 2000, 4000].forEach(function (ms) {
    setTimeout(function () { if (!panelUp()) showChip(); }, ms);
  });
})();
`;

const PARTS = ['autofish.js', 'session.js', 'layout.js', 'panel.js'];

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function build() {
  const src = read('autofish.js');
  if (src.indexOf('window.__fish = F') < 0) throw new Error('autofish.js no longer installs window.__fish');
  // The engine's own label has to match the wrapper. It sat at "autofish 3.0" while the header
  // climbed to 3.6.1, so a freshly updated install still looked stale in status() and the panel.
  const stamped = src.replace(/version: 'autofish [0-9.]+'/, "version: 'autofish " + VERSION + "'");
  if (stamped === src) throw new Error('autofish.js no longer declares F.version');
  const session = read('session.js');
  if (session.indexOf('AutoFishSession') < 0) throw new Error('session.js no longer exports AutoFishSession');
  const layout = read('layout.js');
  if (layout.indexOf('AutoFishLayout') < 0) throw new Error('layout.js no longer exports AutoFishLayout');
  const panel = read('panel.js');
  if (panel.indexOf('AutoFishSession') < 0) throw new Error('panel.js no longer consumes AutoFishSession');
  return [HEADER, '', '(function () {', "'use strict';", 'if (window.__autofishInstalled) return;', 'window.__autofishInstalled = true;', '', stamped, session, layout, panel, BOOTSTRAP, '})();', ''].join('\n');
}

function main() {
  const out = build();
  new Function(out); // parse check: a broken build must never reach a browser
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + out.length + ' bytes)');
}

if (require.main === module) main();
module.exports = { build, OUT, PARTS };
