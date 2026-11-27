# Task: M4 Modular Core Extraction (`src/`) & Headless `step()` Simulator

Level: 2 (Controlled) · Owner: lead · Created: 2026-11-27 · Status: done · TDD Enforcement Mode: disabled

## Objective

Refactor monolithic runtime logic inside [autofish.js](../../autofish.js) into five cohesive, type-checked UMD modules under `src/` (`timing.js`, `vision.js`, `ledger.js`, `diagnostics.js`, `loop.js`) assembled identically by [build-userscript.js](../../build-userscript.js) and [fishserve.js](../../fishserve.js), migrate `new Function(slice(...))` sentinel tests and scripts to real `require('../src/...')` imports, and add a deterministic multi-frame `step()` regression simulator (`tests/simulator.test.js`).

## Specification

- RFC: [2026-11-27-m4-modular-core-and-simulator.md](../specs/2026-11-27-m4-modular-core-and-simulator.md) (`PLAN-m4-modular-core`)

## In Scope

- `M4.1`: Assembly seam in `build-userscript.js` + `fishserve.js` (`GET /autofish.js`), `tsconfig.json` (`src/**/*.js`), `types.d.ts` (`AutoFish*` + `LoopIo`).
- `M4.2`: `src/diagnostics.js`, `src/ledger.js`, `scripts/gen-catalogue.js` (`// <species-catalogue>` target), `scripts/overnight-report.js`, and corresponding tests.
- `M4.3`: `src/vision.js`, `src/timing.js`, and corresponding tests (`timing`, `coords`, `cardtext`, `perf` pure helpers).
- `M4.4`: `src/loop.js` (`stepFrame`), thin DOM/WebGL/Pixi adapter in `autofish.js`, updated `dist/autofish.user.js`, and structural/load-order tests.
- `M4.5`: Multi-frame simulator regression suite (`tests/simulator.test.js`).
- `M4.6`: Documentation & tracker sync (`AUTOFISH.md`, `PROMPTKIT.md`, `docs/STATE.md`, `docs/README.md`, RFC/Task status).

## Explicit Non-Goals

- No `.ts` emit, bundler, minifier, or runtime npm dependencies.
- No changes to Tampermonkey `@downloadURL`/`@updateURL` or mirror release contract.
- Leave `coarseScan` JIT `new Function` hot loop and WebGL buffer reuse untouched inside `autofish.js`.
- No heuristic threshold or UI behavior changes during extraction milestones.

## Dependencies, Risk & Execution Policy

- **Dependencies**: Depends on `00c52dc` + `c5c28cb` (M1–M3 + M5 typecheck & CI baseline).
- **Risk & Mitigation**: Refactoring `new Function` slice boundaries and `step()` control flow — mitigate via incremental commits (`M4.1` -> `M4.5`), parity checks on `GET /autofish.js` and `dist/autofish.user.js`, and simulator regression coverage.
- **Execution Policy**: `Gated Mode` (proceed across milestones `M4.1` -> `M4.6` only after human confirmation of `PLAN-m4-modular-core`; commit at natural milestone boundaries with `npm run typecheck && node build-userscript.js && node --test` exit `0`).

## Acceptance Criteria

1. `AC-1 (Assembly & Parity)`: `build-userscript.js` and `fishserve.js` (`GET /autofish.js`) assemble `src/*.js + autofish.js` from one shared definition; `dist/autofish.user.js` builds with zero errors and unchanged Tampermonkey metadata.
2. `AC-2 (Module Extraction)`: All 12 sentinels and `step()` orchestration live cleanly inside `src/{timing,vision,ledger,diagnostics,loop}.js` under `// @ts-check` with `npm run typecheck` exiting `0`.
3. `AC-3 (Test & Tool Migration)`: `scripts/overnight-report.js`, `scripts/gen-catalogue.js`, and sentinel-slicing unit tests consume `src/*.js` directly (or `require`), with zero regressions across existing suites.
4. `AC-4 (Simulator Suite)`: `tests/simulator.test.js` executes multi-frame `stepFrame` scenarios covering `>90°` re-arm continuity, card-over-dial overlap hold, off-center seat probe recovery, and 30-press / 5-rejected caps without browser mocks.
5. `AC-5 (Docs & Hygiene)`: Docs, tracker, and `check-doctor.sh` pass with zero errors after final edits.
