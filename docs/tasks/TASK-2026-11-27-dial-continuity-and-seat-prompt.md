# Task: dial lock continuity, 12-press cap, and off-center seat prompt detection

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-27 · Status: live-verified; ready for commit/release

## Objective

Eliminate the live accuracy, multi-turn stall, and off-center seat-freeze regressions observed in BrowserOS Neo (`v3.9.63`):
1. Prevent `F.sample()` from dropping dial locks mid-fish when a newly spawned triangle jumps >90° after a press (`doPress()`).
2. Re-arm `F.armed` before `planPress()` so newly proven triangles can press on the same frame without a 1-frame miss.
3. Raise `maxPressPerDial` above 12 (with a consecutive-rejected safety cap) so high-tier fish taking 13+ accepted presses do not stall until `idle` escape.
4. Enable off-center pier seats (`y=580`) to get first-class `box` prompt detection via `seatPromptBox`, dial-lock `F.hint` sync, and `glyphMetrics`-verified `bubbleAnywhere()` Space casts.

## Evidence that it is needed

- Live snapshots (`225` exports, `1,778` attempts, `172` losses through `2026-11-27T00:16Z`):
  - **`125` of `172` losses (`72.7%`)** hit `p >= 12` (`maxPressPerDial: 12`) and stopped pressing until the 15 s escape timer (`why: "idle"`).
  - **`1,094` of `1,778` attempts (`61.5%`)** dropped and re-locked dials mid-fish (`453` locks for `250` fish, `951` 1-press locks, `162` forced first presses).
  - **`83` of `172` losses** came from off-center seat `(610, 580)` where `promptBox()` missed `CAST!` (`promptChannel: "anywhere"`), followed by a 46-minute `not-seated` freeze with `CAST!` visibly on screen and `snapshot.canvas2d` fallback (`55,554` frames).

## In Scope

- `autofish.js` (`doPress`, `F.sample` interaction, `step()` re-arm order, `maxPressPerDial` + `dialRejected` guard, `seatPromptBox`, `bubbleGate`/`bubbleInBox`, `bubbleAnywhere` `glyphMetrics`, `lockDial` `F.hint` update, `downscaleGl` bounded recovery)
- `tests/timing.test.js`, `tests/dial.test.js`
- `dist/autofish.user.js` (rebuilt via `node build-userscript.js`)

## Explicit Non-Goals

- Changing `promptBox(cw, ch)` reference geometry or relaxing the nearby-player guard (`bubbleConfirmed` continues to refuse `via: 'anywhere'` taps).
- Version bump, release tag, or public mirror publish (deferred to explicit `pk:ship` confirmation).

## Acceptance Criteria

1. `AC-1`: `doPress()` clears `F.geo._mid`, `F.geo._mt`, `F.geo._om`, and `F.geo._fit` so a >90° post-press spawn stays locked instead of failing 4 frames and dropping `F.geo`.
2. `AC-2`: `spawnProven` / `rearmReady` executes before `planPress()` in `step()`.
3. `AC-3`: `F.opts.maxPressPerDial` defaults to `30` (with consecutive-rejected guard) so 13+ accepted presses continue cleanly.
4. `AC-4`: `seatPromptBox(geo, cw, ch)` covers an off-center seat above `F.lastGeo`, `F.hint` updates on dial lock, `bubbleAnywhere()` attaches `glyphMetrics`, and `glyph === true` `anywhere` prompts cast with `space` on rung 1 without tapping.
5. `AC-5`: `node build-userscript.js` and `node --test` exit `0` with all new and existing tests passing.

## Live Verification (BrowserOS Neo, 2026-11-27)

- Build served from `http://127.0.0.1:8731/autofish.user.js` (sha256 `5fa59632…`, `408,438` bytes) and confirmed running via `export-2026-11-27T00-31-42-128Z.json` (`maxPressPerDial: 30`, `maxRejectedPerDial: 5`).
- Snapshot `export-2026-11-27T00-36-43-124Z.json` + `/recent?n=10` (00:34:44Z–00:39:12Z):
  - **Multi-lock churn**: **`0/9` (`0.0%`)** vs `1,094/1,778` (`61.5%`) before the fix — every fish held a single continuous lock (`d: 1`), `8/9` caught in the snapshot + 10 catches posted to `/recent?n=10`.
  - **Press acceptance & prediction**: `46/46` presses accepted (`100%`), `38/46` (`82.6%`) `settled` vs `8` `assumed`; `p50 = 0.9° / 5.4 ms`, `p95 = 3.2° / 12.7 ms`.
  - **Off-center pier seat (`609, 578`)**: promoted to `promptChannel: "box"` (`glyph: true`), `doctor: waiting-bite (ok)`, `sinceBubbleMs: 2979 ms`.
  - **Perf**: `143.1 fps`, `p50 7 ms`, `p95 8.2 ms`, `worst 16.1 ms`, `snapshot: { gl: 4866, canvas2d: 0 }`, `readback: { gl: 11005, canvas2d: 0, allocMBPerSec: 0 }`.
