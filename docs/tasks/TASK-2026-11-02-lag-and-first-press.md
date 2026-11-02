# Task: Lag under load and the held first press

Spec: none — measured in the live tab; decisions recorded here, in `AUTOFISH.md` and `docs/STATE.md`
Level: 2 (Controlled) · Owner: lead · Started: 2026-11-02 · Status: in review

## Objective

Two reported symptoms, one session: (1) the page lags and freezes seconds after **Start**; (2) the
bot sometimes takes a rotation or more before it presses the dial, which the owner reads as "it
should press when the wedge reaches the orange pin", suspected to be worse on high-tier fish.

## Evidence (live, BrowserOS neo, 1179x821, 3.9.9, 678 s uptime, bot running)

| Measurement | Value |
| :--- | ---: |
| fps / p50 / p95 / **worst frame** | 106.8 / 7 / 12.2 / **286.8 ms** |
| readback path | **27,906 GL reads, 0 2D** — the allocation-free path was live |
| allocation | **1,384 MB over 678 s = 2.04 MB/s** |
| detector cost | findBubble 55.3, sample 29.7, snapshot 28.8, findCatch 25.1, lockDial 21.9 ms/s |
| dials / first press held / **forced** | 18 / **9** / **2** |
| presses accepted | 51 / 51, catch 9 of 10 attempts |

A probe in the same tab measured the quarter-scale snapshot (294x205) both ways: `getImageData`
1.65 ms, versus a WebGL upload + `readPixels` round trip at **1.30 ms, byte-identical on 6,762
sampled pixels, no row flip**.

## Root causes

1. **The freeze is garbage, not a slow detector.** `downscale()` called `getImageData` every scan
   tick, and a 242 KB array lands in V8 large-object space: 2 MB/s, 1.4 GB per 11 minutes, which
   shows up as the 287 ms worst frame while p95 stays at 12 ms. The 3.9.9 note itself named this
   as "the remaining garbage source".
2. **The delay is a fixed ceiling.** The first press on a narrow or fast dial waits for a mature
   spin fit for up to `firstPressMaxWaitMs` = 2500 ms. At 700 deg/s a 45 deg arc is under the pin
   for 64 ms, so that ceiling is **~4 passes** — and half the dials in the live sample held.
3. **The planner is not the problem.** `planPress`, extracted from the source and simulated at
   10-140 fps, presses **inside the window 100% of the time**, so no change was made to the press
   angle, the trigger or the margins.

## In scope

- `autofish.js`: `firstPressBudget()` in the timing core; `step()` uses it; `downscaleGl()` reads
  the quarter-scale copy through a reused buffer with a one-off pixel self-check and a 2D fallback.
- `tests/timing.test.js`: the budget test and the source guard that `step()` uses it.
- `package.json` 3.9.10, `dist/autofish.user.js` rebuilt.
- `AUTOFISH.md` section, `docs/STATE.md`, this record.

## Out of scope

- No change to `planPress`, `fitOmega`, the detection thresholds, the geometry constants or the
  panel. No change to the catch oracle.
- No change to the scan tick, the sample cadence or the detector throttles: with the allocation
  gone there is no measured case for touching them.

## Contract

- The first press may hold for at most `min(firstPressMaxWaitMs, 0.4 * width / |omega| * 1000)`.
  A missing width or rate keeps the old ceiling; the ceiling still caps.
- The quarter-scale buffer is reused only when a one-off comparison against `getImageData` agrees
  within 2% of sampled bytes; otherwise the 2D path is used for the session and logs why.
- `perf().allocMB` counts only real allocations, so the fallback stays visible.

## Acceptance

1. `node --test` passes (231) including the new budget test and the `step()` guard.
2. `firstPressBudget(45, 700)` < 30 ms and `firstPressBudget(90, null)` = 2500 ms.
3. Live, after install: `perf().readback.allocMBPerSec` < 0.1 (was 2.04) and no 2D fallback log.
4. Live, after install: `pressAcceptRate` does not fall below 0.98, and `firstPressForced` no
   longer represents multiple passes.

## Verify

- `node --test`
- `node build-userscript.js` (dist must change with this commit, not before it)
- live: `__fish.perf().readback`, `__fish.status().accuracy`, `__fish.status().logTail`

## Follow-up (3.9.11): the once-a-second stall after 3.9.10

The owner confirmed dial play was smooth on 3.9.10 and reported one remaining symptom: the page
pauses every second while waiting to reel. Measured in the live tab:

| Condition | Long tasks | fps | worst |
| :--- | ---: | ---: | ---: |
| bot running, no dial | 6 in 6 s @ 250-285 ms | 105.6 | 285 ms |
| core paused | **0** | 143.8 | 12 ms |
| `dialFallbackMs` = 0 | **0** | 143.1 | 18 ms |

Root cause: `dialAnywhere()` - a ~257k-test annulus sweep costing 250-300 ms, throttled to 900 ms,
firing forever whenever nothing has locked for 2.5 s (i.e. the whole wait-for-a-bite phase), and
allocating a 705 KB rim mask per blob. Fixed by backing the cadence off (900 ms doubling, cap 6 s)
with a reset on a cast / a normal lock / a recovery hit, and by reusing the mask buffer.
