# Task: AutoFish control panel

Spec: [2026-10-27-in-game-panel-design.md](../specs/2026-10-27-in-game-panel-design.md) · Plan: [2026-10-27-autofish-panel.md](../superpowers/plans/2026-10-27-autofish-panel.md)

Goal: replace "paste this into the DevTools console" with an in-game panel offering Start/Stop, bounded sessions, a clock window, safety guards, and a session log. Three phases:

1. **Foundations** — `session.js` reducer (task 1), server records (task 2), core hooks in `autofish.js` (task 3), placement math (task 4). All unit-tested under `node --test`.
2. **Panel** — shadow-DOM HUD (5), session length and clock window (6), guards and session log (7), wake lock and reload survival (8).
3. **Entry point** — bookmarklet page and userscript (9), docs and state (10).

Non-goals: multi-account support, a second browser tab as the control surface, any change to the catch detector or its thresholds.
