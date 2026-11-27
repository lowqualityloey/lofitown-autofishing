# Technical Design Document (RFC): M4 Modular Core Extraction (`src/`) & Headless `step()` Simulator

- **Author**: lead / Antigravity
- **Status**: Implemented
- **Created**: 2026-11-27
- **Target Release**: Post-v3.9.64 (M4 follow-on to `PLAN-jsdoc-typecheck`)

---

## Planning Record (PromptKit Adaptation)

<a id="PLAN-m4-modular-core"></a>

### Planning Record Metadata

- **Planning Record ID**: `PLAN-m4-modular-core`
- **Planning Depth**: `Full`
- **Owner**: lead
- **Record Status**: `implemented`
- **Local Task Record Link**: `[TASK-2026-11-27-m4-modular-core](../tasks/TASK-2026-11-27-m4-modular-core.md)`

### Planning Inputs

- **Requested Outcome**: Extract the 12 pure/semi-pure sentinel blocks and the `step()` frame-loop state transitions out of monolithic [autofish.js](../../autofish.js) into cohesive, type-checked UMD modules under `src/`, assembled transparently for both `dist/autofish.user.js` and `fishserve.js` (`GET /autofish.js`), and enable deterministic multi-frame regression testing in Node via a headless `step()` simulator.
- **Observable Completion Condition**: All 5 `src/*.js` modules (`timing.js`, `vision.js`, `ledger.js`, `diagnostics.js`, `loop.js`) pass `npm run typecheck` (`tsc --noEmit` with `checkJs: true`), `node build-userscript.js` produces a valid single-file `dist/autofish.user.js`, `fishserve` serves assembled `/autofish.js` parity, sentinel-slicing tests & `scripts/overnight-report.js` import `src/*.js` directly, `tests/simulator.test.js` covers multi-frame sequences, and `node --test` + `check-doctor.sh` pass with zero failures.
- **Scope Boundary**:
  - **In Scope**: `src/timing.js`, `src/vision.js`, `src/ledger.js`, `src/diagnostics.js`, `src/loop.js`, thin adapter cleanup in `autofish.js`, `types.d.ts`, `tsconfig.json` (`src/**/*.js`), `build-userscript.js`, `fishserve.js` (`GET /autofish.js`), `scripts/gen-catalogue.js`, `scripts/overnight-report.js`, test migration under `tests/`, new `tests/simulator.test.js`, and documentation sync (`AUTOFISH.md`, `docs/STATE.md`, `docs/README.md`).
  - **Excluded (Non-Goals)**: Adopting a JS bundler (`esbuild`, `webpack`, `rollup`) or `.ts` emit step; adding runtime npm dependencies; changing Tampermonkey `@downloadURL`/`@updateURL` or `dist/autofish.user.js` distribution behavior; altering `coarseScan` JIT `new Function` compilation or tuning runtime fishing heuristics/thresholds; 1-to-1 splitting of 7–30 line sentinels into shallow files.
- **TDD Enforcement Proposal (Reference Only)**: `disabled` (incremental module extraction gated on existing 431-test regression suite + `tsc --noEmit`; simulator adds multi-frame regression tests in `M4.5`).

### Full Planning Fields

- **Explicit Non-Goals**:
  - No `.ts` rewrite, no bundler, no minifier, no runtime dependencies.
  - No behavioral changes to detection geometry, dial planning math, CSV/JSON persistence formats, or panel UX.
  - Leave `coarseScan` (`autofish.js`) hot loop and pre-allocated WebGL readback buffers untouched.
- **Affected Behavioral Components**: Userscript build pipeline (`build-userscript.js`), local bookmarklet server (`fishserve.js` `/autofish.js`), bot core (`autofish.js` split into `src/*.js` + adapter), catalogue & overnight CLI scripts (`scripts/gen-catalogue.js`, `scripts/overnight-report.js`), Node test suite (`tests/*.test.js`).
- **Externally Visible Contracts**:
  - **Preserved unchanged**: Tampermonkey userscript header & update URLs, `window.__fish` / `window.__panel` APIs, `const F = { version: 'dev' };` version stamping, bookmarklet single-request `GET /autofish.js` endpoint, `sessions.csv` / `catches.csv` / `data/runs/*.json` / `localStorage` schemas.
  - **Internal dev-only additions**: UMD globals (`AutoFishTiming`, `AutoFishVision`, `AutoFishLedger`, `AutoFishDiagnostics`, `AutoFishLoop`) imported directly via `require('../src/...')` in Node tests and CLI scripts.
- **Failure or Rollback Considerations**:
  - Each sub-milestone (`M4.1` -> `M4.5`) keeps `npm run typecheck`, `node build-userscript.js`, and `node --test` green in independent commits so any extraction step reverts cleanly in one commit.
  - Regex/slice tests in `tests/` (`tests/userscript.test.js`, `tests/perf.test.js`, `tests/promptmask.test.js`, `tests/watchdog.test.js`, `tests/renderhook.test.js`) are explicitly inventoried so structural vs pure-unit checks never diverge silently.
- **Verification Approach**: `npm run typecheck`, `node build-userscript.js`, `node --test` (full suite + new `tests/simulator.test.js`), `fishserve` route parity check (`GET /autofish.js` matches assembled core), `scripts/gen-catalogue.js` & `scripts/overnight-report.js` unit checks, and `bash .promptkit/scripts/check-doctor.sh`.

### Assumption Records

None — both key architectural decisions (`Option 1: Assemble from src/ via build & /autofish.js` and `Option 1: 4 Deep UMD Modules + Headless src/loop.js Simulator`) were explicitly confirmed by the decision owner on `2026-11-27`.

### Technology and Vendor Decision Records

None — M4 uses only the existing repository runtime and dev tooling (`Node.js` built-in test runner, UMD CJS/global modules, and `typescript@7.0.2` via `npm run typecheck` already pinned by `DECISION-jsdoc-typecheck-001`).

---

## 1. Problem Statement & Metrics

While M1–M3 established static type coverage across `autofish.js` (`5,077` lines) and `tests/` (`431` tests), two structural bottlenecks remain:
1. **Brittle string-slicing test harness**: `10+` unit test files and [overnight-report.js](../../scripts/overnight-report.js) currently extract `12` sentinel blocks plus `7` ad-hoc function slices from `autofish.js` via `.indexOf(...)` and `new Function(...)`. Any refactor or formatting shift risks breaking string boundaries rather than testing real module exports.
2. **Untestable multi-frame loop transitions**: `step()` (`~286` lines in `autofish.js`) mixes pure state-machine transitions (`pendingWin`, `cardUntil`, `seatHold`, `attempt`, `pressesThisDial`, `needsSeat`, `resultMissing`) with direct browser I/O (`document`, `tap`, `space`, WebGL readbacks), preventing multi-frame sequences like `>90°` post-press spawn jumps or card-over-dial holds from executing in Node without full DOM/GL stubs.

### Target Outcomes
- **Zero `new Function(slice(...))` extractors** for pure/extracted helpers in `tests/` and `scripts/overnight-report.js` (retained only for intentional JIT `coarseScan` in `autofish.js` and top-level parse checks in `tests/userscript.test.js`).
- **`src/` module depth**: 5 cohesive UMD modules (no trivial `< 50`-line wrapper files).
- **Zero runtime/bundle regressions**: `npm run typecheck` (`exit 0`), `node --test` (`100%` pass including `tests/simulator.test.js`), `dist/autofish.user.js` valid via `new Function(src)`, bookmarklet `GET /autofish.js` green.

---

## 2. System Context & Deep Module Architecture

```text
   src/diagnostics.js ─┐
   src/ledger.js      ─┤
   src/vision.js      ─┼─► Assembled in order ─► autofish.js (DOM/WebGL adapter + coarseScan)
   src/timing.js      ─┤                                │
   src/loop.js        ─┘                                ├─► build-userscript.js ─► dist/autofish.user.js
                                                        └─► fishserve.js GET /autofish.js (bookmarklet)
   tests/*.test.js & scripts/*.js ── require('../src/*.js') directly
```

### Deep Module Decomposition

| Module (`src/`) | Absorbed Sentinels / Source | Exported Surface | Hidden Complexity & Adapter Injection |
| :--- | :--- | :--- | :--- |
| **`src/timing.js`** (`AutoFishTiming`) | `<timing-core>` (`~566`L) | `wrap180`, `deltaOmega`, `fitOmega`, `planPress`, `sweepBias`, `omegaBand`, `widthBand`, `cardShapeOk`, `newTriangle`, `pressOutcome`, `castRecovery`, `perfRates`, `fitStable`, `firstPressGate`, `firstPressBudget`, `firstPressCanMature`, `markFirstPressForced`, `rearmReady`, `dialFallbackWait`, `dialGhost`, `dialStalled`, `ghostBlocked`, `spinAlive`, `lossDiagnostics` | Least-squares unwrapped spin estimation, containment/crossing scheduler, first-press maturity math |
| **`src/vision.js`** (`AutoFishVision`) | `<coords>`, `<readback-core>`, `<prompt-box>`, `<scan-core>`, `<glyph-core>`, `<card-text>` (`~190`L) | `cssPoint`, `flipRows`, `glRowY`, `BUBBLE_BOX_REF`, `promptBox`, `seatPromptBox`, `floodComponents`, `glyphMetrics`, `textSince`, `parseCard`, `WEIGHT`, `MONEY`, `WORD` | Viewport scaling, GL bottom-up row flip, seat-offset prompt box math, card line parser |
| **`src/ledger.js`** (`AutoFishLedger`) | `<catch-log>`, `<species-catalogue>`, `<dial-memory>` (`~463`L) | `SPECIES`, `TIER_ORDER`, `speciesInfo`, `splitVariant`, `normTier`, `parseWeightKg`, `describeCatch`, `emptyLog`, `addToLog`, `trimLog`, `logSummary`, `unknownWorklist`, `logCsv`, `scaleDial`, `sameDial`, store helpers (`createLedgerStore`, `createDialMemory`) | 232-row catalogue + display aliases, unknown worklist classification, injected storage adapter (`localStorage` fallback safe) |
| **`src/diagnostics.js`** (`AutoFishDiagnostics`) | `<doctor-core>`, `<stats-core>`, `<result-missing-core>` (`~273`L) | `doctor`, `wilson`, `runSummary`, `pressAcceptSummary`, `predictionSummary`, `pressVerdictReport`, result-missing predicates & transitions | Wilson CI bounds, per-width band aggregation, watchdog/doctor severity diagnosis, result-missing latch |
| **`src/loop.js`** (`AutoFishLoop`) | Extracted `step()` transitions (`~260`L) | `stepFrame(F, t, io)` + helpers (`refreshLossDiagnostic` etc.) | Deterministic multi-frame sequence: card wait/dismiss, card-over-dial hold, bubble debounce/ladder, dial sample/re-arm/plan, dial lock/anywhere, seat probe & watchdog |
| **`autofish.js`** (adapter) | Slimmed orchestration & WebGL (`~3,200`L remaining) | `window.__fish` (`F`) + `postRenderTick` + `coarseScan` (`new Function`) | Pixi render wrapper, WebGL FBO readbacks, canvas 2D fallbacks, pointer/keyboard dispatch, DOM resize observers |

---

## 3. Data Contracts & Assembly Evolution

1. **UMD Pattern Consistency**: Every `src/*.js` file uses the exact dual-environment IIFE pattern already proven in [layout.js](../../layout.js) and [session.js](../../session.js):
   ```js
   // @ts-check
   /** @param {any} root @param {() => AutoFish...Api} factory */
   (function (root, factory) {
     var api = factory();
     if (typeof module !== 'undefined' && module.exports) module.exports = api;
     else root.AutoFish... = api;
   })(typeof globalThis !== 'undefined' ? globalThis : this, function () { ... });
   ```
2. **Loop I/O Injection (`io` contract in `types.d.ts`)**: `stepFrame(F, t, io)` takes no implicit DOM or timer globals. `autofish.js` provides concrete `io` handlers:
   - `isVisible(): boolean`
   - `now(): number`
   - `findCatch()`, `findBubble()`, `sample(geo)`, `lockDial(hx, hy, span)`, `dialAnywhere(t)`
   - `recordCatch(card)`, `captureTextCursor()`, `tap(x, y)`, `space(target)`, `cancelPend()`, `doPress(now, plan)`, `armPend(plan)`
   - `closeDial(t, ring)`, `startAttempt(t)`, `resolveAttempt(verdict, t, why)`, `saveDialMemory(g)`, `tryEscapeProfile(t)`, `log(msg, data)`
3. **Shared Assembly Boundary (`build-userscript.js` + `fishserve.js`)**:
   - `build-userscript.js` exposes `CORE_PARTS = ['src/timing.js', 'src/vision.js', 'src/ledger.js', 'src/diagnostics.js', 'src/loop.js', 'autofish.js']` and `assembleCore(stampVersion)`.
   - `build()` concatenates `assembleCore(VERSION)`, `session.js`, `layout.js`, `panel.js`, `BOOTSTRAP`.
   - `fishserve.js` intercepts `GET /autofish.js` and responds with `assembleCore(null)` (`version: 'dev'`, `Cache-Control: no-store`, `CORS` headers), removing any divergence between bookmarklet and userscript builds.
4. **Database / Persistent Schema Evolution**: `N/A - CSV/JSON/localStorage schemas unchanged; // <species-catalogue> moves intact into src/ledger.js and scripts/gen-catalogue.js targets src/ledger.js.`

---

## 4. Failure Modes (FMEA)

| Failure Scenario | Probability / Severity | Detection Method | Mitigation / Fallback | Recovery Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **`scripts/gen-catalogue.js --write` edits wrong file after catalogue moves** | Medium / Medium | `tests/cardtext.test.js` + manual run `--fresh` | Move `// <species-catalogue>` sentinels cleanly to `src/ledger.js` and update `scripts/gen-catalogue.js` in commit `M4.2` | Revert target path / re-run `gen-catalogue` |
| **Bookmarklet `/autofish.js` fails because `fishserve` serves only raw `autofish.js` without `src/*.js`** | High / High | `tests/fishserve.test.js` checks assembled `/autofish.js` contains `AutoFishTiming`, `AutoFishLoop`, and `window.__fish = F` | `fishserve.js` calls shared `assembleCore()` helper from `build-userscript.js` | Serve static error `500` rather than half-assembled script |
| **`dist/autofish.user.js` fails UMD resolution if `autofish.js` executes before `src/*.js`** | Medium / High | `tests/userscript.test.js` asserts module load order before `window.__fish = F` | Order `CORE_PARTS` strictly `src/*.js` before `autofish.js` in `assembleCore()` | Reorder `CORE_PARTS` array |
| **`autofish.js` behavior drifts inside extracted `stepFrame`** | High / High | Existing `watchdog`, `renderhook`, `timing`, `result-missing` tests + new `tests/simulator.test.js` | Port branch-for-branch cleanly first without changing conditions; run simulator scenarios against both old & new expectations | `git revert` modular commit (`M4.4`) |
| **Regressing `coarseScan` JIT speed** | Low / High | `coarseScan` remains verbatim in `autofish.js` with `new Function(...)` | Exclude `coarseScan`, `readUIgl`, and `downscaleGl` from `src/` moves | Restore verbatim function |

---

## 5. Phased Implementation Milestones (`TDD Enforcement Mode: disabled`)

- **M4.1 — Shared Assembly Seam, Config & Contracts**: Add `assembleCore()` / `CORE_PARTS` in `build-userscript.js`, update `fishserve.js` `GET /autofish.js` + `tests/fishserve.test.js`, add `"src/**/*.js"` to `tsconfig.json`, and define `AutoFish*` + `LoopIo` interfaces in `types.d.ts`.
- **M4.2 — Extract `src/diagnostics.js` & `src/ledger.js`**: Extract doctor/stats/result-missing and catch-log/species-catalogue/dial-memory into UMD modules; update `autofish.js`, `scripts/gen-catalogue.js`, `scripts/overnight-report.js`, and corresponding tests (`doctor`, `stats`, `status`, `catchlog`, `dial`, `result-missing`, `player-block`, `profile-guard`). Verify `typecheck + build + node --test`.
- **M4.3 — Extract `src/vision.js` & `src/timing.js`**: Extract vision helpers and timing engine into UMD modules; migrate `timing`, `coords`, `cardtext`, and pure helper checks in `perf` tests. Verify `typecheck + build + node --test`.
- **M4.4 — Extract Headless `src/loop.js` Driver**: Extract `step()` transitions into `stepFrame(F, t, io)` in `src/loop.js`; wire `autofish.js` `io` adapter; update structural tests (`watchdog`, `renderhook`, `userscript`). Verify `typecheck + build + node --test`.
- **M4.5 — Multi-Frame Simulator Suite (`tests/simulator.test.js`)**: Add deterministic multi-frame replay regressions covering `>90°` post-press spawn continuity + same-frame re-arm, card-over-dial hold (`cardUntil`), off-center seat prompt & `seatHold` probe recovery, and `maxPressPerDial` (`30`) / `maxRejectedPerDial` (`5`) caps. Verify `typecheck + build + node --test`.
- **M4.6 — Docs Sync & Doctor Gate**: Update `AUTOFISH.md`, `PROMPTKIT.md`, `docs/STATE.md`, `docs/README.md`, and mark RFC/Task status complete; run full verification (`npm run typecheck && node build-userscript.js && node --test && bash .promptkit/scripts/check-doctor.sh`).

---

## 6. Sign-Off
- [x] Deep module decomposition approved (Option 1: 4 domain modules + `src/loop.js`, assembled cleanly)
- [x] Test & simulator strategy approved (Option 1: migrate sentinel extractors + add `tests/simulator.test.js`)
- [x] Human sign-off received to execute `PLAN-m4-modular-core` (`M4.1` started `2026-11-27`)
