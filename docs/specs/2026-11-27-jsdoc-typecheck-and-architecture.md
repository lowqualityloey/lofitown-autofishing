# Technical Design Document (RFC): Incremental JSDoc Type-Checking, Modular Architecture & Test Simulation

- **Author**: lead / Antigravity
- **Status**: Implemented (M1–M3 + M5; M4 deferred)
- **Created**: 2026-11-27
- **Target Release**: Post-v3.9.64 (M1–M3 + M5 approved; M4 deferred)

---

## Planning Record (PromptKit Adaptation)

<a id="PLAN-jsdoc-typecheck"></a>

### Planning Record Metadata

- **Planning Record ID**: `PLAN-jsdoc-typecheck`
- **Planning Depth**: `Full`
- **Owner**: lead
- **Record Status**: `ready`
- **Local Task Record Link**: `[TASK-2026-11-27-jsdoc-typecheck](../tasks/TASK-2026-11-27-jsdoc-typecheck.md)`

### Planning Inputs

- **Requested Outcome**: Add static type safety (JSDoc + `types.d.ts` + `tsc --noEmit`), tighten cross-file contracts (`autofish.js` ↔ `session.js` ↔ `layout.js` ↔ `panel.js` ↔ `scripts/`), prepare optional modularization of `autofish.js`'s 12 sentinel blocks and a headless `step()` frame simulator, and keep all project docs and CI synchronized — while keeping Tampermonkey's one-click URL install (`dist/autofish.user.js`) 100% unchanged.
- **Observable Completion Condition**: `npm run typecheck` (`tsc --noEmit`) exits `0` across all checked files, `node build-userscript.js` outputs a valid self-contained `dist/autofish.user.js` with zero runtime dependencies, `node --test` passes `100%`, CI runs both `test` and `typecheck`, and all impacted documentation files are updated.
- **Scope Boundary**:
  - **In Scope**: `tsconfig.json`, `types.d.ts`, `package.json` (`devDependencies` + `typecheck` script), `// @ts-check` + JSDoc annotations in `layout.js`, `session.js`, `panel.js`, `autofish.js`, `fishserve.js`, `build-userscript.js`, `scripts/*.js`; optional Phase 4 extraction of pure sentinel cores + headless `step()` simulator; CI `.github/workflows/test.yml`; docs updates (`docs/README.md`, `PROMPTKIT.md`, `README.md`, `AUTOFISH.md`, `docs/STATE.md`).
  - **Excluded (Non-Goals)**: Full `.ts` rewrite, adding a bundler (`esbuild`/`webpack`/`tsup`), adding runtime npm dependencies, changing Tampermonkey install/update URLs or `dist/autofish.user.js` distribution format, changing fishing behavior or tuning knobs during typing passes.
- **TDD Enforcement Proposal (Reference Only)**: `disabled` (type-checking and structural refactor verified by `tsc --noEmit` + existing 431-test regression suite; behavioral simulator tests in M4 use red-green per bug/case).

### Full Planning Fields

- **Explicit Non-Goals**:
  - No `.ts` source rewrite or JS emit/transpilation step.
  - No runtime dependencies; `dist/autofish.user.js` stays one self-contained browser script.
  - No changes to Tampermonkey `@downloadURL` / `@updateURL` or `scripts/release.js` mirror protocol.
  - No weakening or deletion of existing source-guard tests unless replaced by stronger behavioral tests in M4.
- **Affected Behavioral Components**: Local dev tooling & CI (`package.json`, `tsconfig.json`, `.github/workflows/test.yml`), browser userscript sources (`layout.js`, `session.js`, `panel.js`, `autofish.js`), local capture/report tooling (`fishserve.js`, `build-userscript.js`, `scripts/overnight-report.js`), documentation (`README.md`, `AUTOFISH.md`, `PROMPTKIT.md`, `docs/STATE.md`, `docs/README.md`).
- **Externally Visible Contracts**:
  - **Preserved unchanged**: Tampermonkey userscript header, `@downloadURL`/`@updateURL`, `window.__fish` / `window.__panel` / `AutoFishSession` / `AutoFishLayout` public surfaces, `fishserve` HTTP endpoints, `data/runs/` JSON export shape, and `sessions.csv` / `catches.csv` formats.
  - **Added (dev-only)**: `npm run typecheck` (`tsc --noEmit`).
- **Failure or Rollback Considerations**:
  - Zero runtime/data-loss risk for M1–M3 (comments + dev-only config only; `dist/autofish.user.js` runtime code unchanged).
  - Rollback of any milestone is a single `git revert` with zero migration needed.
- **Verification Approach**:
  - `npx tsc --noEmit` / `npm run typecheck` (exit `0`).
  - `node build-userscript.js` + `node --test` (all 431+ tests exit `0`, including `dist/` freshness and `docs/README.md` guards).
  - `git diff --exit-code -- dist/autofish.user.js` after rebuild.

### Assumption Records

<a id="ASSUMPTION-jsdoc-typecheck-001"></a>
- **Assumption ID**: `ASSUMPTION-jsdoc-typecheck-001`
- **Unanswered Decision**: Whether `typescript@7.0.2` should be added as a `devDependency` in `package.json` (with `package-lock.json`) vs. invoked via `npx typescript@7.0.2` without adding `devDependencies`.
- **Provisional Answer**: Add `"typescript": "7.0.2"` as a single pinned `devDependency` in `package.json` so IDE (`tsserver`), local `npm run typecheck`, and CI all run the exact same compiler version reproducibly while keeping `dependencies` empty (zero runtime deps).
- **Impact if Wrong**: If the owner prefers strictly zero `node_modules` / zero `package-lock.json`, swap M1 to `npx --yes typescript@7.0.2 -p tsconfig.json` in `package.json` scripts and CI.
- **Validation Action**: Confirm preference with owner during plan sign-off before M1 execution.
- **Decision Owner**: lead
- **Status**: `accepted`
- **Supporting Evidence**: User confirmation (`1`) approving `devDependency` `typescript@7.0.2` and M1–M3 + M5 scope.
- **Resolution Evidence**: `[TASK-2026-11-27-jsdoc-typecheck](../tasks/TASK-2026-11-27-jsdoc-typecheck.md)`

### Technology and Vendor Decision Records

<a id="DECISION-jsdoc-typecheck-001"></a>
#### Decision Record: `DECISION-jsdoc-typecheck-001`

- **Decision ID**: `DECISION-jsdoc-typecheck-001`
- **Decision Statement**: Choose the static typing toolchain for `lofitown-autofishing` (plain JS + JSDoc + `tsc --noEmit` vs. full `.ts` + bundler rewrite).
- **Considered Options**:
  1. **JSDoc + `types.d.ts` + `tsc --noEmit` (`typescript@7.0.2` dev-only)** — zero runtime/build changes, incremental `// @ts-check` per file, preserves sentinel tests and `coarseScan.toString()` JIT, full IDE + CI checking.
  2. **Full `.ts` rewrite + `esbuild`/`tsup` bundler** — native TS syntax, but adds bundler/source-map pipeline, breaks sentinel extraction and regex source guards in `tests/`, and gives zero runtime speedup.
  3. **Status quo (untyped JS)** — zero setup, but silent cross-file field drift (`status()` ↔ `panel.js` ↔ `session.js`) and dynamic `F.*` state bags remain unchecked.
- **Selected Option(s)**: `JSDoc + types.d.ts + tsc --noEmit (typescript@7.0.2 dev-only)` for M1–M3 + M5
- **Rejected Option(s)**: `Full .ts rewrite + bundler` (high churn, breaks sentinel/source-guard tests, zero runtime gain); `Status quo (untyped JS)` (leaves cross-file contracts unchecked)
- **Material Claim Links**: `[CLAIM-DECISION-jsdoc-typecheck-001-001](#CLAIM-DECISION-jsdoc-typecheck-001-001)`
- **Remaining Uncertainty**: None
- **Decision Owner**: lead
- **Status**: `decided`

##### Version Selection Fields

- **Version Selection Context**: `Greenfield/no preference` (no TypeScript version currently installed or pinned in this repo)
- **AI Recommendation**: `typescript@7.0.2` (exact pin)
- **Selected Exact Version(s)**: `7.0.2`
- **Release Channel**: `stable`
- **Support/Lifecycle Status**: Current npm `latest` stable release (`7.0.2`; `7.1.0-beta` is prerelease and excluded)
- **Compatibility Constraints**: `engines: { node: '>=16.20.0' }`; compatible with workspace Node `v26.13.1` and CI Node `24`.
- **Version Rationale**: Latest stable release on npm with full JSDoc `@typedef` / `@satisfies` / `checkJs` support and zero runtime footprint (`noEmit: true`).
- **Exact-Version Evidence**: `[CITATION-DECISION-jsdoc-typecheck-001-001](#CITATION-DECISION-jsdoc-typecheck-001-001)`
- **Existing Version Baseline**: `Not applicable - greenfield or no existing pin`
- **Decision Owner Approval or Accepted Assumption**: Approved by lead on 2026-11-27 (`1` confirmation for `typescript@7.0.2` devDependency + M1–M3 + M5).

<a id="CLAIM-DECISION-jsdoc-typecheck-001-001"></a>
#### Material Claim Record: `CLAIM-DECISION-jsdoc-typecheck-001-001`

- **Claim ID**: `CLAIM-DECISION-jsdoc-typecheck-001-001`
- **Decision Link**: `[DECISION-jsdoc-typecheck-001](#DECISION-jsdoc-typecheck-001)`
- **Material Claim**: `typescript@7.0.2` is the current stable `latest` version on the npm registry and supports Node `>=16.20.0`.
- **Citation or Uncertainty Link**: `[CITATION-DECISION-jsdoc-typecheck-001-001](#CITATION-DECISION-jsdoc-typecheck-001-001)`

<a id="CITATION-DECISION-jsdoc-typecheck-001-001"></a>
#### Citation Record: `CITATION-DECISION-jsdoc-typecheck-001-001`

- **Citation ID**: `CITATION-DECISION-jsdoc-typecheck-001-001`
- **Publisher**: npm Registry / TypeScript (`npm view typescript version dist-tags engines`)
- **Document Title**: `typescript` npm package registry metadata
- **Canonical URL**: `https://registry.npmjs.org/typescript`
- **Access Date**: `2026-11-27`
- **Supported Claim Link**: `[CLAIM-DECISION-jsdoc-typecheck-001-001](#CLAIM-DECISION-jsdoc-typecheck-001-001)`
- **Citation Status**: `verified`

---

## 1. Executive Summary & Problem Statement

`lofitown-autofishing` ships a fast, zero-dependency Tampermonkey userscript (`dist/autofish.user.js`, 143 fps live) built by concatenating four plain JS files (`autofish.js` 4,995 L, `session.js` 733 L, `layout.js` 99 L, `panel.js` 2,355 L) plus Node tooling (`fishserve.js`, `build-userscript.js`, `scripts/*.js`, totaling 10,105 L).

As the system has grown past 431 tests and 64 patch releases, three maintenance risks have emerged:
1. **Unchecked cross-file object contracts**: `autofish.js` (`status()`, `exportRun()`, `opts`), `session.js` (`SessionState`, `Fact`, `Action`), `panel.js` (`blindFacts()`, `PAUSE_WHY`, `RUNNERS`), and `scripts/overnight-report.js` pass rich objects with no static contract check.
2. **Large monolithic `autofish.js` with 12 sentinel blocks**: Tests currently slice blocks like `// <timing-core>` and `// <dial-memory>` using string search + `new Function(...)` and guard behavior with fragile source regexes.
3. **No headless `step()` frame simulator**: State-machine bugs (like `doPress()` failing to clear `_mid` for >90° spawns or `rearmReady` running one frame late) were caught live instead of in an automated multi-frame simulation test.

This plan introduces **incremental JSDoc type-checking (`types.d.ts` + `tsconfig.json` + `// @ts-check`)**, followed by **optional modularization of sentinel cores and a headless `step()` simulator**, without changing the single-file Tampermonkey install or adding runtime dependencies.

---

## 2. Goals and Explicit Non-Goals

### Goals (In Scope)
- **G1**: Static type-checking (`tsc --noEmit`) passing cleanly across all runtime & script JS files via incremental `// @ts-check` + shared `types.d.ts`.
- **G2**: Exhaustive map checks (`@satisfies`) binding `panel.js` (`PAUSE_WHY`, `RUNNERS`) and `autofish.js` (`DIAL_COUNTER`) to canonical string-literal unions.
- **G3**: Zero change to Tampermonkey one-click URL install (`@downloadURL`/`@updateURL`), zero runtime dependencies, and zero regression across all 431 existing unit tests.
- **G4 (Stage 2 / Optional)**: Cleanly split pure sentinel cores out of `autofish.js` into `src/` files inlined by `build-userscript.js`, and add a headless `step()` simulation suite covering multi-press, >90° spawns, and off-center seats.
- **G5**: Complete documentation and CI alignment across `README.md`, `AUTOFISH.md`, `PROMPTKIT.md`, `docs/STATE.md`, `docs/README.md`, and `.github/workflows/test.yml`.

### Non-Goals (Explicit Scope Boundary)
- Converting `.js` files to `.ts` or introducing `esbuild`/`webpack`/`vite`.
- Changing gameplay/fishing logic, timing constants, or UI layout during typing milestones (M1–M3 are behavior-preserving).
- Modifying `data/runs/` snapshot schema or `sessions.csv` / `catches.csv` formats.

---

## 3. Architecture & System Context

### Build, Typecheck & Distribution Flow
```text
  Dev / CI (never shipped)                   Runtime Build (unchanged)
  ┌──────────────────────────┐               ┌──────────────────────────────┐
  │ tsconfig.json (noEmit)   │               │ autofish.js (+ optional src/)│
  │ types.d.ts (contracts)   │               │ session.js · layout.js       │
  │ tsc --noEmit (typecheck) │               │ panel.js                     │
  └────────────┬─────────────┘               └──────────────┬───────────────┘
               │ checks via // @ts-check                    │ node build-userscript.js
               ▼                                            ▼
      Zero emitted files                     ┌──────────────────────────────┐
      Zero runtime deps                      │ dist/autofish.user.js        │
                                             │ (1 file, identical URL flow) │
                                             └──────────────┬───────────────┘
                                                            │ scripts/release.js
                                                            ▼
                                             Tampermonkey one-click URL update
```

### Deep Module Decomposition & Seams

| Module / Seam | Public Interface / Boundary | Internal Complexity Hidden |
| :--- | :--- | :--- |
| **`types.d.ts`** (dev-only) | `Rect`, `SessionState`, `SessionFact`, `SessionAction`, `PauseReason`, `FishOpts`, `GeoLock`, `DialSample`, `AttemptRecord`, `FishStatus`, `SnapshotExport`, `Window` globals | Single source of truth for every cross-file contract; zero runtime bytes |
| **`layout.js`** (`// @ts-check`) | `inflate`, `intersects`, `unionRect`, `place` | Viewport clamping, exclusion-zone placement, pill fallback |
| **`session.js`** (`// @ts-check`) | `createState`, `reduce`, `blindSilence`, `blindWarning`, `coreGuard`, `reviveGate` | Clock window, midnight rollover, pause reasons, retry backoff |
| **`panel.js`** (`// @ts-check`) | `window.__panel` + shadow-DOM controller | Prefs persistence, capture healing, watchdog, banner priority |
| **`autofish.js`** (`// @ts-check`, optional M4 `src/` split) | `window.__fish` (`start`, `stop`, `pause`, `resume`, `status`, `tune`, `doctor`, `exportRun`) | WebGL readback, dial lock/track, timing planner, catch ledger |
| **`fishserve.js` + `scripts/*.js`** (`// @ts-check`) | Local HTTP routes + CLI scripts (`build`, `release`, `overnight-report`) | CSV/JSON persistence, mirror hash verification, night coverage verdicts |

---

## 4. Detailed Design & Contracts First

### 4.1 `tsconfig.json` Configuration
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": false,
    "strictNullChecks": true,
    "noImplicitAny": false,
    "noUnusedLocals": false,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": [
    "types.d.ts",
    "layout.js",
    "session.js",
    "panel.js",
    "autofish.js",
    "fishserve.js",
    "build-userscript.js",
    "scripts/**/*.js"
  ],
  "exclude": ["dist", "data", "shots", ".tmp", ".promptkit", ".pkab"]
}
```
- **Why `checkJs: false` + opt-in `// @ts-check` per file**: Lets each milestone (M1 → M2 → M3) turn on strict checking file-by-file while `tsc --noEmit` stays green after every single commit. Once M3 completes, `checkJs` can optionally flip to `true`.
- **Why `strictNullChecks: true`**: Catches the exact nullability hazards common in this codebase (`omega: number | null`, `lastGeo: GeoLock | null`, `sinceBubbleMs: number | null`).

### 4.2 Core Shared Contracts (`types.d.ts`)
- **Geometry**: `Rect` (`{ x: number; y: number; w: number; h: number }`), `Point` (`{ x: number; y: number }`), `PlaceResult` (`Rect | 'pill'`).
- **Session Reducer**:
  - `SessionPhase = 'idle' | 'running' | 'paused' | 'waiting' | 'cooldown'`
  - `PauseReason = 'user' | 'hidden' | 'seat' | 'focus' | 'no-catch' | 'cast-stall' | 'player-block' | 'profile-open' | 'result-missing'`
  - `SessionAction`: discriminated union (`startCore`, `stopCore`, `pauseCore`, `resumeCore`, `holdCasts`, `wakeLock`, `releaseWakeLock`, `persist`, `sessionRow`, `refuse`).
  - `SessionFact`: discriminated union (`start`, `stop`, `pause`, `resume`, `tick`, `hidden-start`, `hidden-return`, `configure`).
- **Core Bot & Telemetry**:
  - `FishOpts` (all 45+ knobs in `F.start`), `GeoLock` (`cx`, `cy`, `R`, `width`, `_mid`, `_mt`, `_om`, `_fit`, `_hist`, `_travel`, `_firstHeld`, `_firstForced`), `DialSample`, `PlanResult`, `AttemptRecord`, `DialVerdict` (`'hit' | 'miss' | 'ghost' | 'skipped' | 'stalled' | 'no-press'`), `FishStatus`, `DoctorVerdict`, `SnapshotExport`.
- **Browser Globals**: `interface Window { __fish?: FishApi; __panel?: PanelApi; AutoFishSession?: SessionModule; AutoFishLayout?: LayoutModule; __PIXI_DEVTOOLS__?: any; __overnight?: any; }`.

### 4.3 Database / Persistent Schema Evolution
`N/A - no relational database; CSV/JSON runtime schemas (sessions.csv, catches.csv, data/runs/*.json, localStorage keys) are preserved unchanged.`

---

## 5. Security, Privacy & Failure Modes (FMEA)

### Security Audit
- **Tenancy / Auth / RBAC**: `N/A - single-user local userscript and loopback 127.0.0.1 capture server.`
- **Input Sanitization**: Preserved unchanged (`fishserve.js` origin allowlist and CSV token sanitization remain covered by `tests/fishserve.test.js`).
- **Secrets & PII**: No secrets added; `types.d.ts` and `tsconfig.json` hold type shapes only.

### FMEA Resilience Matrix

| Failure Scenario | Probability / Severity | Detection Method | Mitigation / Fallback | Recovery Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **JSDoc edits break regex source-guard tests** (`tests/perf.test.js`, `tests/dial.test.js`, `tests/panel.test.js`) | Medium / Medium | `node --test` fails immediately | Keep JSDoc annotations above functions or via `types.d.ts` without altering guarded statement strings | Adjust comment placement; re-run `node --test` |
| **JSDoc comments inside `coarseScan` alter JIT / `toString()`** | Low / Medium | `tests/perf.test.js` + live `perf().lockPhases` | Do not place verbose comments inside `coarseScan` hot loop; type its outer signature only | Revert annotation inside `coarseScan` |
| **Rebuilt `dist/autofish.user.js` drifts or fails `new Function` parse** | Low / High | `node build-userscript.js` + `tests/userscript.test.js` + CI `git diff --exit-code` | Always run `node build-userscript.js && node --test` after editing any of the 4 runtime files | Rebuild `dist/` and commit together |
| **Adding `typescript` breaks zero-dep CI `test` job** | Low / Medium | `.github/workflows/test.yml` | Keep `test` job zero-install (`node --test` + `build-userscript.js`); run `typecheck` in a separate CI job (or `npm ci` step) | Remove/isolate `typecheck` CI job independently |
| **M4 sentinel extraction breaks existing sentinel tests** | High / Medium | `tests/timing.test.js`, `tests/dial.test.js`, `tests/catchlog.test.js` | Migrate tests from `SRC.slice(sentinel)` to `require('../src/<mod>.js')` in the same atomic commit per extracted module | Revert single module extraction cleanly |

---

## 6. Phased Implementation Milestones

*Note: Each milestone is independently shippable and leaves `node build-userscript.js && node --test` and `npm run typecheck` green.*

### Milestone 1 — Typecheck Foundation + Pure Modules (`layout.js`, `session.js`)
- [ ] Add `tsconfig.json` (`noEmit: true`, `allowJs: true`, `strictNullChecks: true`, `checkJs: false`) and `types.d.ts` (initial `Rect`, `SessionState`, `SessionFact`, `SessionAction`, `PauseReason`, `BlindFacts`).
- [ ] Add pinned `"typescript": "7.0.2"` to `devDependencies` (or `npx` script per `ASSUMPTION-jsdoc-typecheck-001`) and `"typecheck": "tsc --noEmit"` to `package.json`.
- [ ] Add `// @ts-check` + JSDoc annotations to `layout.js` (99 L) and `session.js` (733 L).
- [ ] Rebuild `dist/autofish.user.js` and verify `npm run typecheck && node --test` (exit `0`).

### Milestone 2 — Panel & Node Tooling Boundaries (`panel.js`, `fishserve.js`, `scripts/`)
- [ ] Extend `types.d.ts` with `FishStatus`, `FishApi`, `PanelApi`, `SnapshotExport`, `Window` globals.
- [ ] Add `// @ts-check`, `@satisfies` exhaustive checks on `PAUSE_WHY` and `RUNNERS`, and JSDoc annotations to `panel.js` (2,355 L).
- [ ] Add `// @ts-check` + JSDoc contracts to `fishserve.js` (325 L), `build-userscript.js` (181 L), and `scripts/overnight-report.js` (515 L) + remaining `scripts/*.js`.
- [ ] Rebuild `dist/autofish.user.js` and verify `npm run typecheck && node --test` (exit `0`).

### Milestone 3 — Core Bot Typing (`autofish.js`)
- [ ] Extend `types.d.ts` with `FishOpts`, `GeoLock`, `DialSample`, `PlanResult`, `AttemptRecord`, `DialVerdict`, `DoctorVerdict`, `BubbleHit`, `CatchCard`.
- [ ] Add `// @ts-check` to `autofish.js` (4,995 L), typing `F` state bags, `DIAL_COUNTER` (`@satisfies`), and pure cores (`timing-core`, `doctor-core`, `stats-core`, `catch-log`, `prompt-box`, `glyph-core`, `result-missing-core`) while leaving `coarseScan` inner loop untouched.
- [ ] Optionally flip `checkJs: true` in `tsconfig.json` once all 12 JS files pass cleanly.
- [ ] Rebuild `dist/autofish.user.js` and verify `npm run typecheck && node --test` (exit `0`).

### Milestone 4 *(Stage 2 — Optional Architecture & Simulation Upgrade)*
- [ ] **M4a — Extract pure sentinel cores to `src/`**: Move pure blocks (`timing.js`, `doctor.js`, `stats.js`, `dial-memory.js`, `catch-log.js`, `scan.js`, `prompt-box.js`, `card-text.js`) into UMD/inlinable files under `src/`, update `build-userscript.js` to inline them in load order, and switch tests from sentinel slicing to direct `require('../src/...')`.
- [ ] **M4b — Headless `step()` frame simulator & replay harness**: Add `tests/sim.test.js` driving synthetic canvas/readback frames through `step()` to verify multi-press continuity, >90° triangle spawns, 13+ press high-tier fish, and off-center pier seats (`y=580`), plus a CLI replay helper over `data/runs/*.json`.

### Milestone 5 — CI & Full Documentation Synchronization
Update every affected doc and workflow file (exact inventory below) and verify `tests/docs.test.js`, `node --test`, `npm run typecheck`, and `bash .promptkit/scripts/check-doctor.sh`.

---

## 7. Complete Documentation & Config Update Plan

| File | Required Updates | Guardrails / Notes |
| :--- | :--- | :--- |
| **`docs/specs/2026-11-27-jsdoc-typecheck-and-architecture.md`** | Update `Status: Draft -> Approved -> Implemented` and resolve `ASSUMPTION-jsdoc-typecheck-001` + `DECISION-jsdoc-typecheck-001`. | Canonical RFC record. |
| **`docs/README.md`** | Index this spec (done now) and index the `docs/tasks/TASK-2026-11-27-jsdoc-typecheck.md` record when created. | Enforced by `tests/docs.test.js` — every `.md` in `docs/{specs,reviews,tasks,releases}` MUST appear here. |
| **`PROMPTKIT.md`** | Update **§2 Active Technology Stack** (record JSDoc + `types.d.ts` + `typescript@7.0.2` dev-only typechecker) and **§3 Project Commands & Verification** (add `npm run typecheck` to Fast/Required/Extended tiers & Standard Commands). | Gitignored local profile; keep `profile: balanced`, `tracking: local`, and `Profile written: 2026-10-27` intact. |
| **`.github/workflows/test.yml`** | Add a `typecheck` job running `npm ci && npm run typecheck` while keeping the existing zero-install `test` job (`node --test` + `dist/` freshness check) untouched. | Preserves fast zero-dependency test guarantee. |
| **`README.md`** | In the developer/build section, document `npm run typecheck` alongside `node --test` and `node build-userscript.js`, and note that `typescript` is dev-only (zero runtime deps; Tampermonkey install URL unchanged). | **Never** quote a literal test count (`N tests`) in `README.md` (`tests/docs.test.js` forbids it). |
| **`docs/STATE.md`** | Update **§3 Verification Commands** (`Typecheck / Linter: npm run typecheck`), add a **§6 ADR Log** row for `DECISION-jsdoc-typecheck-001` (JSDoc + `tsc --noEmit` over `.ts` rewrite), and append **§8 Session Continuity Log** + **§9 Spend Ledger**. | Keep `docs/STATE.md` under `state-guard:` (`6,000` tokens / `500` lines) and preserve `autofish <version>` line (`tests/docs.test.js`). |
| **`AUTOFISH.md`** | Append a concise dated engineering note recording the typing/module/simulator milestone (especially M3/M4 results if runtime or test harness changes). | Keep line 3 `Status: **WORKING (<version>)` synchronized with `package.json` (`tests/docs.test.js`). |
| **`docs/releases/<next>.md`** *(only when releasing)* | If M1–M4 changes ship in a new patch/minor release, add release notes and index in `docs/README.md`. | `M1–M3` are dev/comment-only and do not require an immediate user-facing release unless bundled with code changes. |

---

## 8. Sign-off & Grilling Checklist
- [ ] Confirm `ASSUMPTION-jsdoc-typecheck-001`: `devDependency` (`typescript@7.0.2` + `package-lock.json`) vs. `npx` zero-lockfile invocation.
- [ ] Confirm scope: start with **M1–M3 + M5 (JSDoc + `tsc --noEmit` + CI/docs)** only, or include **M4 (sentinel split + `step()` simulator)** in the same epic.
- [ ] Optional `pk:grill` pre-implementation challenge before creating the Task Record via `pk:tasks`.
