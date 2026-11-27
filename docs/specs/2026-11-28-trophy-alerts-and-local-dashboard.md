# Technical Design Document (RFC): Rare Alerts, 24h Trophy Card Viewer, Update Pill, Local Dashboard & Loss Fixes

- **Author**: lead / Antigravity
- **Status**: Implemented
- **Created**: 2026-11-28
- **Target Release**: v3.9.66+ (post-v3.9.65)

---

## Planning Record (PromptKit Adaptation)

<a id="PLAN-trophy-alerts-dashboard"></a>

### Planning Record Metadata

- **Planning Record ID**: `PLAN-trophy-alerts-dashboard`
- **Planning Depth**: `Full`
- **Owner**: lead
- **Record Status**: `done`
- **Local Task Record Link**: `[TASK-2026-11-28-trophy-alerts-and-local-dashboard](../tasks/TASK-2026-11-28-trophy-alerts-and-local-dashboard.md)`

### Planning Inputs

- **Requested Outcome**: Deliver four user-facing upgrades alongside five verified field-reliability fixes discovered in the 12-hour live `v3.9.65` soak:
  1. Toggleable **Web Audio chime** on `Legendary`, `Secret`, `Shiny`, and `Golden` catches.
  2. **24-hour Trophy Card Viewer** (clickable `LEG` / `SEC` / `shiny·golden` counters opening a floating popover with WebGL-cropped catch card snapshots stored in `IndexedDB`).
  3. **Clickable Update Indicator** in the panel header checking GitHub Releases at most once every 6 hours and opening `UPDATE_URL` for 1-click Tampermonkey updates.
  4. **Local Capture Web Dashboard** (`GET /report` + `GET /dashboard` on `fishserve.js`, linked from the panel's green `capture armed` line) plus **1-click `↓ CSV`** export directly from the browser ledger.
  5. **Field-reliability fixes**: eliminate false `lost (cast prompt)` on unconfirmed sightings while `catchCardPending` is true, propagate `row.golden`, add backwards-compatible `profile,shiny,golden` columns to `catches.csv`, prune unbounded `data/runs/` snapshots (`~100 MB` observed), and add bounded auto-reload on `result-missing` when `Resume after reload` is enabled.
- **Observable Completion Condition**:
  1. `src/loop.js` does not resolve an active `awaitingCard` attempt as `lost (cast prompt)` on a single unconfirmed (`confirmed: false`) bubble sighting; regression tests prove both real losses and pending catch-card wins resolve accurately.
  2. `F.recordCatch()` populates `row.golden` alongside `row.shiny`; toggling **Rare catch chime** plays a short Web Audio preview and chimes on `Legendary`/`Secret`/`Shiny`/`Golden` catches via `F.onCatch`.
  3. Panel header checks `api.github.com/repos/lowqualityloey/lofitown-autofishing-dist/releases/latest` at most once per 6 hours (Tampermonkey mode only, silent on failure) and displays a clickable update badge when a higher semver exists; Catch history provides a 1-click `↓ CSV` download button.
  4. Rare catches (`Legendary`/`Secret`/`Shiny`/`Golden`) capture a WebGL-safe cropped JPEG (`readUI` -> `IndexedDB`, never `localStorage`) pruned to `24h` TTL and `30` cards/profile; clicking `LEG`, `SEC`, or `shiny·golden` opens a floating viewer popover beside the panel.
  5. `fishserve.js` serves `GET /report` (JSON from `scripts/overnight-report.js`) and `GET /dashboard` (zero-dep HTML dashboard), appends optional `profile,shiny,golden` columns to `catches.csv`, and prunes `data/runs/` beyond retention limits; bounded `result-missing` auto-reload (max `2`/hour when `Resume after reload` is on) is unit-tested.
  6. `npm run typecheck`, `node build-userscript.js`, `node --test`, and `bash .promptkit/scripts/check-doctor.sh` all exit `0`.
- **Scope Boundary**:
  - **In Scope**: `src/loop.js`, `src/ledger.js` (if needed for helpers), `autofish.js`, `panel.js`, `session.js`, `fishserve.js`, `dashboard.html` (static asset served by `fishserve.js`), `build-userscript.js`, `types.d.ts`, `tests/*.test.js`, `dist/autofish.user.js`, and docs (`README.md`, `AUTOFISH.md`, `docs/STATE.md`, `docs/README.md`).
  - **Excluded (Non-Goals)**: External npm runtime dependencies, external audio/image CDN hosts, storing images in `localStorage`, rendering charts/tables inside the `274 px` in-game panel, breaking legacy 6-column `catches.csv` readers, or cutting a Tampermonkey mirror release (`pk:ship` stays separate).
- **TDD Enforcement Proposal (Reference Only)**: `disabled` (existing 440-test suite + targeted unit/simulator/HTTP tests per milestone).

### Full Planning Fields

- **Explicit Non-Goals**:
  - Never write binary/base64 image payloads to `localStorage` (5 MB origin cap shared with `lofi.town` and the catch ledger).
  - Never add per-frame allocations or network requests inside `postRenderTick()` or 1 Hz `tick()`/`render()`.
  - Never block fishing if `IndexedDB`, `AudioContext`, or GitHub's API is unavailable, blocked by browser policy, or offline.
  - Never auto-reload endlessly on `result-missing` (hard-capped at `2` reloads per rolling 60-minute window, and only when `Resume after reload` is explicitly `on`).
- **Affected Behavioral Components**: Frame loop attempt resolution (`src/loop.js`), catch capture & WebGL card cropping (`autofish.js`), in-game HUD / IndexedDB trophy store / Web Audio chime / 6h update check / bounded reload (`panel.js`), local capture HTTP server & dashboard (`fishserve.js`, `dashboard.html`, `scripts/overnight-report.js`), shared types (`types.d.ts`), and bundled userscript (`dist/autofish.user.js`).
- **Externally Visible Contracts**:
  - `F.onCatch(row)` gains `row.golden: boolean` and optional `row.cardBlob` / trophy callback hook.
  - `localStorage['autofish.prefs']` adds `rareChime: boolean` (default `false`); `localStorage['autofish:update:v1']` caches `{ checkedAt, latestTag, url }`.
  - `IndexedDB` database `autofish:trophies:v1` (store `cards`) holds `{ id, profile, at, species, rarity, shiny, golden, weight, quality, value, blob }` with 24h TTL and 30-card/profile cap.
  - `catches.csv` expands from 6 columns (`time,species,rarity,quality,weight,value`) to 9 columns (`...,profile,shiny,golden`) — Expand-only, preserving compatibility with all existing 6-column rows.
  - `fishserve.js` adds `GET /report` (JSON) and `GET /dashboard` (HTML), plus env vars `FISHSERVE_KEEP_DAYS` (default `14`, `0` disables) and `FISHSERVE_MAX_RUNS` (default `1000`).
- **Failure or Rollback Considerations**:
  - All new client subsystems (`AudioContext`, `IndexedDB`, update `fetch`, trophy popover) wrap in isolated `try/catch` blocks so failure degrades cleanly to `off` without affecting fishing.
  - `catches.csv` trailing columns are additive; rolling back `fishserve.js` still reads the first 6 columns cleanly.
  - `data/runs/` pruning never touches files newer than 24 hours and defaults to keeping 14 days / 1,000 snapshots.
- **Verification Approach**: `npm run typecheck`, `node build-userscript.js`, `node --test` (unit + headless simulator + `fishserve` HTTP route tests), `bash .promptkit/scripts/check-doctor.sh`, plus live verification in Ego Lite / BrowserOS Neo.

### Assumption Records

- **`ASSUMPTION-trophy-001`**: Trophy chime and 24h card capture trigger on `rarity === 'Legendary' || rarity === 'Secret' || shiny || golden`.
  - **Owner**: lead · **Status**: provisional · **Impact if wrong**: Easy constant filter change (`isTrophy(row)`) · **Validation action**: Confirm in Grill Probe #1 before M1.
- **`ASSUMPTION-trophy-002`**: `result-missing` auto-reload is gated behind existing `Resume after reload: on`, waits `15 s` after `result-missing` latches, and caps at `2` reloads per rolling 60-minute window.
  - **Owner**: lead · **Status**: provisional · **Impact if wrong**: Could reload too eagerly or too rarely during server hiccups · **Validation action**: Confirm in Grill Probe #2 before M3.
- **`ASSUMPTION-trophy-003`**: `data/runs/` retention defaults to `14` days / `1,000` files (`FISHSERVE_KEEP_DAYS`, `FISHSERVE_MAX_RUNS`).
  - **Owner**: lead · **Status**: provisional · **Impact if wrong**: Older raw snapshots pruned sooner/later than desired · **Validation action**: Confirm in Grill Probe #3 before M3.

### Technology and Vendor Decision Records

None — uses built-in browser Web APIs (`Web Audio API`, `IndexedDB`, `fetch`, `Blob`) and Node.js standard library (`http`, `fs`) with zero new runtime dependencies.

---

## 1. Problem Statement & Observed Telemetry

### Live Evidence (12-Hour Run `2026-11-27 16:24 → 2026-11-28 04:21`, `v3.9.65`)
1. **False `cast prompt` losses (`5/5` of all losses)**: `140/145` caught (`96.6%`) despite **`747/747` (`100.0%`)** accepted presses. Both inspected loss records (`export-2026-11-27T15-22-00-859Z.json`) had `dl[0].v = "hit"`, `catchCardPending: true`, and `confirmed: false` (`w: 96, h: 91`). In `src/loop.js:423–432`, a single unconfirmed bubble sighting immediately resolves `lost` when `t - touched > lossGraceMs` even while `awaitingCard` is true.
2. **Missing rare-catch visibility & feedback**: Players fishing overnight or in another window miss `Legendary` / `Secret` / `Shiny` / `Golden` catches and have no way to see which fish card was caught over the last 24 hours.
3. **Missing `row.golden` & `catches.csv` metadata**: `autofish.js:1140` sets `row.shiny` without `row.golden`; `fishserve.js:226` drops `profile`, `shiny`, and `golden` from `catches.csv`.
4. **Terminal-only overnight review & unbounded snapshot disk usage**: Reviewing overnight runs requires running `node scripts/overnight-report.js` in a terminal, and `data/runs/` has already grown to `~100 MB` (`1,100+` files, `1,090` skipped every report).
5. **Silent Tampermonkey update lag**: Users have no in-panel cue when a newer release lands on `lofitown-autofishing-dist`.
6. **Overnight `result-missing` stalls**: `result-missing/high × 11` occurred in the 12h window, halting fishing until a manual **Reload game** click even when `Resume after reload` is on.

### Target Outcomes
- **Zero false `cast prompt` losses** from single unconfirmed flashes while `awaitingCard` is active.
- **1 new toggle max** in `Session & guards` (`Rare catch chime`); Trophy viewer, Update badge, CSV download, and Dashboard link attach cleanly to existing HUD surfaces.
- **Zero hot-path regression**: `0 ms` added to dial tracking frames; trophy crop runs only on rare catches (`<2%` of catches).

---

## 2. System Context & Deep Module Architecture

```text
  autofish.js (postRenderTick)
    ├─ src/loop.js ──► guarded awaitingCard + confirmed bubble loss check
    └─ F.recordCatch(card)
         ├─ row.{shiny, golden} populated
         ├─ if isTrophy(row) && cardBox: readUI(box) ─► offscreen 2D JPEG (~20 KB)
         └─ F.onCatch(row, trophyBlob?)
               ├─ panel.js: Web Audio chime (if rareChime && AudioContext unlocked)
               └─ panel.js: IndexedDB autofish:trophies:v1 (24h TTL, 30/profile cap)
                     └─ clickable LEG / SEC / shiny·golden ─► floating card popover

  panel.js (surface controls, zero extra clutter)
    ├─ Header badge (v3.9.65 · update) ◄── 6h cached GitHub releases/latest fetch (!BASE)
    ├─ Catch history header: [all/today] [↓ CSV] ◄── F.logCsv() Blob download
    ├─ Green capture armed line ──► opens <captureServer>/dashboard
    └─ result-missing watchdog ──► bounded auto-reload (<=2/hr when Resume after reload: on)

  fishserve.js (local optional server)
    ├─ POST /catch ──► catches.csv (Expand: +profile,+shiny,+golden)
    ├─ POST /export ──► data/runs/*.json + lazy retention prune (14d / 1000 max)
    ├─ GET /report ──► reuses scripts/overnight-report.js analyze() -> JSON
    └─ GET /dashboard ──► serves dashboard.html (KPIs, bands, losses, catches, sessions)
```

---

## 3. Data Contracts & Expand-Contract Evolution

1. **`F.onCatch(row, cardJpeg?)`**:
   - Additive fields on `row`: `golden: boolean`.
   - Optional second parameter (or callback `F.captureCardRect(card)`) returns `Promise<Blob | null>` cropped from `readUI(box)` inside `postRenderTick` before the card tap dismisses it.
2. **Browser Preferences & Caches (`localStorage`)**:
   - `autofish.prefs`: additive `rareChime?: boolean` (defaults `false`).
   - `autofish:update:v1`: `{ checkedAt: number, latestTag: string, url: string }`.
   - `autofish:reload-guard:v1`: `{ times: number[] }` (rolling 60-minute timestamps for bounded `result-missing` auto-reload).
3. **Trophy Store (`IndexedDB`: `autofish:trophies:v1`, store `cards`)**:
   - Record: `{ id: string, profile: string, at: number, species: string, rarity: string, shiny: boolean, golden: boolean, weight: string, quality: string, value: string, blob: Blob | null }`.
   - TTL: `24 * 60 * 60 * 1000` ms (`86,400,000` ms). Cap: `30` newest records per profile.
4. **`catches.csv` (Expand-Contract)**:
   - **Expand (this plan)**: append trailing columns `profile,shiny,golden` on newly written rows. Existing 6-column rows remain valid; `/recent` and `/dashboard` default missing trailing columns to `profile: 'default'`, `shiny: false`, `golden: false`.
   - **Contract**: none needed (CSV headerless/append-only format stays backwards-compatible indefinitely).

---

## 4. Failure Mode & Effects Analysis (FMEA)

| Failure Mode | Impact | Mitigation / Guard |
| :--- | :--- | :--- |
| WebGL backbuffer cleared before trophy crop | Blank/black fish card JPEG | Read card pixels synchronously inside `postRenderTick` via `readUI(box)` (uses flipped GL `readPixels`), then encode JPEG asynchronously on a tiny 2D canvas. |
| `IndexedDB` blocked (private browsing / quota) | Trophy viewer throws or breaks catch logging | Wrap all IDB calls in async `try/catch`; silently fall back to metadata-only or no-op; never block `saveLedger` or `F.recordCatch`. |
| `AudioContext` suspended by autoplay policy | Rare catch chime stays silent | Resume/unlock `AudioContext` on **Start** click and **Rare catch chime** toggle click (playing a preview note on toggle-on). |
| GitHub API rate-limit (403) or offline browser | Console noise or amber warning | 6-hour cache in `localStorage`; skip when `BASE` is set; swallow all fetch/parse errors silently with zero UI error banner. |
| `result-missing` reload loop during game outage | Infinite page reloads | Hard rolling cap (`2` auto-reloads per 60 minutes in `localStorage`) + only when `Resume after reload: on` + `15 s` hold before reload; past cap, fall back to existing manual `Reload game` pause. |
| `data/runs/` pruning deletes active night data | Truncated overnight report | Never prune snapshots newer than `24 h`; sort by mtime and delete only oldest files exceeding `FISHSERVE_KEEP_DAYS` (`14`) or `FISHSERVE_MAX_RUNS` (`1000`). |
| Unconfirmed bubble guard hides a genuine fast loss | Attempt stays open until `attemptIdleMs` | Only defer instant loss while `awaitingCard` is true and `!diag.confirmed`; once `confirmed` is true or `pendingLoss` ages past `lossGraceMs`, resolve `lost` normally. |

---

## 5. Implementation Milestones

### Milestone M1: Core Fixes + Rare Catch Chime + Update Badge + CSV Export
- Fix false `cast prompt` loss in `src/loop.js` (`awaitingCard` + `!diag.confirmed` deferral) and add `row.golden` in `autofish.js`.
- Add `Rare catch chime` toggle + Web Audio synthesizer in `panel.js` (with preview on enable and `AudioContext` unlock on Start).
- Add 6h-cached GitHub update check + clickable `vX.Y.Z · update` badge in `panel.js` header (`!BASE` only).
- Add 1-click `↓ CSV` button in Catch history header (`fish().logCsv()` -> download).
- Update `types.d.ts`, `tests/simulator.test.js`, `tests/panel.test.js`, `tests/catchlog.test.js`.

### Milestone M2: 24h IndexedDB Trophy Card Viewer
- Add WebGL-safe `readUI` catch-card crop helper in `autofish.js` invoked inside `F.recordCatch` only for `Legendary`/`Secret`/`Shiny`/`Golden`.
- Add `IndexedDB` trophy store (`autofish:trophies:v1`, 24h TTL + 30/profile cap + auto-prune) and floating trophy card popover in `panel.js` bound to `LEG`, `SEC`, and `shiny·golden` counters.
- Add unit tests for trophy filtering, 24h TTL pruning, cap enforcement, and popover DOM wiring.

### Milestone M3: `fishserve.js` Local Capture Dashboard + Maintenance + Bounded Auto-Reload
- Expand `fishserve.js` `POST /catch` + `/recent` with trailing `profile,shiny,golden` columns (backwards-compatible with 6-column rows).
- Add `GET /report` (reusing `scripts/overnight-report.js`) and `GET /dashboard` serving `dashboard.html`, plus link from `panel.js` `capture armed` line.
- Add `data/runs/` retention pruning (`FISHSERVE_KEEP_DAYS=14`, `FISHSERVE_MAX_RUNS=1000`) to `fishserve.js`.
- Add bounded `result-missing` auto-reload (`<=2`/hr when `Resume after reload: on`) in `panel.js` + pure gate helper in `session.js` + tests.
- Rebuild `dist/autofish.user.js`, sync `README.md`, `AUTOFISH.md`, `docs/STATE.md`, run full verification (`tsc --noEmit`, `node --test`, `check-doctor.sh`), and live-verify in Ego Lite.

---

## 6. Pre-Implementation Grill Probes
1. **Trophy filter**: Confirm chime + 24h card capture triggers on **`Legendary` + `Secret` + `Shiny` + `Golden`** (or should `Halloween` / `Christmas` event fish also trigger?).
2. **`result-missing` auto-reload**: Confirm gating automatic reload behind **`Resume after reload: on`** (with `15 s` grace and max `2`/hour cap), vs keeping `result-missing` manual-only.
3. **`data/runs/` retention**: Confirm default **`14` days / `1,000` snapshots** (`FISHSERVE_KEEP_DAYS` / `FISHSERVE_MAX_RUNS`).
