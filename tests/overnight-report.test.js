'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { analyze, selectNight, mergeAttempts, toAttempts, gaps, perHour, report, wilson, runSummary } = require('../scripts/overnight-report.js');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'overnight-report.js');

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

function snapshot(file, exportedAt, attempts, profile) {
  const data = { version: '3.9.46', exportedAt, attempts };
  if (profile) data.profile = profile;
  return { file, data };
}

/** Point the report at a throwaway sessions.csv (rows are CSV lines except the header). */
function withSessions(rows, fn, head) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-'));
  const csv = path.join(dir, 'sessions.csv');
  fs.writeFileSync(csv, [head || 'time,started_at,minutes,catches,reason'].concat(rows).join('\n') + '\n');
  const prev = process.env.FISHSERVE_SESSIONS;
  process.env.FISHSERVE_SESSIONS = csv;
  try { return fn(csv); } finally {
    if (prev === undefined) delete process.env.FISHSERVE_SESSIONS;
    else process.env.FISHSERVE_SESSIONS = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ONE_NIGHT = snapshot('export-2026-11-17T14-01-00-000Z.json', '2026-11-17T14:01:00Z', [
  row(1, 0, 'caught'), row(2, 300, 'caught'),
]);

const sessionLine = (minutes, duration, catches, reason) =>
  [new Date(at(minutes)).toISOString(), '', duration, catches, reason].join(',');

test('the report reads one night by default, and --all still merges every file', () => {
  const older = snapshot('export-2026-11-17T20-00-00-000Z.json', '2026-11-17T20:00:00Z', [row(1, 0, 'caught')]);
  const newer = snapshot('export-2026-11-18T20-00-00-000Z.json', '2026-11-18T20:00:00Z', [row(2, 1440, 'caught')]);
  const sel = selectNight([older, newer], {});
  assert.equal(sel.to, Date.parse(newer.data.exportedAt), 'the window ends at the newest snapshot, not at now');
  assert.equal(sel.from, sel.to - 12 * 3600000, 'twelve hours by default');
  assert.equal(sel.ignored, 1, 'the older night is out of the window');

  const night = analyze([older, newer], { night: true });
  assert.equal(night.coverage.snapshots, 1, 'only the newest night is read');
  assert.match(night.text, /1 from other nights ignored/);
  assert.equal(analyze([older, newer], { night: false }).coverage.snapshots, 2, '--all keeps every file');
});

test('attempts the store carried from an earlier run stay out of the night', () => {
  const snap = snapshot('export-2026-11-18T04-00-00-000Z.json', '2026-11-18T04:00:00Z', [
    row(1, -600, 'caught'), row(2, 0, 'caught'),
  ]);
  const out = analyze([snap], { night: true });
  assert.equal(out.coverage.snapshots, 1);
  assert.match(out.text, /1 attempts \(0 repeated rows merged · 1 outside the window\)/);
});

test('a session that outlives the data makes the night truncated', () => {
  withSessions([sessionLine(600, 600, 9, 'duration')], () => {
    const out = analyze([ONE_NIGHT], {});
    assert.equal(out.coverage.verdict, 'truncated');
    assert.equal(out.coverage.missingMs, 300 * 60000, 'the five hours between the last attempt and the session end');
    assert.equal(out.coverage.stopped, 'capture', 'the posts stopped rather than the run stalling');
    assert.match(out.text, /5 h 0 m unaccounted/);
    assert.match(out.text, /the capture stopped at/);
    assert.match(out.text, /\| 600 \| 9 \| duration \|/, 'the session that outlived the data is listed');
  });
});

test("a named profile is bounded by its own session row, never another profile's", () => {
  const nep = snapshot('export-2026-11-17T14-01-00-000Z.json', '2026-11-17T14:01:00Z',
    [row(1, 0, 'caught'), row(2, 300, 'caught')], 'nepchur');
  withSessions([
    sessionLine(600, 600, 9, 'duration'),   // the default profile, ten hours long
  ], (csv) => {
    const lonely = analyze([nep], {});
    assert.equal(lonely.coverage.verdict, 'unbounded', 'another profile cannot bound this night');
    assert.doesNotMatch(lonely.text, /unaccounted/);

    fs.appendFileSync(csv, [new Date(at(305)).toISOString(), '', 305, 8, 'duration', 'nepchur'].join(',') + '\n');
    const bounded = analyze([nep], {});
    assert.equal(bounded.coverage.verdict, 'complete');
    assert.match(bounded.text, /\| nepchur \| 305 \| 8 \| duration \|/, 'the matching row is listed with its profile');
    assert.doesNotMatch(bounded.text, /default \| 600/, 'the other profile is not folded in');
  }, 'time,started_at,minutes,catches,reason,profile');
});

test('data that reaches the last session is complete, not a warning', () => {
  const late = snapshot('export-2026-11-17T14-10-00-000Z.json', '2026-11-17T14:10:00Z', [row(1, 0, 'caught'), row(2, 590, 'caught')]);
  withSessions([sessionLine(580, 600, 9, 'duration')], () => {
    const out = analyze([late], {});
    assert.equal(out.coverage.verdict, 'complete');
    assert.match(out.text, /· complete/);
    assert.doesNotMatch(out.text, /unaccounted/);
  });
});

test('with no session row the report does not invent a truncation', () => {
  const prev = process.env.FISHSERVE_SESSIONS;
  process.env.FISHSERVE_SESSIONS = path.join(os.tmpdir(), 'overnight-none-' + process.pid + '.csv');
  try {
    const out = analyze([ONE_NIGHT], {});
    assert.equal(out.coverage.verdict, 'unbounded');
    assert.match(out.text, /no session row to bound the night/);
    assert.doesNotMatch(out.text, /unaccounted/);
  } finally {
    if (prev === undefined) delete process.env.FISHSERVE_SESSIONS;
    else process.env.FISHSERVE_SESSIONS = prev;
  }
});

/**
 * Boot the real fishserve on a throwaway directory, run fn(port, dir), then close it, restore the
 * env and delete the directory. Both end-to-end tests post the panel's row through this server.
 */
async function withFishserve(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-session-'));
  const keys = ['FISHSERVE_CATCHES', 'FISHSERVE_SESSIONS', 'FISHSERVE_SHOTS', 'FISHSERVE_RUNS'];
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.FISHSERVE_CATCHES = path.join(dir, 'catches.csv');
  process.env.FISHSERVE_SESSIONS = path.join(dir, 'sessions.csv');
  process.env.FISHSERVE_SHOTS = path.join(dir, 'shots');
  process.env.FISHSERVE_RUNS = path.join(dir, 'runs');
  const { createServer } = require('../fishserve.js');
  const server = createServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    return await fn(server.address().port, dir);
  } finally {
    await new Promise((res) => server.close(res));
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function postSession(port, body) {
  return fetch('http://127.0.0.1:' + port + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.lofi.town' },
    body: JSON.stringify(body),
  });
}

test('a session fishserve logs makes the report flag the truncated night', async () => {
  // The inlined panel posts this row shape to the address it uses for overnight capture; the report
  // has to see that row (not just a hand-written CSV) as the proof the capture stopped early.
  await withFishserve(async (port) => {
    const now = Date.now();
    const posted = await postSession(port, {
      started_at: new Date(now - 10 * 3600000).toISOString(), minutes: 600, catches: 12, reason: 'duration',
    });
    assert.equal(posted.status, 200, 'fishserve accepted the row the panel posts');

    const attempt = {
      id: 'x-1', n: 1, v: 'caught', t: now - 5 * 3600000, ms: 20000, p: 5, pa: 5, pr: 0, d: 2,
      w: 80, wb: 'mid', b: 'slow',
    };
    const out = analyze([snapshot('export-now.json', new Date(now - 20 * 60000).toISOString(), [attempt])], {});
    assert.equal(out.coverage.verdict, 'truncated');
    assert.equal(out.coverage.stopped, 'capture', 'the logged row outlives the last snapshot');
    assert.match(out.text, /unaccounted/);
    assert.match(out.text, /duration/, 'the row the panel posted is the one compared');
  });
});

test("a named profile posted to a real fishserve bounds that profile's night", async () => {
  // End to end: the panel's own body (profile included) through a live fishserve into sessions.csv,
  // then the morning report reads that file.
  const profile = 'nepchur';
  await withFishserve(async (port) => {
    const now = Date.now();
    const posted = await postSession(port, {
      started_at: new Date(now - 10 * 3600000).toISOString(), minutes: 600, catches: 12,
      reason: 'duration', profile,
    });
    assert.equal(posted.status, 200, 'fishserve accepted the row the panel posts');
    assert.match(fs.readFileSync(process.env.FISHSERVE_SESSIONS, 'utf8'), /,duration,nepchur$/m, 'the row is stored with its profile');

    const night = {
      file: 'export-now.json',
      data: {
        version: '3.9.51', profile,
        // The night ends with its last attempt: posts stop, the session runs on.
        exportedAt: new Date(now - 5 * 3600000).toISOString(),
        attempts: [{ id: 'x-1', n: 1, v: 'caught', t: now - 5 * 3600000, ms: 20000, p: 5, pa: 5, pr: 0, d: 2, w: 80, wb: 'mid', b: 'slow' }],
      },
    };
    const out = analyze([night], {});
    assert.equal(out.coverage.verdict, 'truncated', 'the logged row bounds the same profile\'s night');
    assert.equal(out.coverage.stopped, 'capture', 'the posts stopped before the session ended');
    assert.match(out.text, /5 h 0 m unaccounted/);
    assert.match(out.text, /\| nepchur \| 600 \| 12 \| duration \|/, 'the row is listed with the profile it was parsed from');
  });
});

test('the command reads the newest night by default and every file with --all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-cli-night-'));
  const write = (name, iso, n) => fs.writeFileSync(path.join(dir, name), JSON.stringify({
    version: '3.9.46', exportedAt: iso, attempts: [row(n, 0, 'caught')],
  }));
  write('export-2026-11-17T20-00-00-000Z.json', '2026-11-17T20:00:00Z', 1);
  write('export-2026-11-18T20-00-00-000Z.json', '2026-11-18T20:00:00Z', 2);
  const env = Object.assign({}, process.env, {
    FISHSERVE_RUNS: dir, FISHSERVE_SESSIONS: path.join(dir, 'none.csv'),
  });
  try {
    const one = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /1 snapshots/, 'the older night is not merged');
    assert.match(one.stdout, /1 from other nights ignored/);
    const all = spawnSync(process.execPath, [SCRIPT, '--all'], { encoding: 'utf8', env });
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /2 snapshots/, '--all keeps the old behaviour');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the command fails a morning check when the night was truncated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-cli-'));
  const file = path.join(dir, 'export-2026-11-17T14-01-00-000Z.json');
  fs.writeFileSync(file, JSON.stringify({
    version: '3.9.46', exportedAt: '2026-11-17T14:01:00Z', attempts: [row(1, 0, 'caught'), row(2, 300, 'caught')],
  }));
  const csv = path.join(dir, 'sessions.csv');
  fs.writeFileSync(csv, ['time,started_at,minutes,catches,reason', sessionLine(600, 600, 9, 'duration')].join('\n') + '\n');
  try {
    const run = spawnSync(process.execPath, [SCRIPT, file], {
      encoding: 'utf8', env: Object.assign({}, process.env, { FISHSERVE_SESSIONS: csv }),
    });
    assert.equal(run.status, 1, run.stderr || run.stdout);
    assert.match(run.stdout, /unaccounted/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
