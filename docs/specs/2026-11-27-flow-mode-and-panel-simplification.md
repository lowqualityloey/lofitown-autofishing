# Technical Design Document (RFC): Flow Fishing Mode & Panel Simplification

- **Author**: lead / Antigravity
- **Status**: Implemented
- **Created**: 2026-11-27
- **Target Release**: Post-M4 (3.9.65 candidate)

---

## Planning Record (PromptKit Adaptation)

<a id="PLAN-flow-mode-panel"></a>

### Planning Record Metadata

- **Planning Record ID**: `PLAN-flow-mode-panel`
- **Planning Depth**: `Full`
- **Owner**: lead
- **Record Status**: `implemented`
- **Local Task Record Link**: `[TASK-2026-11-27-flow-mode-and-panel-simplification](../tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md)`

### Planning Inputs

- **Requested Outcome**: Add a first-class **`Flow` (nonstop until Stop)** fishing mode to `session.js` / `panel.js` / `src/loop.js`, retire the **`Fast first press`** toggle and amber warning from the panel UI, keep **`Cozier popup`**, and merge **`Send catches to CSV` + `Overnight capture`** into a single **`Local capture`** toggle backed by `fishserve`.
- **Observable Completion Condition**:
  1. Switching `Mode` to `Flow` runs nonstop until manual **Stop** (or safety guards), hides the 5 timed/scheduled rows (`Session`, `Cooldown`, `Daily time cap`, `Clock window`, `Auto-start next run`), counts elapsed time up on the surface `Timer` meter, skips cooldown on **Stop**, and passes `maxMinutes: 0` (no core timeout) to `src/loop.js`.
  2. Switching `Mode` to `Timed` preserves exact existing duration, cooldown, daily cap, clock window, and chaining behavior.
  3. `Fast first press` toggle and amber `.fastnote` are removed from `panel.js`; `F.tune({ fastFirstPress })` stays console-only in `autofish.js`/`src/timing.js`.
  4. `Cozier popup` (`hideUpsell`) stays intact.
  5. Single `Local capture` toggle enables/disables both `POST /catch` CSV logging and the 5-minute `/overnight.js` snapshot sampler via one `fishserve` origin, with seamless migration from existing `postCatches` / `overnight` prefs.
  6. `npm run typecheck`, `node build-userscript.js`, `node --test`, and `bash .promptkit/scripts/check-doctor.sh` all exit `0`.
- **Scope Boundary**:
  - **In Scope**: `session.js` (`mode: 'flow' | 'timed'`), `src/loop.js` (`maxMinutes > 0` timeout guard), `autofish.js` (`F.tune({ maxMinutes, logUrl })`), `panel.js` (Mode toggle, Flow/Timed drawer visibility, surface meter formatting, `Fast first press` UI removal, `Local capture` merge, Expand-Contract pref migration), `types.d.ts`, `tests/{session,panel,simulator,timing}.test.js`, `dist/autofish.user.js`, and docs (`README.md`, `AUTOFISH.md`, `docs/STATE.md`, `docs/README.md`).
  - **Excluded (Non-Goals)**: Changing safety guards (`seat`, `profile-open`, `player-block`, `result-missing`, `core-crash` cap, `Pause in focus sessions`, `blindWarning`), removing `Cozier popup`, altering `fishserve.js` HTTP endpoints or CSV/JSON schemas, changing dial/vision algorithms, or cutting a Tampermonkey mirror release (`pk:ship`).
- **TDD Enforcement Proposal (Reference Only)**: `disabled` (existing 436-test suite + targeted unit/simulator tests added per milestone).

### Full Planning Fields

- **Explicit Non-Goals**:
  - Do not disable safety guards in `Flow` mode: a standing character, open profile, nearby player block, missing game result, or repeated core crash must still pause/stop honestly.
  - Do not remove `Cozier popup` (`hideUpsell`).
  - Do not break existing `localStorage` profiles or `sessions.csv` / `catches.csv` / `data/runs/*.json` contracts.
  - Do not remove `fastFirstPress` from `src/timing.js` / `F.tune()` — only retire its panel UI toggle and permanent warning.
- **Affected Behavioral Components**: Session state reducer (`session.js`), core loop timeout & live tuning (`src/loop.js`, `autofish.js`), control panel UI & pref persistence (`panel.js`), shared type contracts (`types.d.ts`), built userscript (`dist/autofish.user.js`).
- **Externally Visible Contracts**:
  - `SessionState` gains `mode: 'flow' | 'timed'` (defaults to `'timed'` in `createState()` for full backwards compatibility).
  - `localStorage['autofish:prefs:v1']` expands with `mode` and `localCapture` while continuing to read legacy `postCatches` / `overnight` on load (Expand-Contract).
  - `window.__panel` exposes `localCapture` and mirrors `postCatches` / `overnight` so external console checks do not break.
- **Failure or Rollback Considerations**:
  - Defaulting `createState().mode` to `'timed'` guarantees existing callers and tests behave identically unless `'flow'` is opted into.
  - `tests/panel.test.js` and `tests/session.test.js` carry pre-existing CRLF/mode diffs in the workspace; inspect and preserve line endings cleanly before editing.
- **Verification Approach**: `npm run typecheck`, `node build-userscript.js`, `node --test`, `bash .promptkit/scripts/check-doctor.sh`, plus live BrowserOS Neo smoke check on `127.0.0.1:8731`.

### Assumption Records

- **`ASSUMPTION-flow-mode-001` (Resolved — Approved by owner 2026-11-27)**: `Stop when hidden` allows stepping down to `0` (`off` = pause-only while tab is hidden, auto-resume when tab returns for `3 s`, never hard-stops the run). `session.js` treats `hiddenStopMs === 0` as no hidden stop (`hiddenStopMs > 0` retains the existing stop timer).
- **`ASSUMPTION-flow-mode-002`**: `mode` defaults to `'timed'` in `session.js` `DEFAULTS` (preserving all existing reducer tests and conservative budget defaults for new installs), while users select `Flow` once in the panel and persist `mode: 'flow'` in `localStorage`.
  - **Owner**: lead · **Status**: provisional · **Impact if wrong**: Existing users who already cranked `12h / 24h` must click `Flow` once after upgrading · **Validation action**: Confirm in Pre-Implementation Grill Probe #2 if desired, or accept default.

### Technology and Vendor Decision Records

None — uses only existing plain JavaScript, `localStorage`, and `tsc --noEmit` contracts.

---

## 1. Problem Statement & Metrics

### User Friction Observed (2026-11-27 Live Screenshot & Telemetry)
1. **Fake-infinity workaround**: To fish nonstop until pressing **Stop**, the owner had to configure `Session: 12h 00`, `Cooldown: 1 min`, `Daily time cap: 24h 00`, and `Auto-start next run: on` — still suffering forced 1-minute cooldown pauses every 12 hours and a misleading countdown meter.
2. **Obsolete noisy warning (`Fast first press`)**: After v3.9.64 eliminated mid-fish lock drops (`d: 1` continuity), live telemetry (`250` attempts, `fastFirstPress: false`) recorded **`firstPressHeld: 0`**, **`firstPressHeldForced: 0`**, and **`narrow: 22/23` (`95.7%`)**. The toggle and permanent 2-line amber warning are now visual noise.
3. **Fragmented local server controls**: `Send catches to CSV` and `Overnight capture` both talk to the same local `fishserve` server (`127.0.0.1:8731`), creating two separate toggles for one capability.

### Target Outcomes
- **Drawer density in `Flow` mode**: Reduced from `13` rows + amber warning + time pickers down to **`7` compact rows** (`Mode`, `Stop when hidden`, `Cozier popup`, `Pause in focus sessions`, `Resume after reload`, `Local capture`, `Profile`).
- **Zero forced interruptions in `Flow` mode**: Unlimited session runtime (`maxMinutes: 0`), no daily cap stop, no cooldown on manual **Stop**.
- **Zero regression on safety guards & `Timed` mode**: `npm run typecheck` exit `0`, `node --test` `100%` pass, `dist/autofish.user.js` valid.

---

## 2. System Context & Deep Module Architecture

```text
  panel.js (UI + prefs)
    ├─ Mode: Flow | Timed ──► session.js reduce() ──► startCore({ maxMinutes: 0 | dur+2 })
    │                           ├─ Flow: skip duration / daily-cap / window / cooldown
    │                           └─ Timed: enforce all budgets & cooldowns unchanged
    ├─ Local capture (on/off) ──► single fishserve origin (BASE || captureBase)
    │                           ├─ POST /catch (logUrl synced live via F.tune)
    │                           └─ /overnight.js 5m snapshot sampler + status line
    └─ Cozier popup (kept)   ──► DOM CSS hide (unchanged)

  src/loop.js (stepFrame)
    └─ if (F.opts.maxMinutes > 0 && t - F.startedAt > F.opts.maxMinutes * 60000) stop()
```

### Deep Module Boundaries
- **`session.js`** owns all mode-dependent lifecycle rules (`start`, `tick`, `stop`, `config`):
  - Single helper `isFlow(s)` (`s.mode === 'flow'`) gates budget/window/duration/cooldown checks cleanly without duplicating state branches.
  - Switching `mode` from `timed` to `flow` while in `'cooldown'` or `'waiting'` clears `cooldownUntil` and transitions cleanly to `'idle'`.
- **`src/loop.js` + `autofish.js`** own core execution timeout and live option updates:
  - `src/loop.js`: change `if (t - F.startedAt > F.opts.maxMinutes * 60000)` to `if (F.opts.maxMinutes > 0 && t - F.startedAt > F.opts.maxMinutes * 60000)`.
  - `autofish.js`: allow `F.tune({ maxMinutes, logUrl })` so toggling `Mode` or `Local capture` updates an already-running core immediately without restart.
- **`panel.js`** owns presentation, drawer collapse/hide, and pref Expand-Contract persistence:
  - Retires `fastRow`, `.fastnote`, `fastToggle`, `fastPref`, `renderFastToggle`, `setFastFirstPress`, and `fastFirstPress` pref read/write.
  - Groups `Session`, `Cooldown`, `Daily time cap`, `Clock window` (+ `timeRow`), and `Auto-start next run` into a `timedOnly` container toggled via `display: state.mode === 'flow' ? 'none' : ''`.
  - Replaces `postRow` + `captureRow` with one `Local capture` row (`captureRow` / `captureToggle`) controlling both `logUrl` (`/catch`) and `armOvernight()` (`/overnight.js`).

---

## 3. Data Contracts & Expand-Contract Evolution

### Type Contracts (`types.d.ts`)
```ts
type SessionMode = 'flow' | 'timed';

interface SessionState {
  mode: SessionMode;
  // ... existing fields unchanged
}

interface SessionConfigPatch {
  mode?: SessionMode;
  // ... existing fields unchanged
}
```

### `localStorage['autofish:prefs:v1']` Evolution (Expand-Contract)
| Stage | Behavior |
| :--- | :--- |
| **Expand (this change)** | Read: `mode = p.mode === 'flow' ? 'flow' : 'timed'`; `localCapture = p.localCapture !== undefined ? !!p.localCapture : !!(p.postCatches || p.overnight)`. Write: persist `mode` and `localCapture`, and mirror `postCatches: !!localCapture` + `overnight: !!localCapture` while dropping `fastFirstPress` from new writes. |
| **Compatibility mirror** | `window.__panel.localCapture`, `window.__panel.postCatches`, and `window.__panel.overnight` all reflect `localCapturePref` so existing bookmarks/console snippets keep reading truth. |
| **Contract (future release)** | After soak verification, legacy `postCatches`/`overnight` write mirrors may be dropped once no older panel reads them. |

Database schema: `N/A - no relational database; localStorage JSON + flat CSV/JSON files unchanged.`

---

## 4. FMEA Matrix (Resilience & Degradation)

| Failure Scenario | Prob / Sev | Detection Method | Mitigation / Fallback | Recovery Strategy |
| :--- | :--- | :--- | :--- | :--- |
| Core hits old `maxMinutes: 240` fallback in `Flow` mode | High / High | Unit + simulator test (`maxMinutes: 0` at `t > 24h`) | Explicit `F.opts.maxMinutes > 0` check in `src/loop.js`; `startCore` passes `maxMinutes: 0` in `flow` | `F.tune({ maxMinutes: 0 })` when switching to `flow` live |
| Switching `Timed -> Flow` during active `cooldown` leaves panel stuck cooling | Medium / Medium | Unit test in `tests/session.test.js` | `config` patch setting `mode: 'flow'` clears `cooldownUntil` and resets `cooldown`/`waiting` phase to `'idle'` | User clicks Start immediately |
| Toggling `Local capture` on without `fishserve` running spams failed `/catch` POSTs | Medium / Low | Amber `captureLine` status + existing `logErr` throttle | Reuse `askCaptureAddress()` prompt on first opt-in; existing `captureLine` turns amber + click-to-edit origin | Click amber line to fix origin or toggle `Local capture` off |
| Legacy user with `postCatches: true, overnight: false` loses CSV upload on upgrade | Medium / Medium | Unit test on `loadPrefs()` migration | Expand read rule `p.localCapture ?? (p.postCatches \|\| p.overnight)` enables `Local capture` automatically | Single toggle turns both on/off cleanly |
| `Flow` mode hides real safety stops (`seat`, `result-missing`, `core-crash`) | Low / High | `tests/session.test.js` safety-guard tests under `mode: 'flow'` | Only `duration`, `daily-cap`, `window`, `cooldown`, and `chain` check `!isFlow(s)`; all safety guards run identically in both modes | Existing guard banners & `Reload game` button unchanged |

---

## 5. Implementation Milestones (`TDD Enforcement Mode: disabled`)

Linked Task Record: [TASK-2026-11-27-flow-mode-and-panel-simplification](../tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md) (`TDD Enforcement Mode: disabled`).

- **M1 — Reducer, Core Timeout & Type Contracts (`session.js`, `src/loop.js`, `autofish.js`, `types.d.ts`)**:
  - Add `SessionMode = 'flow' | 'timed'` to `types.d.ts` and `session.js` (`DEFAULTS.mode = 'timed'`, `isFlow(s)` gating on `start`/`tick`/`stop`/`config`).
  - Guard `F.opts.maxMinutes > 0` in `src/loop.js` (`stepFrame`), and support `maxMinutes` + `logUrl` in `autofish.js` `F.tune()`.
  - Add unit + simulator tests (`tests/session.test.js`, `tests/simulator.test.js`) covering 24h+ nonstop Flow ticks, no-cooldown Stop, safety guards active in Flow, and `cooldown -> flow` reset.
- **M2 — Panel Redesign & Pref Migration (`panel.js`, `tests/panel.test.js`)**:
  - Add `Mode: Flow | Timed` control at top of **Session & guards** and hide `Session`, `Cooldown`, `Daily time cap`, `Clock window` (+ time steppers), and `Auto-start next run` when `mode === 'flow'`.
  - Update surface `Timer` and `Today` meters to show elapsed time cleanly in `Flow` mode.
  - Remove `Fast first press` row, `.fastnote` warning, and pref wiring from `panel.js` (keep `F.tune({ fastFirstPress })` console-only).
  - Keep `Cozier popup` (`hideUpsell`) intact.
  - Merge `Send catches to CSV` + `Overnight capture` into one `Local capture` toggle with Expand-Contract pref migration and live `F.tune({ logUrl })` sync.
  - Update `tests/panel.test.js` assertions for the new controls and pref migration.
- **M3 — Bundle Rebuild, Verification & Docs Sync (`dist/autofish.user.js`, `README.md`, `AUTOFISH.md`, `docs/*`)**:
  - Run `npm run typecheck && node build-userscript.js && node --test && bash .promptkit/scripts/check-doctor.sh`.
  - Update `README.md`, `AUTOFISH.md`, `docs/STATE.md`, and Task/RFC statuses.
  - Live BrowserOS Neo verification on `127.0.0.1:8731`.

---

## 6. Controlled Work Handoff to `pk:tasks`

- **Objective**: Ship `Flow` nonstop fishing mode, retire `Fast first press` from the panel UI, retain `Cozier popup`, and unify `Send catches to CSV` + `Overnight capture` into one `Local capture` toggle.
- **Bounded Files**: `session.js`, `src/loop.js`, `autofish.js`, `panel.js`, `types.d.ts`, `dist/autofish.user.js`, `tests/{session,panel,simulator,timing}.test.js`, `README.md`, `AUTOFISH.md`, `docs/*`.
- **Execution Policy**: `Gated Mode` — pause after `M1`, `M2`, and `M3` verification; atomic commits after human confirmation.
- **Verification Condition**: `npm run typecheck && node build-userscript.js && node --test && bash .promptkit/scripts/check-doctor.sh` exits `0`.
- **Locked Invariants**: Zero runtime dependencies, no bundler, Tampermonkey single-file install preserved, `Cozier popup` kept, all safety guards active in both `Flow` and `Timed` modes.
