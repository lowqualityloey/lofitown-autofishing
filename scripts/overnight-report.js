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
const dayClock = (t) => new Date(t).toISOString().slice(0, 10) + ' ' + clock(t);
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

function readSessions(from, to) {
  const file = process.env.FISHSERVE_SESSIONS || path.join(ROOT, 'sessions.csv');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1)
    .map((line) => line.split(','))
    .filter((r) => r.length >= 5)
    .map((r) => ({ time: Date.parse(r[0]), started_at: r[1], minutes: Number(r[2]) || 0, catches: Number(r[3]) || 0, reason: r[4] }))
    .filter((r) => !from || (r.time >= from - 3600_000 && r.time <= (to || Date.now()) + 3600_000));
}

function report(snapshots) {
  const good = snapshots.filter((s) => s.data);
  if (!good.length) return 'no readable snapshots\n';
  const merged = mergeAttempts(good);
  const run = runSummary(toAttempts(merged.attempts), {});
  const timed = merged.attempts.filter((a) => a.t != null && a.t > 1e12);
  const from = timed.length ? timed[0].t : null;
  const to = timed.length ? timed[timed.length - 1].t : null;
  const found = gaps(merged.attempts, GAP_MS);
  const hours = perHour(merged.attempts);
  const hourKeys = Object.keys(hours).map(Number).sort((a, b) => a - b);
  const losses = {};
  for (const a of merged.attempts) if (a.v === 'lost') losses[a.why || 'unknown'] = (losses[a.why || 'unknown'] || 0) + 1;
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
  const sessions = readSessions(from, to);
  const lines = [];

  lines.push('# Overnight run' + (from ? ' · ' + dayClock(from) + ' → ' + (to ? dayClock(to) : '?') : ''));
  lines.push('');
  lines.push([
    good.length + ' snapshots',
    merged.unique + ' attempts (' + merged.repeated + ' repeated rows merged)',
    trimmedIssues(snapshots).length + ' unreadable',
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
  return lines.join('\n');
}

function trimmedIssues(snapshots) {
  return snapshots.filter((s) => s.error).map((s) => path.basename(s.file) + ': ' + s.error);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  // The server writes wherever FISHSERVE_RUNS points; read the same place by default.
  const targets = args.length ? args : [process.env.FISHSERVE_RUNS || path.join(ROOT, 'data', 'runs')];
  const snapshots = loadSnapshots(targets);
  if (!snapshots.length) {
    console.error('no snapshots in ' + targets.join(', ') + ' - run scripts/overnight-export.js in the page, or paste data/runs here');
    process.exitCode = 1;
  } else {
    console.log(report(snapshots));
    const bad = trimmedIssues(snapshots);
    if (bad.length) {
      console.error('unreadable: ' + bad.join('; '));
      process.exitCode = 1;
    }
  }
}

module.exports = { mergeAttempts, toAttempts, gaps, perHour, loadSnapshots, report, wilson, runSummary };
