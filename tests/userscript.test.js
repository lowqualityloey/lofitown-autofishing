'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { build } = require('../build-userscript.js');

const src = build();

test('the userscript is a valid script body', () => {
  assert.doesNotThrow(() => new Function(src));
});

test('it installs itself on the game page only, with no grants', () => {
  assert.match(src, /^\/\/ @match\s+https:\/\/app\.lofi\.town\/\*/m);
  assert.match(src, /^\/\/ @grant\s+none$/m);
  assert.match(src, /^\/\/ @run-at\s+document-idle$/m);
  assert.match(src, /^\/\/ @noframes$/m);
});

test('the userscript version matches package.json, so a bump cannot half-happen', () => {
  const pkg = require('../package.json');
  assert.match(src, new RegExp('^// @version\\s+' + pkg.version.replace(/\./g, '\\.') + '$', 'm'));
});

test('the header advertises the stable release asset for updates', () => {
  // Must be the PUBLIC dist repository: a private repository's release asset 404s for an
  // unauthenticated Tampermonkey check, which is the whole point of the separate mirror.
  const url = 'https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/latest/download/autofish.user.js';
  const dl = src.match(/^\/\/ @downloadURL\s+(\S+)$/m);
  const up = src.match(/^\/\/ @updateURL\s+(\S+)$/m);
  assert.ok(dl, 'expected a @downloadURL directive');
  assert.ok(up, 'expected an @updateURL directive');
  assert.strictEqual(dl[1], url);
  assert.strictEqual(up[1], url, 'both directives must point at the same file');
});

test('the version is stamped into the core, not only into the header', () => {
  // Two browsers, one dist: a tab can only say which build it runs if F.version comes from the
  // build. The header and the console have to agree with it, so package.json is the only source.
  const pkg = require('../package.json');
  assert.ok(
    src.indexOf('const F = { version: ' + JSON.stringify(pkg.version) + ' };') > 0,
    '__fish.version must carry package.json version'
  );
  assert.ok(src.indexOf("const F = { version: 'dev' };") < 0, 'the dev placeholder must not survive a build');
  assert.match(src, /version: F\.version/, '__fish.report() still reports it');
});

test('the bot core is inlined exactly once', () => {
  const n = src.split('window.__fish = F').length - 1;
  assert.strictEqual(n, 1);
  assert.ok(src.length > 60000, 'expected the whole core, got ' + src.length + ' bytes');
});

test('nothing fetches the userscript from a local server any more', () => {
  assert.ok(src.indexOf('__FISHSERVE__') < 0);
  // the unchanged core still POSTs catches; that call must stay non-fatal
  assert.match(src, /fetch\(F\.logUrl[\s\S]*?\.catch\(function \(\) \{\}\)/);
});

test('the chip starts off, remembers a click, and can stop the bot', () => {
  assert.match(src, /autofish:on/);
  assert.match(src, /remembered\(\)/);
  assert.match(src, /if \(remembered\(\)\)/);
  assert.match(src, /Api\.stop\(\); remember\(false\)/);
  assert.match(src, /Api\.start\(\); remember\(true\)/);
  assert.match(src, /node\.id = 'autofish-chip'/);
  // A fresh install must not fish on its own: the only boot-time start sits inside the
  // remembered() check, so nothing is pressed until the user clicks the chip once.
  assert.match(src, /if \(remembered\(\)\) \{ try \{ window\.__fish\.start\(\); \} catch \(e\) \{\} \}/);
  const autoStarts = src.match(/window\.__fish\.start\(\)/g) || [];
  assert.equal(autoStarts.length, 1);
});

test('the panel, the session reducer and the layout math are inlined, in load order', () => {
  const iCore = src.indexOf('window.__fish = F');
  const iSession = src.indexOf('root.AutoFishSession');
  const iLayout = src.indexOf('root.AutoFishLayout');
  const iPanel = src.indexOf('if (window.__panel && window.__panel.mounted) return;');
  assert.ok(iCore > 0, 'core inlined');
  assert.ok(iSession > iCore, 'session.js after the core');
  assert.ok(iLayout > iSession, 'layout.js after session.js');
  assert.ok(iPanel > iLayout, 'panel.js last, after everything it depends on');
  // The panel loads its three deps from fishserve only when they are missing. Inlined, that
  // path never runs - which is what makes the panel server-free.
  assert.match(src, /if \(!window\.__fish\) await loadScript\('autofish', '\/autofish\.js'\)/);
});

test('the panel is the UI and the chip is only its fallback', () => {
  assert.match(src, /function panelUp\(\)/);
  assert.match(src, /if \(panelUp\(\)\) \{ try \{ el\.remove\(\)/);
  assert.match(src, /\[800, 2000, 4000\]\.forEach/);
  // No chip is built at load time - only showChip(), which the timers call.
  assert.ok(src.indexOf('el = makeChip()') > src.indexOf('function showChip()'));
});
