# Docs

| File | What it is |
| :--- | :--- |
| [STATE.md](STATE.md) | Living project tracker: current position, locked invariants, decisions, next actions, continuity log. |
| [specs/2026-10-28-catch-log.md](specs/2026-10-28-catch-log.md) | Approved spec for the local catch ledger, embedded catalogue and rarity strip. |
| [specs/2026-11-18-overnight-capture.md](specs/2026-11-18-overnight-capture.md) | Contract for overnight capture (3.9.45-3.9.47): origin resolution, self-healing, the amber address line, row controls and the morning report's coverage verdict. |
| [specs/2026-11-19-3.9.52-held-forced-prereg.md](specs/2026-11-19-3.9.52-held-forced-prereg.md) | Pre-registered read-only telemetry plan for 3.9.52: metrics, strengthened sample, one-sided 95% Wilson bound, and the 20% cap retirement rule. |
| [specs/2026-11-27-jsdoc-typecheck-and-architecture.md](specs/2026-11-27-jsdoc-typecheck-and-architecture.md) | Implementation plan (RFC) for incremental JSDoc + `tsc --noEmit` type-checking, optional sentinel modularization, headless `step()` simulator, CI, and docs updates. |
| [specs/2026-11-27-m4-modular-core-and-simulator.md](specs/2026-11-27-m4-modular-core-and-simulator.md) | Architecture & execution RFC (`PLAN-m4-modular-core`) for extracting `autofish.js` sentinels into `src/` UMD modules, shared `fishserve`/build assembly, and headless `step()` simulator. |
| [specs/2026-11-27-flow-mode-and-panel-simplification.md](specs/2026-11-27-flow-mode-and-panel-simplification.md) | Architecture & execution RFC (`PLAN-flow-mode-panel`) for nonstop `Flow` mode, retiring `Fast first press` from UI, keeping `Cozier popup`, and unifying `Local capture`. |
| [specs/2026-11-28-trophy-alerts-and-local-dashboard.md](specs/2026-11-28-trophy-alerts-and-local-dashboard.md) | Architecture & execution RFC (`PLAN-trophy-alerts-dashboard`) for rare catch chimes, 24h IndexedDB trophy card viewer, clickable update badge, `fishserve` web dashboard, CSV export, and field reliability fixes. |
| [specs/2026-10-27-in-game-panel-design.md](specs/2026-10-27-in-game-panel-design.md) | Panel design spec: intent, goals, anti-goals, and the control surface chosen on 2026-10-27. |
| [tasks/autofish-panel.md](tasks/autofish-panel.md) | Task record for the panel milestone (T1-T10, acceptance criteria). Its design spec is [specs/2026-10-27-in-game-panel-design.md](specs/2026-10-27-in-game-panel-design.md); its decisions live in [STATE.md §6](STATE.md). |
| [tasks/TASK-2026-10-28-catch-log.md](tasks/TASK-2026-10-28-catch-log.md) | Task record for Catch log v1, with its verify commands. |
| [tasks/TASK-2026-11-02-lag-and-first-press.md](tasks/TASK-2026-11-02-lag-and-first-press.md) | Task record for the lag and held-first-press fixes, with the live measurements that located them. |
| [tasks/TASK-2026-11-02-autofish-doctor.md](tasks/TASK-2026-11-02-autofish-doctor.md) | Task record for `doctor()`, the verdict that names why the bot is or is not fishing. |
| [tasks/TASK-2026-11-02-quotable-run.md](tasks/TASK-2026-11-02-quotable-run.md) | Task record for `exportRun()`, the per-run store and the interval maths a headline is quoted from. |
| [tasks/TASK-2026-11-02-narrow-band.md](tasks/TASK-2026-11-02-narrow-band.md) | Task record for the narrow band: the press gate that arrived closed, and the per-dial telemetry that proves it. |
| [tasks/TASK-2026-11-02-press-error.md](tasks/TASK-2026-11-02-press-error.md) | Task record for per-press timing error: how far from the window a press landed, in degrees. |
| [tasks/TASK-2026-11-18-overnight-capture.md](tasks/TASK-2026-11-18-overnight-capture.md) | Task record for overnight capture and address correction, with acceptance and live evidence. |
| [tasks/TASK-2026-11-18-install-3.9.51.md](tasks/TASK-2026-11-18-install-3.9.51.md) | Post-night install checklist for 3.9.51: restart fishserve first, install the userscript second, and the counters that prove the re-arm change. |
| [tasks/TASK-2026-11-27-dial-continuity-and-seat-prompt.md](tasks/TASK-2026-11-27-dial-continuity-and-seat-prompt.md) | Task record for fixing mid-fish >90° lock drops, 12-press cap losses, re-arm lag, and off-center seat prompt freezes. |
| [tasks/TASK-2026-11-27-jsdoc-typecheck.md](tasks/TASK-2026-11-27-jsdoc-typecheck.md) | Task record for incremental JSDoc + `tsc --noEmit` typing (M1–M3), CI, and docs alignment (M5). |
| [tasks/TASK-2026-11-27-m4-modular-core.md](tasks/TASK-2026-11-27-m4-modular-core.md) | Task record for M4 `src/` modular core extraction, test/script migration, and headless `step()` simulator. |
| [tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md](tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md) | Task record for nonstop `Flow` fishing mode, retiring `Fast first press` UI, and unified `Local capture` toggle. |
| [tasks/TASK-2026-11-28-trophy-alerts-and-local-dashboard.md](tasks/TASK-2026-11-28-trophy-alerts-and-local-dashboard.md) | Task record for rare catch chimes, 24h IndexedDB trophy viewer, update badge, `fishserve` dashboard, and false-loss / retention fixes. |
| [tasks/TASK-2026-11-28-daily-missions-scoping.md](tasks/TASK-2026-11-28-daily-missions-scoping.md) | Task record scoping the lofi.town daily-missions bot: directions D1-D3, the Cozier paywall as a hard constraint, assumption records, and the M0-M2 milestone sketch. |
| [tasks/TASK-2026-11-28-daily-missions-scoping.scope-1.md](tasks/TASK-2026-11-28-daily-missions-scoping.scope-1.md) | Scope change record: added the docs index rows this suite requires for the missions-scoping task record. |
| [tasks/TASK-2026-11-28-missions-awareness-d1.md](tasks/TASK-2026-11-28-missions-awareness-d1.md) | Task record for read-only daily-mission awareness (D1): Quests DOM parser, folded panel section, capture snapshot, and `/dashboard` display. |
| [reviews/2026-10-27-panel-verification.md](reviews/2026-10-27-panel-verification.md) | Panel verification review: observed versus reasoned. |
| [reviews/2026-11-18-capture-address-live.md](reviews/2026-11-18-capture-address-live.md) | Live verification of capture arming and stale-address correction in the real game, with the closed shadow root and the failed-POST bug. |
| [reviews/2026-11-23-catch-and-focus-live.md](reviews/2026-11-23-catch-and-focus-live.md) | Live verification of the rebuilt userscript's catch POST, focus takeover, seat warning and next catch. |
| [reviews/2026-11-27-m4-modular-core-live.md](reviews/2026-11-27-m4-modular-core-live.md) | Live BrowserOS Neo verification of the M4 modular core (`src/*.js` globals, `10/10` catches, `53/53` presses accepted, `143.1 fps`, WebGL `0` fallbacks). |
| [reviews/2026-10-27-event-card-freeze.md](reviews/2026-10-27-event-card-freeze.md) | Review of the stuck catch-card bug and its fix. |
| [reviews/2026-10-28-performance-review.md](reviews/2026-10-28-performance-review.md) | Performance review: where the frame budget actually goes, the findings ranked, and the smallest useful fixes. |
| [reviews/2026-11-02-lag-and-first-press-review.md](reviews/2026-11-02-lag-and-first-press-review.md) | Two-axis review of the 3.9.10-3.9.12 work, including the snapshot path that silently never ran. |
| [images/](images/) | README screenshots from the live Flow + Local capture UI (`in-game.jpg`, `panel.jpg`, `panel-folded.jpg`), plus the 3.9.47 capture states (`capture-armed-3.9.47.png`, `capture-stale-3.9.47.png`). |

## Releases

| File | What it is |
| :--- | :--- |
| [releases/3.9.66.md](releases/3.9.66.md) | 3.9.66: Rare catch chime, 24h IndexedDB trophy viewer, 1-click CSV, fishserve `/dashboard`, bounded reload recovery, and UI/ARIA polish. |
| [releases/3.9.65.md](releases/3.9.65.md) | 3.9.65: Flow nonstop mode, unified Local capture, M4 modular core (`src/`), JSDoc type-checking, and hot-path perf cleanups. |
| [releases/3.9.64.md](releases/3.9.64.md) | 3.9.64: dial lock continuity across >90° spawns, 30-press dial cap, off-center seat prompt box, and WebGL snapshot recovery. |
| [releases/3.9.63.md](releases/3.9.63.md) | 3.9.63: guard and blind diagnostics in the overnight export and morning report. |
| [releases/3.9.62.md](releases/3.9.62.md) | 3.9.62: combined 3.9.57-3.9.62 release. |
| [releases/3.9.56.md](releases/3.9.56.md) | 3.9.56: catch upload and focus/seat behavior patch. |
| [releases/3.9.55.md](releases/3.9.55.md) | 3.9.55: daily budget across midnight. |
| [releases/3.9.54.md](releases/3.9.54.md) | 3.9.54: interrupted-session logging fix. |
| [releases/3.9.53.md](releases/3.9.53.md) | 3.9.53: seat-hold deadlock fix. |
| [releases/3.9.52.md](releases/3.9.52.md) | 3.9.52: read-only first-press telemetry. |
| [releases/3.9.51.md](releases/3.9.51.md) | 3.9.51: profile-scoped session rows and press cadence. |

The lab notebook is not here: every measurement, fix and retraction lives in
[AUTOFISH.md](../AUTOFISH.md), in the order it happened. Start at "Measured facts", then read the
dated sections above it.

The earlier feasibility spike is [SPIKE.md](../SPIKE.md): what worked, the three detectors that failed
and why, and the operational constraints it confirmed.
