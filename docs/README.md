# Docs

| File | What it is |
| :--- | :--- |
| [STATE.md](STATE.md) | Living project tracker: current position, locked invariants, decisions, next actions, continuity log. |
| [specs/2026-10-28-catch-log.md](specs/2026-10-28-catch-log.md) | Approved spec for the local catch ledger, embedded catalogue and rarity strip. |
| [specs/2026-10-27-in-game-panel-design.md](specs/2026-10-27-in-game-panel-design.md) | Panel design spec: intent, goals, anti-goals, and the control surface chosen on 2026-10-27. |
| [tasks/autofish-panel.md](tasks/autofish-panel.md) | Task record for the panel milestone (T1-T10, acceptance criteria). Its design spec is [specs/2026-10-27-in-game-panel-design.md](specs/2026-10-27-in-game-panel-design.md); its decisions live in [STATE.md §6](STATE.md). |
| [tasks/TASK-2026-10-28-catch-log.md](tasks/TASK-2026-10-28-catch-log.md) | Task record for Catch log v1, with its verify commands. |
| [tasks/TASK-2026-11-02-lag-and-first-press.md](tasks/TASK-2026-11-02-lag-and-first-press.md) | Task record for the lag and held-first-press fixes, with the live measurements that located them. |
| [tasks/TASK-2026-11-02-autofish-doctor.md](tasks/TASK-2026-11-02-autofish-doctor.md) | Task record for `doctor()`, the verdict that names why the bot is or is not fishing. |
| [tasks/TASK-2026-11-02-quotable-run.md](tasks/TASK-2026-11-02-quotable-run.md) | Task record for `exportRun()`, the per-run store and the interval maths a headline is quoted from. |
| [tasks/TASK-2026-11-02-narrow-band.md](tasks/TASK-2026-11-02-narrow-band.md) | Task record for the narrow band: the press gate that arrived closed, and the per-dial telemetry that proves it. |
| [tasks/TASK-2026-11-02-press-error.md](tasks/TASK-2026-11-02-press-error.md) | Task record for per-press timing error: how far from the window a press landed, in degrees. |
| [reviews/2026-10-27-panel-verification.md](reviews/2026-10-27-panel-verification.md) | Panel verification review: observed versus reasoned. |
| [reviews/2026-10-27-event-card-freeze.md](reviews/2026-10-27-event-card-freeze.md) | Review of the stuck catch-card bug and its fix. |
| [reviews/2026-10-28-performance-review.md](reviews/2026-10-28-performance-review.md) | Performance review: where the frame budget actually goes, the findings ranked, and the smallest useful fixes. |
| [reviews/2026-11-02-lag-and-first-press-review.md](reviews/2026-11-02-lag-and-first-press-review.md) | Two-axis review of the 3.9.10-3.9.12 work, including the snapshot path that silently never ran. |
| [images/](images/) | README screenshots: the panel in-game and close up, both from the shipped 3.8.10 build. |

The lab notebook is not here: every measurement, fix and retraction lives in
[AUTOFISH.md](../AUTOFISH.md), in the order it happened. Start at "Measured facts", then read the
dated sections above it.

The earlier feasibility spike is [SPIKE.md](../SPIKE.md): what worked, the three detectors that failed
and why, and the operational constraints it confirmed.
