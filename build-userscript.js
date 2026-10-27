#!/usr/bin/env node
/**
 * Build the server-free userscript.
 *
 * The bot needs two things the bookmarklet path makes hard: the script itself, and a local
 * HTTP server to serve it from. A userscript removes both - Tampermonkey runs it on page load,
 * forever, with no terminal, no port and no bookmarklet to click.
 *
 * So this file inlines autofish.js verbatim and appends a tiny bootstrap: a status chip that
 * starts and stops the bot, remembering the choice in localStorage. Nothing here talks to
 * fishserve; the catch POST inside autofish.js already fails silently when no server is up.
 *
 *   node build-userscript.js            -> dist/autofish.user.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist', 'autofish.user.js');

const HEADER = [
  '// ==UserScript==',
  '// @name         lofi.town AutoFish',
  '// @namespace    lofitown-autofishing',
  '// @version      3.1.0',
  '// @description  Casts, reels and presses the dial on lofi.town. No server, no bookmarklet.',
  '// @match        https://app.lofi.town/*',
  '// @run-at       document-idle',
  '// @grant        none',
  '// @noframes',
  '// ==/UserScript==',
].join('\n');

/**
 * The chip is the whole UI on this path: it says whether the bot is running and how many fish
 * it has landed, and one click toggles it. A fresh install starts OFF so the script never
 * presses keys on a page the user only just installed it on; the choice is remembered after.
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
  if (window.__autofishChip) return;
  window.__autofishChip = true;

  function makeChip() {
    var el = document.createElement('div');
    el.id = 'autofish-chip';
    el.style.cssText = [
      'position:fixed', 'left:14px', 'bottom:54px', 'z-index:2147483647',
      'font:600 12px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif',
      'color:#0f2f1c', 'background:#b9f6c9', 'border:1px solid rgba(15,47,28,.25)',
      'border-radius:999px', 'padding:7px 12px', 'cursor:pointer',
      '-webkit-user-select:none', 'user-select:none', 'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      'white-space:nowrap'
    ].join(';');
    el.title = 'AutoFish: click to start or stop';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  var el = null;
  function paint() {
    if (!el) return;
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

  function toggle() {
    var Api = window.__fish;
    if (!Api) return;
    if (Api.running) { Api.stop(); remember(false); }
    else { Api.start(); remember(true); }
    paint();
  }

  function boot() {
    el = makeChip();
    el.addEventListener('click', toggle);
    setInterval(paint, 1000);
    if (remembered()) { try { window.__fish.start(); } catch (e) {} }
    paint();
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot, { once: true });
})();
`;

function build() {
  const src = fs.readFileSync(path.join(ROOT, 'autofish.js'), 'utf8');
  if (src.indexOf('window.__fish = F') < 0) throw new Error('autofish.js no longer installs window.__fish');
  return [HEADER, '', '(function () {', "'use strict';", 'if (window.__autofishInstalled) return;', 'window.__autofishInstalled = true;', '', src, BOOTSTRAP, '})();', ''].join('\n');
}

function main() {
  const out = build();
  new Function(out); // parse check: a broken build must never reach a browser
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + out.length + ' bytes)');
}

if (require.main === module) main();
module.exports = { build, OUT };
