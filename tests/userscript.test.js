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
  assert.match(src, /el\.id = 'autofish-chip'/);
  // A fresh install must not fish on its own: the only boot-time start sits inside the
  // remembered() check, so nothing is pressed until the user clicks the chip once.
  assert.match(src, /if \(remembered\(\)\) \{ try \{ window\.__fish\.start\(\); \} catch \(e\) \{\} \}/);
  const autoStarts = src.match(/window\.__fish\.start\(\)/g) || [];
  assert.equal(autoStarts.length, 1);
});
