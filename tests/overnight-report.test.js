'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mergeAttempts, toAttempts, gaps, perHour, report, wilson, runSummary } = require('../scripts/overnight-report.js');

const T = Date.UTC(2026, 10, 17, 19, 0, 0);
const at = (minutes) => T + minutes * 60000;

function row(n, minutes, verdict, why) {
  return {
    id: 'x-' + n, n, v: verdict, why: why || null, t: minutes == null ? null : at(minutes),
    ms: 20000, p: 5, pa: 5, pr: 0, d: 2, w: 80, wb: 'mid', b: 'slow',
  };
}

// The night as the exporter posts it: each snapshot repeats its neighbours, and the page's store
// rolls, so the same attempt arrives in more than one file.
const SNAPSHOTS = [
  { file: 'a.json', data: { version: '3.9.43', attempts: [row(1, 0, 'caught'), row(2, 1, 'caught'), row(3, 2, 'caught'), row(4, 3, 'caught')] } },
  {
    file: 'b.json', data: {
      version: '3.9.43', attempts: [row(4, 3, 'caught'), row(5, 4, 'lost', 'cast prompt'), row(6, 49, 'lost', 'cast prompt'), row(7, 50, 'caught')],
      run: { cut: 'daily-cap' }, doctor: { verdict: 'fishing', severity: 'ok' },
    },
  },
  {
    file: 'c.json', data: {
      version: '3.9.43', attempts: [row(7, 50, 'caught'), row(8, 51, 'caught'), row(9, null, 'caught')],
      perf: { fps: 58, p50: 7, p95: 18, worst: 210, snapshot: { path: 'gl' } },
    },
  },
];

test('snapshots merge into one run: the same attempt is counted once', () => {
  const merged = mergeAttempts(SNAPSHOTS);
  assert.equal(merged.unique, 9, 'nine distinct attempts across the three files');
  assert.equal(merged.rows, 11, 'each file contributes its rows');
  assert.equal(merged.repeated, 2, 'the repeated rows are the overlap');
  assert.deepEqual(merged.attempts.map((a) => a.n), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'sorted by wall clock, untimed last');
});

test('the night reports its own gaps, caps and totals', () => {
  const out = report(SNAPSHOTS);
  assert.match(out, /9 attempts/);
  assert.match(out, /Wilson 95% \d+\.\d%-\d+\.\d%/, 'the interval is read from wilson\'s lo/hi, not array indices');
  assert.match(out, /7 caught · 2 lost/, 'the totals come from the mapped rows');
  assert.match(out, /1 gap\(s\) over 10 m, longest 45 m/, 'the 45-minute stall is named: ' + out);
  assert.match(out, /Cut reasons: daily-cap × 1/);
  assert.match(out, /Doctor verdicts seen: fishing\/ok × 1/);
  assert.match(out, /fps 58/);
  assert.match(out, /Attempts per hour: /);
});

test('a gap below the threshold is not a stall', () => {
  assert.deepEqual(gaps([row(1, 0, 'caught'), row(2, 9, 'caught')]), []);
  assert.equal(gaps([row(1, 0, 'caught'), row(2, 10, 'caught')]).length, 1, 'ten minutes is the threshold');
});

test('perHour counts only timed attempts, and the totals use the page\'s own sum', () => {
  const merged = mergeAttempts(SNAPSHOTS);
  const hours = perHour(merged.attempts);
  const total = Object.keys(hours).reduce((a, k) => a + hours[k], 0);
  assert.equal(total, 8, 'the untimed attempt is not placed in an hour');

  const summary = runSummary(toAttempts(merged.attempts), {});
  assert.equal(summary.caught, 7, 'the compact row maps to the attempt shape, or every total is zero');
  assert.equal(summary.attempts, 9);
  assert.equal(summary.caught + summary.lost, 9);
  assert.deepEqual(summary.catchCi, wilson(summary.caught, 9), 'the report quotes the page\'s own interval');
});

test('the sessions fishserve logged are cross-checked against the night', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-'));
  const csv = path.join(dir, 'sessions.csv');
  fs.writeFileSync(csv, [
    'time,started_at,minutes,catches,reason',
    [new Date(at(5)).toISOString(), '', 60, 12, 'duration'].join(','),
    [new Date(at(70)).toISOString(), '', 240, 31, 'daily-cap'].join(','),
    [new Date(at(60 * 40)).toISOString(), '', 30, 4, 'next-day'].join(','),
  ].join('\n') + '\n');
  const prev = process.env.FISHSERVE_SESSIONS;
  process.env.FISHSERVE_SESSIONS = csv;
  try {
    const out = report(SNAPSHOTS);
    assert.match(out, /\| .* \| 60 \| 12 \| duration \|/);
    assert.match(out, /\| .* \| 240 \| 31 \| daily-cap \|/);
    assert.doesNotMatch(out, /next-day/, 'a session outside the night is not folded in');
  } finally {
    if (prev === undefined) delete process.env.FISHSERVE_SESSIONS;
    else process.env.FISHSERVE_SESSIONS = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
