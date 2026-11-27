# Project State & Living Execution Tracker

<!-- Bounded projection: respect `state-guard:` thresholds in `PROMPTKIT.md`; `pk:checkpoint` archives completed history to `docs/STATE-ARCHIVE.md`. -->
## 1. Executive Summary & Current Position
- **Project Name**: lofitown-autofishing (autofish 3.9.65: Flow mode, unified `Local capture`, M4 `src/` modular core, JSDoc static type-checking, Flow `resume` fix, hot-path perf cleanups)
- **Current Milestone / Epic**: Milestone 2 — trustworthy accuracy and seat-aware sessions; Milestone 1 (in-game panel) & Milestone 3 (self-updating distribution) closed.
- **Overall Status**: ACTIVE — **v3.9.65** shipping (`440/440` tests, `tsc --noEmit` exit `0`, live 1h Flow soak `81/82` caught `98.8%`, `143.1 fps`, `allocMBPerSec: 0`); prior baseline **v3.9.64** (`94626a4`, `408,592` bytes, `sha256 5f6ecdaf6281`). Historical release recaps archived to `docs/STATE-ARCHIVE.md` and `docs/releases/`.
- **Current Working Branch**: `main` (pre-existing CRLF/mode diffs remain untouched on `run.sh`, `docs/releases/3.9.{51,56}.md`, and `docs/reviews/2026-11-23-catch-and-focus-live.md`).
- **Last Updated**: 2026-11-27
- **Engine Version**: v2.6.1 @ unknown
- **Runtime**: Node v26.13.1 (WSL), zero dependencies, no bundler

---

## 2. Milestone & Task Progress
- [/] **Milestone 1** — in-game AutoFish panel (session reducer, server records, layout, HUD, guards G1-G7, wake lock + reload resume, install page). Live-verified.
- [/] **Milestone 2** — trustworthy accuracy & seat-aware sessions (fish-attempt oracle, catch ledger, WebGL readback, post-render hook, `__fish.doctor()`, `__fish.exportRun()`, guard/blind diagnostics). Detailed 3.9.6–3.9.31 notes & closed tasks `T1`–`T10`, `Milestone R`, `Milestone 3` archived in `docs/STATE-ARCHIVE.md`.

---

## 3. Active Working Set
- **Target Workspace / Package (if Monorepo)**: standalone repo, no bundler, plain CommonJS + browser globals
- **Active RFC / Spec**: `docs/specs/2026-11-27-flow-mode-and-panel-simplification.md` (`PLAN-flow-mode-panel` — Implemented & verified (`8efe8c8`, Flow `resume` + perf polish in `9c7dae7`); prior M4 `PLAN-m4-modular-core` shipped & live-verified in `ff5657d`)
- **Active Task Spec**: `docs/tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md` (Level 2)
- **Key Source Files in Flight**: `session.js`, `src/{diagnostics,ledger,vision,timing,loop}.js`, `autofish.js`, `panel.js`, `types.d.ts`, `dist/autofish.user.js`, `tests/*.test.js`, `README.md`, `AUTOFISH.md`, `docs/*`. Published `v3.9.64` release + live evidence in `AUTOFISH.md` & `docs/releases/3.9.64.md`.
- **Verification Commands (Scoped)**:
  - Typecheck: `npm run typecheck` (`tsc --noEmit` via `typescript@7.0.2`, `checkJs: true`, `strictNullChecks: true`; `devDependencies` only)
  - Unit Tests: `node --test` (never `node --test tests/` — fails on Node v24.22.1)
  - Build: `node build-userscript.js`; a test fails when the committed `dist/` is stale
  - Release mirror: `node scripts/release.js --check` after every tag — verifies both release assets
    against the tagged build and fetches the public URL anonymously
  - Server smoke: `FISHSERVE_PORT=8741 node fishserve.js` then `curl -s localhost:8741/recent?n=1`
  - Overnight report: `node scripts/overnight-report.js` (12 h ending at the newest snapshot; `## Coverage`; exit 1 when truncated)
  - Capture live check: start fishserve, enable Overnight capture, confirm the first POST, then read the live review (`docs/reviews/2026-11-18-capture-address-live.md`)

---
## 3A. Execution-Control Projection (Optional)
> `docs/tasks/<task-id>.md` is authoritative; escape `|` as `\|` in tables.
- **Task ID**: `TASK-2026-11-27-flow-mode-and-panel-simplification`
- **Task Record**: `docs/tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md`
- **Ceremony Level**: `2`
- **Specification**: `docs/specs/2026-11-27-flow-mode-and-panel-simplification.md`
- **Execution Scope**: `Flow` nonstop fishing mode, `Stop when hidden: off`, retire `Fast first press` panel toggle, keep `Cozier popup`, unify `Local capture`
- **Execution State**: `done`
- **Mapped `pk:tasks` Status**: `Done`
- **Active Task Pointer**: `TASK-2026-11-27-flow-mode-and-panel-simplification`
- **Owner / Current Actor**: lead / Antigravity
- **Start Time**: `2026-11-27`
- **Current Revision**: `v3.9.65` release (`HEAD` on `main`)
- **Next Action**: Field-run `v3.9.65` across local midnight and verify Zen/Gecko frame budget (`__fish.perf()`).

---

## 4. Locked Technical Invariants (Do Not Undo)
Document non-negotiable architectural decisions agreed upon during pairing sessions. Every **actual invariant entry** is a human-approved rule that carries an inline source: a confirmed decision ID (`DECISION-*`) or an explicit pre-existing project policy (`policy:` plus a project-relative path). An entry without one of those two sources is not an invariant.

**Illustrative syntax — not invariant entries.** The fenced lines below show only the required `source:` shape. They are placeholders, not locked or human-approved rules, and must never be copied into a tracker as policy:

```text
<invariant> — source: DECISION-<spec-slug>-<nnn>
<invariant> — source: policy: <project-relative path>
```

A candidate learning, derived PromptKit baseline, or unverified recommendation is never human-approved or locked without one of those sources. Keep it in §4A until the human decision is recorded (`protocols/context-sync.md` §3.1).

A contradiction between a detected project document and a confirmed decision is not a §4 entry: the Intake Record owns those divergence rows (`protocols/discovery-intake.md` §G). A precedence statement about a detected project document belongs in §4 only when a human approved it and it cites its `DIVERGENCE-*` row or policy path; an unsupported override claim stays out of the tracker.

**Empty state — not an invariant entry.** Until a pairing session locks a real decision, leave §4 without entry bullets; keep only this guidance and never pre-fill an entry.

---

## 4A. Candidate Learnings (Unpromoted)

Staging area for rules observed during sessions but not yet approved as invariants. Entries here are **never pre-filled** and are non-authoritative: agents must not treat them as policy, quote them as invariants, or copy them into project guardrails. Promotion requires a recorded human decision (`approved` / `rejected` / `deferred`) with approver, date, evidence reference, and destination (see `protocols/context-sync.md` §3.1).

| Date | Proposed Rule | Source / Evidence | Scope | Status | Human Decision (approver, date, destination) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| not tracked | not tracked | not tracked | not tracked | not tracked | not tracked |

---

## 5. Known Blockers, Risks & Open Questions
- **Blockers**:
  - none.
- **Architectural Questions**:
  - none open — placement, history storage, pause semantics and the clock-window meaning were settled
    in the approved spec.
- **Open questions**:
  - The 30-minute seat cap, the clock-window stop and the daily-cap stop have never fired in the
    field; only an overnight run shows what they cost when they do.
  - The whole-surface prompt scan's false-positive rate against other white UI (name tags, chat
    bubbles) is unmeasured at window sizes nobody has run.
- **Technical Debt & Risks**:
  - **Zen frame budget unmeasured.** Every timing figure in AUTOFISH.md from 3.8.2 on is Chromium. A
    Gecko readback is not a Chromium one; measure with `__fish.perf()` before changing a throttle.
  - **Port collision.** 8731 was free on 2026-11-18, but a stale fishserve can still hold it; the
    browser talks to whatever listens there, not to the WSL instance. Probe
    `curl -s localhost:8731/overnight.js` and use `FISHSERVE_PORT=8741` (or stop the old process) if
    it answers old code. The panel derives its API origin from the stored capture address, so any
    port works.
  - **Stale worktree index.** `main` is also checked out in the WSL worktree at
    `//wsl.localhost/Ubuntu/home/heyloey/personal/lofitown-autofishing`. Merge commits made from the
    Windows worktree move the ref but not that tree, so it reads a large diff until a
    `git reset --hard` is run there; the Windows worktree is the one that writes. (The `heyloey` CLI
    lives only on the WSL side - run milestone writes through `wsl.exe -e bash -lc '...'`.)
  - **Ban risk** sits entirely with the user's account; the bot does client-side input only and
    refuses to run while the tab is not visible.

---

## 6. Recent Architectural Decisions (ADR Log)
Older decisions (2026-10-27–2026-11-17) are archived in `docs/STATE-ARCHIVE.md`.

| Date | Title & Scope | Decision Summary | ADR File |
| :--- | :--- | :--- | :--- |
| 2026-11-17 | Focus session hold | A focus session pauses the run instead of hiding anything: `focus` is a session pause reason with no retry, released only by the session ending or the toggle, and it draws nothing over the game. Hiding the CAST!/REEL! prompt was withdrawn after three attempts (3.9.34-3.9.37): it is painted into the game's canvas, the reachable Pixi Graphics is only a hit area (hiding its 85-child container changed zero pixels), the blur cover looked worse than the bubble, and the CSS clip could not be verified. The toggle is therefore named "Pause in focus sessions" and the prompt stays visible. Two defects the live measurement found are fixed: `savePrefs` stores the setting (`focusPref`), never the live hold, because a session-driven release switched the setting off for good; and a focus tick takes the pause over from a guard so that guard's retry cannot fish for a tick mid-session. | `AUTOFISH.md` 3.9.38-3.9.40; `tests/panel.test.js`; `tests/session.test.js` |
| 2026-11-18 | Unknown worklist | The ledger's `unknown` map is cumulative - a name the catalogue later learns keeps its old catch count - so the live ledger's 38 names / 356 catches read as one unresolved pile when only one name was a gap. `__fish.log().worklist` now classifies every name at read time against the current catalogue: `resolved` (`speciesInfo` knows it; Shiny/Golden variants count), `fragment` (whole-word prefix or suffix of a catalogue or display name), `nonFish` (explicit item/quality text) or `open`, with per-kind catch counts, `n`/`last` per entry and the known-name candidates for a fragment. Derived only inside `log()`; the ledger is never migrated, renamed or backfilled, so history stays what the older builds wrote. The game prints two names its fish table does not store: `Pharaoh Cuttlefish` is the Epic `Pharooh Cuddlefish` (1-10 kg, 140 gold) and `Golden Canny` is a special `Pink Canny` (Legendary, 50-300 kg, 60 gold). Both are display aliases in `speciesInfo()`, kept out of `SPECIES` so the table stays 232 rows. Live: 22/270 resolved, 12/79 fragments, 4/7 non-fish, 0 open - `Pharaoh`'s 24 catches are fragments of its display name - and the tooltip prints `no open gaps - all 38 historical unknown names are resolved, fragments or non-fish`. Released as `v3.9.49` (commit `de34fd9`, merge `64deb80`), source and public mirror identical at 366,910 bytes / sha256 `820c91061e41`, `release.js --check` green. | `AUTOFISH.md` 2026-11-18 the unknown worklist; `tests/catchlog.test.js` |

---

## 7. Next Immediate Actions (Queued)
1. **Monitor `v3.9.65` overnight soak.** Confirm `overnight-report.js` coverage cleanly after an unattended Flow night.
2. **Field-run across local midnight.** Verify that only the post-midnight share spends the new day's cap (`Timed` mode) and that `Flow` mode runs smoothly across rollover.
3. **Measure the Zen frame budget.** Use `__fish.perf()` on Gecko before changing any scan throttle.
4. **Watch the for-anywhere prompt scan** for false positives on other white UI (name tags, chat bubbles) at untested window sizes.

---

## 8. Session Continuity Log
Compact record of pairing sessions (older rows archived in `docs/STATE-ARCHIVE.md`):
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Date | Engineer / Agent | Milestone / Focus | Key Changes & Artifacts |
| :--- | :--- | :--- | :--- |
| 2026-11-25 | lead (Freebuff session) | 3.9.63 release record and docs guard | Added `docs/releases/3.9.63.md` for the guard/blind export and report diagnostics, indexed all release notes in `docs/README.md`, refreshed this tracker, and added a docs test that requires the shipped version's release note to exist and be listed. Tag `v3.9.63` is on `c639a7f`; source, mirror and anonymous latest match 406,879 bytes / sha256 `02904b8c7112…`; `node --test` 428/428; `node scripts/release.js --check` green. PR #36 merged the README update; mode-only diffs stayed out. | `docs/releases/3.9.63.md`; `docs/README.md`; `tests/docs.test.js`; `docs/STATE.md` |
| 2026-11-25 | lead (Freebuff session) | PromptKit OS 2.5.0 upgrade | Replaced the main checkout's 2.4.0 courier kit with the 2.5.0 release tarball (courier verified the published pin), keeping the balanced profile, local + GitHub tracking projection and the cline host. Refreshed `AGENTS.md` and `.clinerules/promptkit.md`; `PROMPTKIT.md` kept its profile, size and intake fields; `Engine Version` stamped `v2.5.0 @ unknown`. 2.5.0 adds the host-conformance capture harness and renderer scripts and writes only `AGENTS.md` for the gemini host; no migration. `node --test` 427/427. `.promptkit/`, `AGENTS.md` and `PROMPTKIT.md` stay gitignored; main's tracked tree was left untouched because its existing diff is line-ending-only. | `docs/STATE.md`; `AGENTS.md`; `PROMPTKIT.md` |
| 2026-11-25 | lead (Freebuff session) | PR #37 merged the 3.9.63 docs record | PR #37 merged `docs/3.9.63-release` into `main` as `4a3e0ec`; the merge added `docs/releases/3.9.63.md`, indexed it in `docs/README.md`, refreshed this tracker and added the release-note guard in `tests/docs.test.js`. Full suite 428/428 and `release.js --check` green against v3.9.63. Mode-only diffs stayed out. | `docs/releases/3.9.63.md`; `docs/README.md`; `tests/docs.test.js`; `docs/STATE.md` |
| 2026-11-27 | Antigravity (pk:checkpoint) | PromptKit OS 2.6.1 upgrade & STATE.md slimming | Upgraded `.promptkit/` courier from v2.5.0 to v2.6.1 (`node --test` 428/428); archived historical Section 1/2/6/7/8 entries and slimmed v2.5.0 Section 3A/3B boilerplate to `docs/STATE-ARCHIVE.md`. | `docs/STATE.md`; `docs/STATE-ARCHIVE.md`; `PROMPTKIT.md`; `AGENTS.md` |
| 2026-11-27 | Antigravity (pk:debug / pk:ship prep) | 3.9.64 dial continuity & off-center seat fix | Fixed >90° post-press lock drops (`doPress` `_mid` reset), moved re-arm before `planPress`, raised `maxPressPerDial` to 30 (`maxRejectedPerDial: 5`), added `seatPromptBox`, dial-lock `F.hint` sync, `glyphMetrics` on `bubbleAnywhere`, and 3-strike `downscaleGl` recovery. Live BrowserOS Neo: `0/9` multi-lock (was `61.5%`), `46/46` presses accepted, `82.6%` settled, `(609,578)` promoted to `box`; `431/431` tests green. | `autofish.js`; `dist/autofish.user.js`; `package.json`; `docs/releases/3.9.64.md`; `docs/tasks/TASK-2026-11-27-dial-continuity-and-seat-prompt.md` |
| 2026-11-27 | Antigravity (pk:plan / M1–M3+M5) | Dev-only JSDoc static type-checking (`tsc --noEmit`) | Installed `typescript@7.0.2` in `devDependencies`; added `tsconfig.json` (`checkJs: true`, `strictNullChecks: true`, `noEmit: true`) and `types.d.ts`; typed `layout.js`, `session.js`, `panel.js`, `autofish.js`, `fishserve.js`, `build-userscript.js`, and `scripts/*.js` with `@satisfies` on `PAUSE_WHY`, `RUNNERS`, and `DIAL_COUNTER`; added CI `typecheck` job and synced docs (`DECISION-jsdoc-typecheck-001`; M4 deferred). | `tsconfig.json`; `types.d.ts`; `package.json`; `layout.js`; `session.js`; `panel.js`; `autofish.js`; `fishserve.js`; `build-userscript.js`; `scripts/*.js`; `.github/workflows/test.yml`; `docs/specs/2026-11-27-jsdoc-typecheck-and-architecture.md`; `docs/tasks/TASK-2026-11-27-jsdoc-typecheck.md` |
| 2026-11-27 | Antigravity (pk:plan / M4) | Modular core extraction (`src/`) & headless simulator | Extracted `src/{diagnostics,ledger,vision,timing,loop}.js` (`// @ts-check` UMD modules), shared `assembleCore()` across `build-userscript.js` + `fishserve.js` (`GET /autofish.js`), migrated sentinel tests & `scripts/{gen-catalogue,overnight-report}.js` to `require('../src/...')`, and added `tests/simulator.test.js` (`PLAN-m4-modular-core`, committed `0c71e6e`/`7802bf4`; `436/436` tests, `tsc --noEmit` exit `0`). Verified live in BrowserOS Neo: `['3.9.64', true x 5]`, `10/10` caught (`d: 1`), `53/53` accepted, `143.1 fps`, `snapshot.gl: 4233 / canvas2d: 0`. | `src/*.js`; `autofish.js`; `build-userscript.js`; `fishserve.js`; `types.d.ts`; `tsconfig.json`; `scripts/*.js`; `tests/*.test.js`; `dist/autofish.user.js`; `AUTOFISH.md`; `docs/specs/2026-11-27-m4-modular-core-and-simulator.md`; `docs/tasks/TASK-2026-11-27-m4-modular-core.md`; `docs/reviews/2026-11-27-m4-modular-core-live.md`; `docs/STATE.md` |
| 2026-11-27 | Antigravity (pk:plan) | Flow mode & panel simplification | Added `Mode: Flow \| Timed` (`maxMinutes: 0`, `hiddenStopMs: 0`), kept safety guards + `Cozier popup`, retired `Fast first press` UI + amber warning, and unified `Send catches to CSV` + `Overnight capture` into one `Local capture` toggle with Expand-Contract pref migration (`PLAN-flow-mode-panel`, committed `8efe8c8`; `438/438` tests, `tsc --noEmit` exit `0`). | `session.js`; `src/loop.js`; `autofish.js`; `panel.js`; `types.d.ts`; `dist/autofish.user.js`; `tests/{panel,session,simulator}.test.js`; `README.md`; `AUTOFISH.md`; `docs/specs/2026-11-27-flow-mode-and-panel-simplification.md`; `docs/tasks/TASK-2026-11-27-flow-mode-and-panel-simplification.md`; `docs/STATE.md` |
| 2026-11-27 | Antigravity (pk:review / pk:fix) | Flow `resume` fix, perf polish & docs sync | Bypassed `dailyCapMs`/`window` checks on Flow `resume` (`session.js`), added `createLedger().getEpoch()` + `F.log()` memoization, reused `tickOnce()` status in `render()`, eliminated `PX()` in `creamFraction` and unused `pat`/array allocs in `F.sample()`, consolidated `src/diagnostics.js` filter passes (`9c7dae7`; `440/440` tests, `tsc --noEmit` exit `0`), and synced `README.md`, `docs/STATE.md`, `docs/releases/3.9.64.md`, and `docs/README.md` (flagging stale `3.9.31` README screenshots). | `session.js`; `src/{ledger,diagnostics}.js`; `autofish.js`; `panel.js`; `dist/autofish.user.js`; `tests/{session,catchlog,perf}.test.js`; `README.md`; `docs/STATE.md`; `docs/releases/3.9.64.md`; `docs/README.md` |
| 2026-11-27 | Antigravity (pk:ship) | Ship `v3.9.65` release + live README screenshots | Refreshed README/docs screenshots from BrowserOS Neo live Flow session (`34737e3`), verified 1h live soak (`81/82` caught `98.8%`, `423/423` accepted `100.0%`, `143.1 fps`, `allocMBPerSec: 0`), bumped `package.json` to `3.9.65`, rebuilt `dist/autofish.user.js`, published `v3.9.65` source + `lofitown-autofishing-dist` mirror (`release.js --check` green). | `package.json`; `dist/autofish.user.js`; `docs/releases/3.9.65.md`; `docs/README.md`; `docs/STATE.md`; `AUTOFISH.md`; `README.md`; `docs/images/*.jpg` |

---

## 9. Session Spend Ledger
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Session | Turns | Measured in/out | Estimated context payload | Note |
| :--- | :--- | :--- | :--- | :--- |
| 2026-11-22 (PromptKit sync) | ~16 | host telemetry unavailable | 128k–240k heuristic context payload | duration=not tracked; repairs=1; interventions=3; verification=`node --test` 369/369; outcome=accepted |
| 2026-11-27 (PromptKit 2.6.1 upgrade & checkpoint) | ~5 | host telemetry unavailable | not measured | duration=not tracked; repairs=0; interventions=3; verification=`node --test` 428/428, `check-doctor.sh` exit 0; outcome=accepted |

- **Running total**: `not measured` on current session (host telemetry unavailable); 128k–240k heuristic context payload preserved on the 2026-11-22 historical row. Refreshed by `pk:checkpoint`; one row per real work session.
- **Note evidence**: use `duration=<value>; repairs=<count or not tracked>; interventions=<count or not tracked>; verification=<result or not tracked>; outcome=<accepted | rejected | incomplete | blocked | not tracked>`. Never infer `0`, `passed`, or `accepted` from missing evidence.
- **Evidence boundary**: this ledger is operational telemetry, not CPAC benchmark evidence. Heuristic context payload is not provider billing telemetry or actual spend; avoided rework remains `not measured` without comparative evidence. Preserve historical rows and the five-column shape without silent backfill.
