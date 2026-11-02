# Task: a run you can quote (3.9.14)

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-02 · Status: complete

## Objective

Make one long session produce evidence the README can cite: every fish attempt exported in one
blob, with the interval around the rate and the environment it ran in, so the accuracy headline is
recomputed from attempts instead of transcribed by hand.

## Evidence that it is needed

- The headline is still 3.8.8 (103/112). Every check since is regression evidence: 7/7, 1/1, 8/8, 1/1.
- `F.report()` slices the **last 40 attempts**, carries no interval, no timestamp and no environment.
- Attempts lived only in memory (cap 200): one reload or one lost seat destroyed the sample, and the
  3.8.8 run was itself cut by a seat loss and then the 240-minute cap.
- The Wilson arithmetic the README quotes reproduces exactly (103/112 -> 0.8543-0.9571), so it is a
  fixture to test against, not an assumption.

## Contract

- `wilson(k, n)` returns `{ p, lo, hi }` or `null`; it never returns NaN, because the export is JSON.
- `runSummary(attempts)` counts **attempts** as the denominator; press acceptance is reported beside
  it and never folded into it. Empty input returns nulls.
- `F.exportRun()` returns a JSON **string**: version, profile, timestamps, run summary, perf snapshot,
  doctor verdict, live options, and every stored attempt (deduplicated, oldest first).
- Attempts persist to `autofish:run:v1:<profile>` on every resolve, capped at 250, every write in
  `try/catch`; a storage failure sets `F.runStoreError` and never interrupts the loop.

## Acceptance

1. `wilson(103, 112)` equals 0.8543 / 0.9571 within 0.001 - the interval the README already quotes.
2. `wilson(0, 0)` is `null`; `wilson(0, 10).lo` is 0; `wilson(10, 10)` still has a lower bound.
3. `runSummary` on a synthetic set reports the right counts, rate, acceptance, per-band rows and means.
4. An empty run serialises with nulls and no `NaN`.
5. Live: `__fish.exportRun()` parses, contains every attempt, and its interval matches an
   independent recomputation.

## Result

A 3.9.15 seated session: **133 attempts, 126 caught (94.7%, Wilson 89.5-97.4%)**, 697/697 presses
accepted, 254 dials, 7 losses all scored `cast prompt`. Wide/full 52/52, mid 65/69, narrow 9/12.
The run also exposed three tooling defects, all fixed in 3.9.16: per-page attempt numbering colliding
in the merge, page-clock timestamps reaching the export, and a `timing-held` false positive.

## Verify

- `node --test` (246)
- `node build-userscript.js` at 3.9.14
- live: `copy(__fish.exportRun())` after a short run

## Out of scope

- No change to detection, press timing, the ledger or the catch oracle.
- No panel button, no upload, no chart.
