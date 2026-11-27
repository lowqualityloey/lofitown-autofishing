# Task: Rare Alerts, 24h Trophy Card Viewer, Update Pill, Local Dashboard & Loss Fixes

Level: 2 (Controlled) · Owner: lead · Created: 2026-11-28 · Status: done · TDD Enforcement Mode: disabled

## Objective

Add toggleable rare-catch chimes, a 24-hour IndexedDB trophy card viewer on Catch history, a 6-hour cached clickable update pill, a `fishserve.js` local capture web dashboard, and 1-click CSV export — while fixing false `cast prompt` losses, missing `row.golden`, unbounded `data/runs/` disk growth, and overnight `result-missing` stalls.

## Specification

- RFC: [2026-11-28-trophy-alerts-and-local-dashboard.md](../specs/2026-11-28-trophy-alerts-and-local-dashboard.md) (`PLAN-trophy-alerts-dashboard`)

## In Scope

- `M1`: `src/loop.js` false `cast prompt` loss fix (`awaitingCard` + unconfirmed guard), `autofish.js` `row.golden` propagation, `panel.js` Web Audio `Rare catch chime` toggle, 6h-cached clickable header update badge, 1-click `↓ CSV` export button, `types.d.ts`, and regression tests.
- `M2`: `autofish.js` WebGL-safe `readUI` catch-card crop (rare catches only), `panel.js` `IndexedDB` `autofish:trophies:v1` store (`24h` TTL, `30`/profile cap) + floating trophy card popover on `LEG`/`SEC`/`shiny·golden`, and unit tests.
- `M3`: `fishserve.js` Expand-Contract `catches.csv` (`+profile,+shiny,+golden`), `GET /report` (reusing `scripts/overnight-report.js`), `GET /dashboard` + `dashboard.html`, `panel.js` dashboard link on `capture armed`, `data/runs/` retention pruning (`14d`/`1000`), bounded `result-missing` auto-reload (`<=2`/hr when `Resume after reload: on`), full verification, docs sync, and live check.

## Explicit Non-Goals

- Adding npm runtime dependencies or external audio/image CDNs.
- Storing card images in `localStorage`.
- Embedding overnight charts/tables inside the `274 px` in-game HUD.
- Breaking legacy 6-column `catches.csv` rows or cutting a GitHub/Tampermonkey release (`pk:ship`).

## Dependencies, Risk & Execution Policy

- **Dependencies**: Built on `fa11ebf` (`v3.9.65` + first-time `Local capture` prompt clarity).
- **Risk & Mitigation**: Read catch-card pixels synchronously via `readUI()` inside `postRenderTick` so WebGL backbuffer clearing cannot yield blank JPEGs; isolate `IndexedDB`, `AudioContext`, and GitHub update `fetch` in `try/catch` so failures never interrupt fishing; guard `result-missing` auto-reload with a 60-minute rolling cap (`2` max).
- **Execution Policy**: `Gated Mode` — await RFC approval & grill confirmation before starting `M1`.

## Acceptance Criteria

1. `AC-1 (False Loss & Golden Fix)`: In `src/loop.js`, an unconfirmed bubble flash while `awaitingCard` is true does not immediately mark a winning attempt `lost (cast prompt)`; `F.recordCatch()` populates `row.golden`.
2. `AC-2 (Rare Chime, Update Badge & CSV)`: `Rare catch chime` toggle synthesizes a Web Audio chime on `Legendary`/`Secret`/`Shiny`/`Golden` catches (off by default); header badge checks GitHub Releases at most once per 6 hours (`!BASE` only) and opens `UPDATE_URL` on click; `↓ CSV` downloads `F.logCsv()`.
3. `AC-3 (24h Trophy Card Viewer)`: Rare catches save cropped JPEGs to `IndexedDB` (never `localStorage`) with automatic `24h` TTL + `30`/profile pruning; clicking `LEG`, `SEC`, or `shiny·golden` opens a floating card viewer popover.
4. `AC-4 (Local Dashboard & Maintenance)`: `fishserve.js` serves `GET /report` and `GET /dashboard`, appends optional `profile,shiny,golden` columns to `catches.csv`, prunes `data/runs/` past retention limits, and `panel.js` links `capture armed` to `/dashboard`; bounded `result-missing` auto-reload enforces `<=2`/hr cap only when `Resume after reload: on`.
5. `AC-5 (Verification & Docs)`: `npm run typecheck`, `node build-userscript.js`, `node --test`, and `bash .promptkit/scripts/check-doctor.sh` all exit `0`, with docs synced.
