#!/usr/bin/env node
// @ts-check
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
// GitHub serves the newest release's asset under this fixed path, so an installed copy can find
// its own updates. Every release has to attach the build under exactly this file name.
//
// It points at the public distribution repository, not this one: the source repository is private,
// so its release assets answer an unauthenticated Tampermonkey update check with 404. The dist
// repository holds no source - just the built file - so both browsers can update without a
// GitHub session. Publish every release there too, with the asset named autofish.user.js.
//
// The mirror serves the newest release under this fixed path, so an installed copy finds its
// own updates. Restored for the release: the live pass ran the same code without these two
// lines (a manual install must not silently downgrade while the mirror still serves the
// previous version), and scripts/release.js refuses a tag whose dist lacks them.
const UPDATE_URL = 'https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/latest/download/autofish.user.js';

const HEADER = [
  '// ==UserScript==',
  '// @name         lofi.town AutoFish',
  '// @namespace    lofitown-autofishing',
  '// @version      ' + VERSION,
  '// @description  Casts, reels and presses the dial on lofi.town. Panel included; no server, no bookmarklet.',
  '// @downloadURL  ' + UPDATE_URL,
  '// @updateURL    ' + UPDATE_URL,
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

/** @type {string[]} */
const CORE_MODULES = ['src/diagnostics.js', 'src/ledger.js', 'src/vision.js', 'src/timing.js', 'src/loop.js', 'src/missions.js'];
const PARTS = CORE_MODULES.concat(['autofish.js', 'session.js', 'layout.js', 'panel.js']);

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

/**
 * Stamp the version into the core itself, not only the header: the panel head and __fish.version
 * read F.version, and a tab that says 3.5.0 while the file is 3.6.0 is the bug this prevents.
 * The placeholder is asserted, so a rename cannot silently ship 'dev'.
 */
function stamp(core) {
  const placeholder = "const F = { version: 'dev' };";
  const n = core.split(placeholder).length - 1;
  if (n !== 1) throw new Error('expected one version placeholder in autofish.js, found ' + n);
  return core.replace(placeholder, 'const F = { version: ' + JSON.stringify(VERSION) + ' };');
}

/**
 * Assemble the modular core (`src/*.js` + `autofish.js`) in execution order. Pass null for
 * `version` to keep the unbundled `'dev'` placeholder for `fishserve`'s live `/autofish.js` route.
 * @param {string | null} [version]
 */
function assembleCore(version) {
  const raw = read('autofish.js');
  if (raw.indexOf('window.__fish = F') < 0) throw new Error('autofish.js no longer installs window.__fish');
  const core = version == null ? raw : stamp(raw);
  return CORE_MODULES.map(read).concat([core]).join('\n').replace(/\r\n/g, '\n');
}

function build() {
  const src = assembleCore(VERSION);
  const session = read('session.js');
  if (session.indexOf('AutoFishSession') < 0) throw new Error('session.js no longer exports AutoFishSession');
  const layout = read('layout.js');
  if (layout.indexOf('AutoFishLayout') < 0) throw new Error('layout.js no longer exports AutoFishLayout');
  const panel = read('panel.js');
  if (panel.indexOf('AutoFishSession') < 0) throw new Error('panel.js no longer consumes AutoFishSession');
  // Normalise to LF: git stores these sources with LF and a Windows checkout hands them back
  // with CRLF, so without this the output - and the "dist is current" byte comparison in
  // tests/fishserve.test.js - would depend on how the tree was checked out.
  return [HEADER, '', '(function () {', "'use strict';", 'if (window.__autofishInstalled) return;', 'window.__autofishInstalled = true;', '', src, session, layout, panel, BOOTSTRAP, '})();', ''].join('\n').replace(/\r\n/g, '\n');
}

function main() {
  const out = build();
  new Function(out); // parse check: a broken build must never reach a browser
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + out.length + ' bytes)');
}

if (require.main === module) main();
// UPDATE_URL is exported so scripts/release.js publishes to exactly the repository the header
// advertises: a second copy of that URL is how the two releases would drift apart.
module.exports = { build, assembleCore, CORE_MODULES, OUT, PARTS, UPDATE_URL };
