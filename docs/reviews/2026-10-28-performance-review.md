# Performance review — autofish 3.3.0 in the live game (2026-10-28)

Scope: `autofish.js` / `panel.js` as they actually run in the user's browser tab
(BrowserOS neo, `https://app.lofi.town/?ref=home_hero`, 1459x954 @ dpr 1, two canvases,
353 players on screen). Goal: explain the "laggy / slowing down" feeling and rank the fixes.

Method (all measured, nothing guessed):

1. Frame pacing sampled with `requestAnimationFrame` deltas for 10 s and 20 s windows.
2. `CanvasRenderingContext2D.prototype.getImageData` wrapped temporarily to count calls,
   time each call and attribute it by read box (restored afterwards; the tab was left as found).
3. Each read box was then benchmarked standalone on the live UI layer at 1x, 1/2 and 1/4 scale.
4. Source read for the throttles and the hot loops (`readUI`, `findBubble`, `findCatch`,
   `lockDial`, `sample`, `step`).

## What the numbers say

| Measurement | Value |
| --- | --- |
| Canvas readbacks | **38–40 per second** |
| Cost per readback | 2.7–3.1 ms (synchronous) |
| Total read cost | **107–117 ms per second ≈ 11–12 % of one core**, continuously |
| Frame rate with the bot running | 86–96 fps |
| Frame time | p50 7 ms, **p95 35–42 ms, p99 63 ms, max 160 ms** |
| Long tasks | 4 per 10 s, 210 ms total |
| JS heap | 205 MB (the game, not the bot) |
| `__fish.log()` (panel ledger read, 1 Hz) | 0.01 ms — free |
| Bot state caps | events 600, catches 400, attempts 200 — **no leak** |

Read budget by box (6 s attribution window):

| Box | Rate | Who reads it | ms/s |
| --- | --- | --- | --- |
| 360x210 | 20/s | `findBubble` → `bubbleInBox` (40 ms idle / 90 ms locked) | ~60 |
| 365x405 | 8/s | `findCatch` → `cardInBox` (`cardCheckMs` 100) | ~26 |
| 240x240 | 8/s | `lockDial` (`dialCheckMs` 120) | ~20 |
| 364x238 | 5/s | `downscale` for `bubbleAnywhere` / `cardByShape` | ~13 |

Per-box benchmark on the live layer — the important result:

| Read | 1x | 1/2 | 1/4 |
| --- | --- | --- | --- |
| bubble 360x210 | 3.01 ms | 2.21 ms | 1.79 ms |
| dial 240x240 | 2.44 ms | 2.46 ms | 2.01 ms |
| card 365x405 | 3.22 ms | 2.41 ms | 2.06 ms |
| whole layer 1456x952 | 18.52 ms | 5.16 ms | 2.55 ms |

**Read cost is dominated by a fixed ~2 ms GPU→CPU synchronisation, not by pixel count.**
Shrinking a box 4x saves about 1 ms. Therefore the lever is *fewer readbacks*, not smaller ones.

## Findings, ranked

### 1. The bot can stop ticking while the panel still says RUNNING (worst one)

Live capture: `status()` returned `running: true, paused: false, frames: 61909` together with
`lastTickAgoMs: 645331` (**10.7 minutes**), and a 3 s `requestAnimationFrame` sample showed
`botFramesDelta: 0`. The game was rendering; the bot's `loop()` was simply not being called —
rAF is suspended for an occluded window while `document.visibilityState` still reads `visible`.

`autofish.js:1546` only guards exceptions:

```js
function loop() {
  if (!F.running) { F._raf = null; return; }
  F._raf = requestAnimationFrame(loop);
  ...
  try { step(); } catch (e) { F.stats.errors++; L('error', ...); }
}
```

Nothing detects "no tick for N seconds". While stalled the panel kept showing RUNNING and the
panel's own session clock kept spending `fishingMs` from the budget. This is what "the bot got
laggy / did nothing" looks like from the outside, and it happens with zero CPU cost, so no amount
of scan tuning fixes it.

### 2. Every detector pays its own synchronous readback

38–40 blocking `getImageData` calls per second sit on the game's own animation frame. Each one
flushes the compositor queue for ~2–3 ms, so the game drops from ~140 fps (measured with the bot
stopped: p50 7 ms, p95 7 ms, zero long tasks) to 86–96 fps with a heavy tail while the bot runs.
Twelve per cent CPU is survivable; twelve per cent delivered as 40 separate 3 ms stalls inside the
render loop is what a player feels as stutter.

### 3. Two surface grabs per tick, with overlap

`findCatch` runs `cardInBox` (full-res 365x405) **and** `cardByShape` (whole-layer 1/4 read).
`findBubble` runs `bubbleInBox` (full-res 360x210) **and** `bubbleAnywhere` (whole-layer 1/4 read).
Two different detectors each pull their own copy of the same pixels, at up to 25 Hz.

### 4. Per-call garbage in the hot path

- `rimMask` (`autofish.js:1059`) allocates `new Uint8Array(r.w * r.h)` every call — 57.6 KB per
  `lockDial` attempt, ~8/s.
- `bubbleInBox` allocates `new Array(w).fill(0)` (360 slots) every call, 20/s.
- `L()` builds an object per event, 600-entry ring.

None of these is the main cost (reads are), but they are free to remove.

### 5. Tail latency is not all the bot

p95 35–42 ms appeared both with the bot reading 40 times a second **and** during the 10-minute
period when it was not running at all. The game itself (205 MB heap, 350+ avatars) produces multi
hundred-ms long tasks. Honest attribution: the bot adds a steady ~12 % CPU and ~3 ms per frame
slice; it does not explain the worst spikes.

## Proposed refactor, smallest useful first

**A. Watchdog (≈15 lines, no CPU).** Record `F.lastTickAt` in `step()`; a 1 s `setInterval`
compares it with `now()`. If the loop is running but has not ticked for > 2 s: set
`F.stalled = true`, log `loop stalled` once, stop charging session time, and re-arm
`requestAnimationFrame(loop)` (a fresh rAF request is what recovers a suspended loop). The panel
shows a red "loop stalled" line instead of a lying RUNNING badge. Test: source-level assertion plus
a simulated frozen loop driving the watchdog.

**B. One grab per tick (the real win).** Add a tiny `grab()` service: at most one full-layer
1/4-scale read per *scan tick* (15 Hz = 2.55 ms → ~38 ms/s) shared by `bubbleAnywhere`,
`cardByShape` and the cheap presence checks; a full-res read only when a candidate must be refined
(the bubble's exact centre, the dial's wedge). Expected: **117 → ~45 ms/s at idle**, and the
20 Hz full-res bubble read disappears entirely. Dial sampling keeps its own read but drops to a
30 Hz cadence (`sampleHz`), which the existing crossing prediction already tolerates.

**C. Name the throttles.** `sampleHz`, `bubbleHz`, `cardHz`, `lockHz` in `F.opts` with the current
values as defaults, plus a hard readback budget guard (skip a scan if the last second exceeded
N ms). This is what makes "performance" tunable instead of hardcoded.

**D. Reuse buffers.** One module-level `Uint8Array` scratch resized to the largest box, reused by
`rimMask`; a reused `Uint16Array` column counter in `bubbleInBox`.

**E. Make it visible.** Expose `__fish.perf = { reads, readMs, perSec }` (already measured in this
review by wrapping `getImageData`) so the panel can show a cheap "scan 12 %" chip and a regression
is noticed instead of felt.

Nothing here changes fishing logic or the Cozier behaviour documented in `AUTOFISH.md`.

## Out of scope

- The game's own rendering cost (not actionable from a userscript).
- The Cozier focus-session gate (measured separately; not a performance issue).
