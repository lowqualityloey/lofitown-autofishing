/* docs.test.js — guards for the documentation itself.
 *
 * Both failures this guards against already happened: the README quoted "222 tests" while the
 * suite ran 228, and a review existed on disk that the docs index never listed. A number in prose
 * drifts silently, so the README must not quote one; the index is checked against the filesystem,
 * because the filesystem is the thing that is right.
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
