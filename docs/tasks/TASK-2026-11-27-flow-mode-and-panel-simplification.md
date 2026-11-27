# Task: Flow Fishing Mode & Panel Simplification

Level: 2 (Controlled) · Owner: lead · Created: 2026-11-27 · Status: done · TDD Enforcement Mode: disabled

## Objective

Add a nonstop **`Flow`** fishing mode (`mode: 'flow' | 'timed'`), retire **`Fast first press`** from the panel UI, keep **`Cozier popup`**, and merge **`Send catches to CSV` + `Overnight capture`** into a single **`Local capture`** toggle backed by `fishserve`.

## Specification

- RFC: [2026-11-27-flow-mode-and-panel-simplification.md](../specs/2026-11-27-flow-mode-and-panel-simplification.md) (`PLAN-flow-mode-panel`)

## In Scope

- `M1`: `session.js` (`mode: 'flow' | 'timed'`), `src/loop.js` (`maxMinutes > 0` guard), `autofish.js` (`F.tune({ maxMinutes, logUrl })`), `types.d.ts`, and reducer/simulator tests.
- `M2`: `panel.js` (`Mode` switch, hiding 5 timed-only controls in `Flow`, elapsed `Timer`/`Today` formatting, retiring `Fast first press` toggle + amber note, keeping `Cozier popup`, merging `Local capture` with Expand-Contract pref migration), and `tests/panel.test.js`.
- `M3`: Rebuild `dist/autofish.user.js`, run full verification (`tsc --noEmit`, `node --test`, `check-doctor.sh`), sync docs (`README.md`, `AUTOFISH.md`, `docs/STATE.md`), and live BrowserOS Neo check.

## Explicit Non-Goals

- Disabling safety guards (`seat`, `profile-open`, `player-block`, `result-missing`, `core-crash`, `Pause in focus sessions`, `blindWarning`) in `Flow` mode.
- Removing `Cozier popup` (`hideUpsell`) or console-only `F.tune({ fastFirstPress })`.
- Changing `fishserve.js` routes or CSV/JSON file formats, or publishing a GitHub release (`pk:ship`).

## Dependencies, Risk & Execution Policy

- **Dependencies**: Built on `ff5657d` (M4 modular core + live BrowserOS Neo baseline).
- **Risk & Mitigation**: `tests/panel.test.js` and `tests/session.test.js` have pre-existing CRLF/mode diffs in the workspace (preserve clean diffs on touched hunks only); default `mode` to `'timed'` in `session.js` `DEFAULTS` and Expand-Contract `localCapture` migration in `loadPrefs()` so existing profiles upgrade silently without data loss.
- **Execution Policy**: `Gated Mode` — await RFC approval & grill confirmation before starting `M1`.

## Acceptance Criteria

1. `AC-1 (Flow Mode Engine)`: In `mode: 'flow'`, `session.js` never stops for `duration`, `daily-cap`, or `window`, enters `'idle'` directly on user `stop` (no cooldown), passes `maxMinutes: 0` to `startCore`, and `src/loop.js` does not stop on `maxMinutes <= 0` — while all safety guards still pause/stop normally.
2. `AC-2 (Timed Mode Parity)`: In `mode: 'timed'`, all existing duration, cooldown, daily cap, clock window, and auto-chain tests pass unchanged.
3. `AC-3 (Panel Cleanup & Cozier Retained)`: `Fast first press` toggle and `.fastnote` are removed from `panel.js`; `Cozier popup` stays intact; `Flow` mode hides `Session`, `Cooldown`, `Daily time cap`, `Clock window`, and `Auto-start next run` and shows elapsed `Timer`/`Today` values.
4. `AC-4 (Unified Local Capture)`: One `Local capture` toggle controls both `POST /catch` (`logUrl`) and 5-minute `/overnight.js` snapshots via one `fishserve` origin, live-tuning a running core and migrating legacy `postCatches`/`overnight` prefs automatically.
5. `AC-5 (Verification & Docs)`: `npm run typecheck`, `node build-userscript.js`, `node --test`, and `bash .promptkit/scripts/check-doctor.sh` all exit `0`, with docs synced.
