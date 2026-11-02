# Task: doctor() — the bot names its own condition

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-02 · Status: in review

## Objective

One call that answers "is it fishing, and if not, why" from state the bot already collects — so the
failure classes this project keeps paying for are named instead of inferred from a console.

## Evidence that it is needed

Three of the four incidents this month were invisible from outside:

| Incident | What the bot said | What a doctor would have said |
| :--- | :--- | :--- |
| 3.9.10 snapshot path never engaged | nothing (`canvas2d: 0` looked healthy) | `snapshot-fallback` |
| 3.9.11 one 250-285 ms stall per second | nothing | `frame-stalls` |
| 3.9.9 first press held ~4 rotations | `firstPressHeld` count only | `timing-held` |
| loop stalled 10.7 min (2026-10-28) | nothing until `status()` was read | `loop-stalled` |

## Contract

- `doctor(state)` is pure: no DOM, no timers, no readbacks, no allocation per call.
- `__fish.doctor()` assembles the state and returns `{ verdict, severity, action, evidence }`.
- Priority order is fixed: idle -> loop-stalled -> page-hidden -> paused -> path-silent ->
  snapshot-fallback -> readback-allocating -> frame-stalls -> not-seated -> press-rejected ->
  timing-held -> fishing / waiting-bite -> detector-blind.
- Waiting for a bite is never a finding; a blind detector is only claimed after 45 s of silence.
- `perf().longtasks` counts long tasks from outside the loop (PerformanceObserver, no readback).

## Acceptance

`tests/doctor.test.js` replays the real states — that is the whole point:

1. 3.9.10 state (`snapshot.gl: 0`, `canvas2d: 320`) -> `snapshot-fallback`, severity high.
2. 3.9.11 state (`longtasks.inLast10s: 10`, `maxMs: 285`) -> `frame-stalls`.
3. 3.9.9 state (`holdOverTransitMax: 39`) -> `timing-held`.
4. Healthy 3.9.12 state -> `fishing` / `waiting-bite`, severity ok, no false positive.
5. A 12 s silence -> `waiting-bite`; a 90 s silence -> `detector-blind`.
6. Three rejected presses are not a finding; 18 of 24 is.

## Verify

- `node --test` (241)
- `node build-userscript.js` at 3.9.13
- live: `__fish.doctor()`, `__fish.perf().longtasks`, and a high-severity verdict taking the panel chip

## Out of scope

- No new readbacks, no new timers, no retry logic, no auto-repair. doctor() reports; it never acts.
- No change to detection, timing or the catch oracle.
