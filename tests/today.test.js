'use strict';
/**
 * The daily cap used to be read from fishserve, so a server-free install reset it on every reload
 * and a second Start in the same page forgot the minutes the first session had just logged. The
 * pure half of the day store is extracted here; the localStorage wiring is guarded in panel.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'panel.js'), 'utf8');
const OPEN = '// <today-store>';
const CLOSE = '// </today-store>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('today-store sentinels are missing from panel.js');
const T = new Function(SRC.slice(a + OPEN.length, b) + '\nreturn { todayFrom, todayMerge, TODAY_KEY };')();

test('the day store only counts the current local day', () => {
  assert.equal(T.todayFrom(JSON.stringify({ day: '2026-10-29', ms: 120000 }), '2026-10-29'), 120000);
  assert.equal(T.todayFrom(JSON.stringify({ day: '2026-10-28', ms: 120000 }), '2026-10-29'), 0, 'yesterday is not today');
  assert.equal(T.todayFrom(null, '2026-10-29'), 0);
  assert.equal(T.todayFrom('{oops', '2026-10-29'), 0);
  assert.equal(T.todayFrom(JSON.stringify({ day: '2026-10-29', ms: 'lots' }), '2026-10-29'), 0);
  assert.equal(T.todayFrom(JSON.stringify({ day: '2026-10-29', ms: -5 }), '2026-10-29'), 0);
});

test('a finished session adds to today, and a new day starts at zero', () => {
  const first = T.todayMerge(null, '2026-10-29', 12 * 60000);
  assert.deepEqual(first, { day: '2026-10-29', ms: 720000 });
  assert.deepEqual(T.todayMerge(JSON.stringify(first), '2026-10-29', 180000), { day: '2026-10-29', ms: 900000 });
  assert.deepEqual(T.todayMerge(JSON.stringify(first), '2026-10-30', 60000), { day: '2026-10-30', ms: 60000 });
  assert.deepEqual(T.todayMerge(JSON.stringify(first), '2026-10-29', -1e9), { day: '2026-10-29', ms: 0 }, 'never negative');
  assert.deepEqual(T.todayMerge(null, '2026-10-29', 'x'), { day: '2026-10-29', ms: 0 });
});
