#!/usr/bin/env node
/**
 * Read a night of AutoFish into one page you can paste into the notebook.
 *
 *   node scripts/overnight-report.js                # everything in data/runs (or $FISHSERVE_RUNS)
 *   node scripts/overnight-report.js file.json …    # specific snapshots, or one hand-saved exportRun()
 *
 * `scripts/overnight-export.js` posts a snapshot every five minutes, so the files overlap and the
 * same attempt appears in several of them; this merges them by `id` and then answers the questions
 * the overnight run exists for: did the caps fire, did a stall cost hours, and what did the night
 * actually catch. Totals come from the page's own `runSummary`/`wilson`, sliced out of autofish.js
 * the same way the test suite does it, so the numbers are comparable to README and STATE.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAP_MS = 10 * 60 * 1000;
// One night, not every night: the report's window ends with the newest snapshot, so running it the
// next afternoon still reads last night instead of whatever is newest in the directory.
const NIGHT_MS = 12 * 60 * 60 * 1000;

const SRC = fs.readFileSync(path.join(ROOT, 'autofish.js'), 'utf8');

/** The function's own text, by brace matching. wilson and runSummary contain no braces in strings. */
function extract(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('autofish.js has no function ' + name);
  let depth = 0;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
const { wilson, runSummary } = new Function(
  extract('wilson') + '\n' + extract('runSummary') + '\nreturn { wilson, runSummary };'
)();

const clock = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
};
// Local date and local clock together: a UTC date beside a local time made a night that crossed
// midnight read as if it ran backwards (19:58 → 04:06 on the same date).
const dayClock = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + clock(t);
};
const dur = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' m' : m + ' m';
};
const pct = (x) => (x == null ? '-' : (x * 100).toFixed(1) + '%');

function filesOf(targets) {
  const out = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) continue;
    if (fs.statSync(t).isDirectory()) {
      for (const f of fs.readdirSync(t).filter((f) => f.endsWith('.json')).sort()) out.push(path.join(t, f));
    } else out.push(t);
  }
  return out;
}

function loadSnapshots(targets) {
  return filesOf(targets).map((file) => {
    try {
      return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      return { file, error: String((e && e.message) || e) };
    }
  });
}

/** One attempt per id: every snapshot repeats its neighbours, so the union is the run. */
function mergeAttempts(snapshots) {
  const byId = new Map();
  let rows = 0;
  for (const s of snapshots) {
    for (const a of (s.data && s.data.attempts) || []) {
      rows++;
      if (!a || a.n == null) continue;
      const key = a.id || a.n + ':' + (a.t == null ? '' : a.t);
      if (!byId.has(key)) byId.set(key, a);
    }
  }
  const attempts = Array.from(byId.values()).sort((x, y) => {
    const xt = x.t != null && x.t > 1e12 ? x.t : Infinity;
    const yt = y.t != null && y.t > 1e12 ? y.t : Infinity;
    return xt - yt || (x.n || 0) - (y.n || 0);
  });
  return { attempts, rows, unique: attempts.length, repeated: rows - attempts.length };
}

/**
 * The store's compact row is not the attempt shape runSummary reads: exportRun() maps it, and so
 * does this, with the same field names, or every total would silently be zero.
 */
function toAttempts(rows) {
  return rows.map((r) => ({
    verdict: r.v, band: r.b, widthBand: r.wb, presses: r.p,
    pressAccepted: r.pa, pressRejected: r.pr, dials: r.d,
    avgWidth: r.w, ms: r.ms, species: r.sp, rarity: r.r, why: r.why, startAt: r.t, dialLog: r.dl,
  }));
}

/** Every stretch with no attempt resolved in it - the shape of "something stopped". */
function gaps(attempts, thresholdMs) {
  const timed = attempts.filter((a) => a.t != null && a.t > 1e12);
  const out = [];
  for (let i = 1; i < timed.length; i++) {
    const ms = timed[i].t - timed[i - 1].t;
    if (ms >= (thresholdMs || GAP_MS)) out.push({ from: timed[i - 1].t, to: timed[i].t, ms, after: timed[i - 1].n });
  }
  return out.sort((a, b) => b.ms - a.ms);
}

function perHour(attempts) {
  const rows = {};
  for (const a of attempts) {
    if (a.t == null || a.t <= 1e12) continue;
    const h = new Date(a.t).getHours();
    rows[h] = (rows[h] || 0) + 1;
  }
  return rows;
}

/** When a snapshot was taken: its own export stamp, then the file name, then the file's mtime. */
function snapshotTime(s) {
  const stamp = s && s.data && Date.parse(s.data.exportedAt);
  if (Number.isFinite(stamp) && stamp > 1e12) return stamp;
  const name = path.basename((s && s.file) || '');
  const m = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/.exec(name);
  if (m) {
    const t = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + '.' + m[5] + 'Z');
    if (Number.isFinite(t)) return t;
  }
  try { return fs.statSync(s.file).mtimeMs; } catch (e) { return null; }
}

/**
 * Keep the snapshots of one night. The window is anchored on the newest export, not on "now": a
 * report run hours later must still read the night, not the afternoon. Files that cannot be dated
 * are kept rather than hidden, because an unreadable snapshot is worth seeing.
 */
function selectNight(snapshots, opts) {
  const o = opts || {};
  const timed = snapshots.map((s) => ({ s, at: snapshotTime(s) })).filter((x) => x.at != null);
  if (!timed.length) return { snapshots, from: null, to: null, ignored: 0 };
  timed.sort((a, b) => a.at - b.at);
  const to = timed[timed.length - 1].at;
  const from = o.from != null ? o.from : to - (o.hours > 0 ? o.hours : NIGHT_MS / 3600000) * 3600000;
  const kept = [];
  const ignored = [];
  for (const x of timed) (x.at >= from && x.at <= to ? kept : ignored).push(x.s);
  return {
    snapshots: kept.concat(snapshots.filter((s) => snapshotTime(s) == null)),
    from, to, ignored: ignored.length,
  };
}

/** How long a session was allowed to run; it bounds how far past the last post a session row may sit. */
function nightCapMs(good) {
  const o = good.length ? good[good.length - 1].data.opts : null;
  const d = o && Number(o.durationMs);
  return Number.isFinite(d) && d > 3600000 ? Math.min(d, 24 * 3600000) : NIGHT_MS;
}

/**
 * Did the capture outlive the data? A night that ends at 02:00 while sessions.csv logs a session
 * ending at 07:00 is missing five hours, and that used to look like a clean, quiet night.
 */
function coverageOf(good, attempts, sessions, opts) {
  const o = opts || {};
  const posts = good.map(snapshotTime).filter((t) => t != null).sort((a, b) => a - b);
  const timed = attempts.filter((a) => a.t != null && a.t > 1e12).map((a) => a.t).sort((a, b) => a - b);
  const firstPostAt = posts.length ? posts[0] : null;
  const lastPostAt = posts.length ? posts[posts.length - 1] : null;
  const newest = timed.length ? timed[timed.length - 1] : null;
  const sessionEnd = sessions.length ? Math.max.apply(null, sessions.map((s) => s.time)) : null;
  const missingMs = sessionEnd != null && newest != null ? sessionEnd - newest : 0;
  let verdict = 'unbounded';
  let stopped = null;
  if (sessionEnd != null && newest != null) {
    if (missingMs > GAP_MS) {
      verdict = 'truncated';
      // "capture" means the posts stopped; "run" means they kept landing with no new attempt.
      stopped = lastPostAt != null && lastPostAt < sessionEnd - GAP_MS ? 'capture' : 'run';
    } else verdict = 'complete';
  }
  return {
    verdict, missingMs: Math.max(0, missingMs), stopped, firstPostAt, lastPostAt, newest, sessionEnd,
    snapshots: good.length, ignored: o.ignored || 0,
  };
}

function readSessions(from, to) {
  const file = process.env.FISHSERVE_SESSIONS || path.join(ROOT, 'sessions.csv');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1)
    .map((line) => line.split(','))
    .filter((r) => r.length >= 5)
    .map((r) => ({ time: Date.parse(r[0]), started_at: r[1], minutes: Number(r[2]) || 0, catches: Number(r[3]) || 0, reason: r[4] }))
    // The upper bound is given by the caller: a session that ended after the last snapshot is the
    // one row that proves the capture stopped, so it must not be filtered out.
    .filter((r) => !from || (r.time >= from - 3600_000 && (!to || r.time <= to)));
}

/**
 * Build the night's page and the coverage verdict. `opts.night` selects the window; callers that
 * already handed in an explicit file list get exactly those files.
 */
function analyze(snapshots, opts) {
  const o = opts || {};
  let picked = snapshots;
  let ignored = 0;
  let window = null;
  if (o.night) {
    const sel = selectNight(snapshots, { hours: o.hours, from: o.since });
    picked = sel.snapshots;
    ignored = sel.ignored;
    window = sel;
  }
  const good = picked.filter((s) => s.data);
  if (!good.length) {
    return {
      text: 'no readable snapshots' + (o.night ? ' in the night window; use --all to merge every file' : '') + '\n',
      coverage: null,
      snapshots: picked,
    };
  }
  const merged = mergeAttempts(good);
  // The page store carries rows from runs before this one, so a snapshot can hold attempts older
  // than its own night. They belong to an earlier run, not this report.
  const rows = window
    ? merged.attempts.filter((a) => a.t == null || (a.t >= window.from && a.t <= window.to))
    : merged.attempts;
  const outside = merged.attempts.length - rows.length;
  const run = runSummary(toAttempts(rows), {});
  const timed = rows.filter((a) => a.t != null && a.t > 1e12);
  const from = timed.length ? timed[0].t : null;
  const to = timed.length ? timed[timed.length - 1].t : null;
  const found = gaps(rows, GAP_MS);
  const hours = perHour(rows);
  const hourKeys = Object.keys(hours).map(Number).sort((a, b) => a - b);
  const losses = {};
  for (const a of rows) if (a.v === 'lost') losses[a.why || 'unknown'] = (losses[a.why || 'unknown'] || 0) + 1;
  const cuts = {};
  const doctors = {};
  let storeErrors = 0;
  for (const s of good) {
    const cut = s.data.run && s.data.run.cut;
    if (cut) cuts[cut] = (cuts[cut] || 0) + 1;
    if (s.data.storeError) storeErrors++;
    const d = s.data.doctor;
    if (d && d.verdict) doctors[d.verdict + '/' + d.severity] = (doctors[d.verdict + '/' + d.severity] || 0) + 1;
  }
  const last = good[good.length - 1].data;
  const ci = run.catchCi;
  const cap = nightCapMs(good);
  const posts = good.map(snapshotTime).filter((t) => t != null);
  const lastPost = posts.length ? Math.max.apply(null, posts) : null;
  const sessions = readSessions(from, Math.max(to || 0, lastPost || 0) + cap);
  const cov = coverageOf(good, rows, sessions, { ignored });
  const lines = [];

  lines.push('# Overnight run' + (from ? ' · ' + dayClock(from) + ' → ' + (to ? dayClock(to) : '?') : ''));
  lines.push('');
  lines.push('## Coverage');
  lines.push('');
  if (window) {
    lines.push('window ' + dayClock(window.from) + ' → ' + dayClock(window.to) +
      (ignored ? ' · ' + ignored + ' from other nights ignored' : ''));
  }
  lines.push([
    'captured ' + (cov.firstPostAt ? dayClock(cov.firstPostAt) : '?') + ' → ' + (cov.lastPostAt ? dayClock(cov.lastPostAt) : '?'),
    cov.snapshots + ' snapshots',
  ].join(' · '));
  if (cov.verdict === 'complete') {
    lines.push('newest attempt ' + dayClock(cov.newest) + ' · sessions logged until ' + dayClock(cov.sessionEnd) + ' · complete');
  } else if (cov.verdict === 'truncated') {
    lines.push('newest attempt ' + dayClock(cov.newest) + ' · sessions logged until ' + dayClock(cov.sessionEnd) + ' · ' +
      dur(cov.missingMs) + ' unaccounted — ' +
      (cov.stopped === 'capture'
        ? 'the capture stopped at ' + (cov.lastPostAt ? clock(cov.lastPostAt) : '?')
        : 'posts kept landing, but no attempt was recorded after ' + clock(cov.newest)));
  } else {
    lines.push('newest attempt ' + (cov.newest ? dayClock(cov.newest) : '?') + ' · no session row to bound the night');
  }
  lines.push('');
  lines.push([
    rows.length + ' attempts (' + merged.repeated + ' repeated rows merged' + (outside ? ' · ' + outside + ' outside the window' : '') + ')',
    trimmedIssues(picked).length + ' unreadable',
    storeErrors + ' store errors',
  ].join(' · '));
  lines.push('');
  lines.push('## Catch rate');
  lines.push('');
  lines.push([
    run.attempts + ' attempts',
    run.caught + ' caught',
    run.lost + ' lost',
    pct(run.catchRate) + (ci ? ' (Wilson 95% ' + pct(ci.lo) + '-' + pct(ci.hi) + ')' : ''),
  ].join(' · '));
  lines.push([
    run.presses + ' presses',
    run.accepted + ' accepted',
    run.rejected + ' rejected',
    pct(run.pressAcceptRate),
    run.pressesPerCatch != null ? run.pressesPerCatch + '/catch' : '-',
  ].join(' · '));
  if (from && to && run.attempts > 1) {
    lines.push('');
    lines.push('Night span ' + dur(to - from) + ' · ' + (run.attempts / Math.max(1, (to - from) / 3600000)).toFixed(1) + ' attempts/hour · median attempt ' + (run.meanAttemptMs ? Math.round(run.meanAttemptMs / 1000) + ' s' : '-'));
  }

  lines.push('');
  lines.push('## By width band');
  lines.push('');
  lines.push('| band | attempts | caught | lost | rate |');
  lines.push('| :--- | ---: | ---: | ---: | ---: |');
  for (const b of run.widths) lines.push('| ' + b.band + ' | ' + b.attempts + ' | ' + b.caught + ' | ' + b.lost + ' | ' + pct(b.attempts ? b.caught / b.attempts : null) + ' |');

  lines.push('');
  lines.push('## Losses');
  lines.push('');
  const lossKeys = Object.keys(losses).sort((a, b) => losses[b] - losses[a]);
  lines.push(lossKeys.length ? lossKeys.map((k) => '- ' + k + ' × ' + losses[k]).join('\n') : '- none');

  lines.push('');
  lines.push('## Did anything stall?');
  lines.push('');
  if (!found.length) lines.push('No gap over ' + dur(GAP_MS) + ' between attempts.');
  else {
    lines.push(found.length + ' gap(s) over ' + dur(GAP_MS) + ', longest ' + dur(found[0].ms) + ' at ' + dayClock(found[0].from) + ' → ' + clock(found[0].to));
    for (const g of found.slice(0, 5)) lines.push('- ' + dayClock(g.from) + ' → ' + clock(g.to) + ' (' + dur(g.ms) + '), ' + g.ms + ' ms, after attempt #' + g.after);
  }
  if (hourKeys.length) {
    lines.push('');
    lines.push('Attempts per hour: ' + hourKeys.map((h) => String(h).padStart(2, '0') + 'h ' + hours[h]).join(' · '));
  }
  lines.push('');
  lines.push('Cut reasons: ' + (Object.keys(cuts).length ? Object.entries(cuts).map(([k, v]) => k + ' × ' + v).join(', ') : 'none recorded'));
  lines.push('Doctor verdicts seen: ' + (Object.keys(doctors).length ? Object.entries(doctors).map(([k, v]) => k + ' × ' + v).join(', ') : 'none recorded'));

  if (last.perf) {
    const p = last.perf;
    lines.push('');
    lines.push('## Perf at the last snapshot');
    lines.push('');
    lines.push([
      'fps ' + (p.fps == null ? '-' : p.fps),
      'p50 ' + (p.p50 == null ? '-' : p.p50 + ' ms'),
      'p95 ' + (p.p95 == null ? '-' : p.p95 + ' ms'),
      'worst ' + (p.worst == null ? '-' : p.worst + ' ms'),
      'readback ' + ((p.readback && p.readback.path) || (p.snapshot && p.snapshot.path) || '-'),
    ].join(' · '));
  }

  lines.push('');
  lines.push('## Sessions fishserve logged');
  lines.push('');
  if (!sessions.length) lines.push('_none in this window_');
  else {
    lines.push('| ended | minutes | catches | reason |');
    lines.push('| :--- | ---: | ---: | :--- |');
    for (const s of sessions) lines.push('| ' + dayClock(s.time) + ' | ' + s.minutes + ' | ' + s.catches + ' | ' + s.reason + ' |');
  }
  lines.push('');
  return { text: lines.join('\n'), coverage: cov, snapshots: picked };
}

/** The page itself, for callers and tests that only want the text. */
function report(snapshots, opts) {
  return analyze(snapshots, opts).text;
}

function trimmedIssues(snapshots) {
  return snapshots.filter((s) => s.error).map((s) => path.basename(s.file) + ': ' + s.error);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log([
      'usage: node scripts/overnight-report.js [--all | --hours N | --since ISO] [file.json ...]',
      '',
      '  default        the last 12 hours ending with the newest snapshot',
      '  --hours N      change that window',
      '  --since ISO    start at an explicit time instead (e.g. 2026-11-17T18:00:00Z)',
      '  --all          merge every snapshot in the directory, as before',
      '  file.json ...  read exactly these files, with no window',
    ].join('\n'));
    return;
  }
  const files = [];
  const opts = { night: true };
  let bad = '';
  for (let i = 0; i < args.length && !bad; i++) {
    const a = args[i];
    if (a === '--all') opts.night = false;
    else if (a === '--hours') {
      const n = Number(args[++i]);
      if (!(n > 0)) bad = '--hours needs a positive number';
      else opts.hours = n;
    } else if (a === '--since') {
      const at = Date.parse(args[++i]);
      if (!Number.isFinite(at)) bad = '--since needs a date, e.g. 2026-11-17T18:00:00Z';
      else opts.since = at;
    } else if (a.startsWith('--')) bad = 'unknown option ' + a;
    else files.push(a);
  }
  if (bad) {
    console.error(bad + ' (try --help)');
    process.exitCode = 2;
  } else {
    if (files.length) opts.night = false;   // an explicit file list is the night
    const targets = files.length ? files : [process.env.FISHSERVE_RUNS || path.join(ROOT, 'data', 'runs')];
    const snapshots = loadSnapshots(targets);
    if (!snapshots.length) {
      console.error('no snapshots in ' + targets.join(', ') + ' - run scripts/overnight-export.js in the page, or paste data/runs here');
      process.exitCode = 1;
    } else {
      const result = analyze(snapshots, opts);
      console.log(result.text);
      const issues = trimmedIssues(result.snapshots);
      if (issues.length) {
        console.error('unreadable: ' + issues.join('; '));
        process.exitCode = 1;
      }
      if (!result.coverage) process.exitCode = 1;
      else if (result.coverage.verdict === 'truncated') process.exitCode = 1;
    }
  }
}

module.exports = {
  analyze, coverageOf, gaps, loadSnapshots, mergeAttempts, nightCapMs, perHour, report, runSummary,
  selectNight, snapshotTime, toAttempts, wilson,
};
