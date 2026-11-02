# Task: where a press lands, in degrees (3.9.18)

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-02 · Status: in review

## Objective

The narrow band stopped losing fish to access when 3.9.17 opened the press gate on every dial
(presses per dial 0.4 -> 5.6). What is left cannot be seen from a catch rate: lost and caught narrow
attempts show the same presses, spin rates and durations. A press needs to report **how far from the
window it landed**, and whether it was ever measured at all.

## Contract

- Every press records: width, spin rate, the delta at the press, the plan's predicted delta at the
  judgement instant (`pred`), the window half-width (`win`), and whether `pred` was inside it.
- The first sample after the press is back-extrapolated to the judgement instant and compared with
  `pred`; the difference in degrees is `res`. This is the model error that decides a narrow miss.
- `via` says how the verdict was reached: `settled` (a frame observed the outcome) or `assumed`
  (the next press implied the game had acted). The second is an assumption and must be counted.
- `pressErrorSummary(log)` reports presses, settled vs assumed, measured, mean/p50/p95 residual,
  inside rate and mean window. `__fish.exportRun()` carries the summary and the last 80 probes.

## Acceptance

1. `node --test` passes with the summary fixtures and the wiring guards.
2. Live run: `presses.measured > 0` and `presses.settled + presses.assumed === presses.presses`.
3. The narrow rows can be read per press: `p95AbsResidual` against `meanWindowDeg` says whether a
   narrow miss is a timing error (residual near or past the window) or a count problem (residual
   small, presses accepted, fish still lost).

## Correction

The first live read reported 76.7 deg of mean error on a 40.2 deg window with every press accepted.
The instrument was wrong, not the bot: a press spawns a new triangle, so the first frame after one
shows the spawn, and back-extrapolating it to the judgement instant measures the jump. 3.9.19 removes
that measurement and measures prediction error without pressing (in degrees and milliseconds); the
press log keeps the `settled`/`assumed` split, which read 3 of 9 assumed.

## Out of scope

- No change to planPress, the trigger, marginDeg or any threshold. This release only measures.
