<a id="REVIEW-2026-11-02-lag-and-first-press"></a>
# Review: 3.9.10-3.9.12 — lag under load and the held first press

- **Review ID**: `REVIEW-2026-11-02-lag-and-first-press`
- **Review Status**: complete
- **Resolved Diff Reference**: `87e716f...8e07b1b`, plus the 3.9.12 commits on this branch
- **Review Mode**: branch / PR #12 against `origin/main`
- **Task Record**: [TASK-2026-11-02-lag-and-first-press](../tasks/TASK-2026-11-02-lag-and-first-press.md)
- **Reviewer**: lead · **Date**: 2026-11-02

## Verdict

The work is correct in direction and the tests are honest, but **3.9.10 and 3.9.11 must not ship
as they are**: the change that the 3.9.10 commit message calls "allocation-free snapshot" never
executed in the field. Found here, against the live build, not by a user report. 3.9.12 fixes it.

## Axis 1 — Spec Fidelity

**Asked**: the page lags and freezes after Start; the dial is sometimes pressed a rotation late,
worse on high-tier fish.

| Requirement | Delivered | Evidence |
| :--- | :--- | :--- |
| Stop the periodic freeze | **Yes**, by the recovery backoff, not by the snapshot | live 10 s window: 1 long task (287 ms) vs 10 before; fps 138.2, p95 11.7 |
| Stop the "extra rotation" on hard dials | **Yes** | `firstPressBudget` = 26 ms on a 45 deg / 700 deg/s dial instead of 2500 ms; live `firstPressForced` 6 of 9 held dials now fire on the first pass |
| Do not degrade press accuracy | **Unproven at scale** | live 30/30 presses accepted, 3 caught of 5 attempts, 2 lost in the mid-width band — n=5 is not a catch-rate sample |
| Allocation-free snapshot (claimed by 3.9.10) | **No — did not run** | `allocMBPerSec` 2.6 with `canvas2d: 0`; freezing `scanTickMs` drops allocation to 0.00 MB/6 s |

No scope creep: the diff touches the timing core, the snapshot reader, the recovery cadence, the
tests and the docs. `planPress`, `fitOmega`, the geometry constants, the panel and the catch oracle
are untouched, which is what the task record promised.

## Axis 2 — Standards & Code Quality

| # | Severity | Finding | Status |
| ---: | :--- | :--- | :--- |
| 1 | 🚨 BLOCKING | `framebufferTexture2D` ran before `texImage2D`, so the FBO was `INCOMPLETE_ATTACHMENT` (36054), `sglOff` was set, and the 2D fallback ran for the life of the page | **fixed in 3.9.12** (`sglAttach` allocates storage first) |
| 2 | ⚠️ IMPORTANT | The snapshot path had **no telemetry**, which is why a dead fix looked alive; `perf().readback.canvas2d` stayed 0 because the fallback in `downscale()` was not counted as a read2d | **fixed**: `perf().snapshot = { gl, canvas2d }` |
| 3 | ⚠️ IMPORTANT | `F.dialAnyFail` survived across sessions, so a new run inherited the previous run's backoff | **fixed**: reset in `F.start()` |
| 4 | ⚠️ IMPORTANT | No `isContextLost()` guard; a lost context would have returned blank pixels forever | **fixed**: falls back and logs |
| 5 | ⚠️ IMPORTANT | Accuracy after the first-press budget was unmeasured (5 attempts, `firstPressForced` 2 → 6) | **verified on 3.9.12**: 8 caught / 8 attempts, 0 lost, **43/43 presses accepted**, `firstPressHeld` 10 / `firstPressForced` 6 — forcing early did not cost acceptance |
| 6 | 💡 SUGGEST | The GL self-check compares only the red channel | open |
| 7 | 💡 SUGGEST | `dialAnywhere` is still a ~257k-test sweep; a coarse-to-fine pass would cut it ~4x | open, needs a live dial to validate recall |
| 8 | 👏 PRAISE | Every failure class here became a source guard: the budget curve, the backoff curve, the attachment order, the counter | keep |

Security: no network, no credential, no `eval`/`new Function` added, no new `localStorage` key.
Data loss: none — the ledger keys, the catch oracle and the CSV columns are untouched.

## Performance evidence (owner's tab, live)

| Measurement | 3.9.9 | 3.9.11 |
| :--- | ---: | ---: |
| long tasks in 10 s | 10 × 250-285 ms | **1 × 287 ms** |
| fps / p95 | 106.8 / 12.2 | **138.2 / 11.7** |
| presses accepted | 51/51 | 30/30 |
| `allocMBPerSec` | 2.04 | 2.57 (the dead snapshot path) — 3.9.12 targets ~0 |

## Simplification audit

One candidate: `dialAnywhere` mixes blob selection, candidate scoring and locking in 36 lines of
nested loops. It was left alone deliberately — it is a recovery path that only runs when a hint is
wrong, and restructuring it without a live mis-hinted dial to test against would trade a known-good
brute force for an unvalidated one. Recorded here rather than done.

## Verification run for this review

| Command | Result |
| :--- | :--- |
| `git diff --stat 87e716f...HEAD` | 9 files, +518/−24 (source, tests, dist, docs) |
| `node --check autofish.js` | clean |
| `node build-userscript.js` then `git diff --quiet dist/` | dist fresh |
| `node --test` | **233 pass, 0 fail** |
| `git status --porcelain` | clean |
| risky-pattern grep over the diff (`eval`, `new Function`, `fetch`, `innerHTML`, `document.write`) | no matches |

## Follow-ups

1. ~~Install 3.9.12 and read `perf().snapshot`~~ — **done live**: `{ gl: 3676, canvas2d: 0 }`, `allocMBPerSec` 0.01 (was 2.6), allocation delta **0.00 MB** over ten seconds.
2. ~~One seated session before quoting a first-press accuracy number~~ — **done**: 8/8 caught, 0 lost, 43/43 accepted on 3.9.12. Still a small sample; the long-run claim stays 103/112 from 3.8.8.
3. Release: tag `v3.9.12`, run `node scripts/release.js`, confirm the mirror asset matches.
