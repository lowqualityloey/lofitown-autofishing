/* docs.test.js — guards for the documentation itself.
 *
 * Failures this guards against already happened: the README quoted "222 tests" while the
 * suite ran 228; a review existed on disk that the docs index never listed; and the state of
 * record still said 3.9.12 while package.json shipped 3.9.23. A number in prose drifts
 * silently, so the README must not quote one, the index is checked against the filesystem,
 * and the two documents that claim the current version are checked against the version that
 * is actually built.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the README does not quote a test count that can drift', () => {
  const m = read('README.md').match(/\b\d+\s+tests\b/);
  assert.equal(m, null, 'quote the suite, not a number: ' + (m && m[0]));
});

test('every doc in specs, reviews and tasks is listed in docs/README.md', () => {
  const index = read('docs/README.md');
  const missing = [];
  for (const dir of ['specs', 'reviews', 'tasks']) {
    for (const f of fs.readdirSync(path.join(ROOT, 'docs', dir))) {
      if (f.endsWith('.md') && !index.includes(dir + '/' + f)) missing.push(dir + '/' + f);
    }
  }
  assert.deepEqual(missing, [], 'add these to docs/README.md: ' + missing.join(', '));
});

test('the version package.json ships is the version the current-state docs claim', () => {
  const pkg = JSON.parse(read('package.json'));
  const quoted = pkg.version.replace(/\./g, '\\.');

  assert.match(
    read('docs/STATE.md'),
    new RegExp('autofish ' + quoted),
    'docs/STATE.md must name the shipped version where it describes the current build'
  );

  const status = read('AUTOFISH.md').match(/^Status: \*\*WORKING \(([0-9.]+)\)/m);
  assert.ok(status, 'AUTOFISH.md must keep a Status line with a version');
  assert.equal(status[1], pkg.version, 'AUTOFISH.md status version');
});
