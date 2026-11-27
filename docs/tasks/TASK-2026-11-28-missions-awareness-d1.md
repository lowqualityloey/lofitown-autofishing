# Task Record: D1 — read-only daily-mission awareness (panel + /dashboard)
<a id="TASK-2026-11-28-missions-awareness-d1"></a>

## Identity
- **Record Type**: `Task Record`
- **Record Form**: `Lite`
- **Task ID**: `TASK-2026-11-28-missions-awareness-d1`
- **Ceremony Level**: `Level 2 (Controlled)` — **Minimal planning depth**, owner-directed (announced downgrade from the scoping record's "Full depth" next action: no multi-contract change in scope; M0 evidence folded into this record per owner instruction instead of a separate `docs/specs/` file)
- **Specification**: `None - L2 Minimal planning; M0 spike evidence folded below (owner instruction 2026-11-28)`
- **Owner / Actor**: lead / ZCode session (GLM-5.3-Flash) - PromptKit OS dogfooding continuation (scratch log Run #3)
- **Execution Scope**: `src/missions.js` (new), `panel.js`, `fishserve.js`, `dashboard.html`, `types.d.ts`, `tests/missions.test.js` (new), `docs/STATE.md`, `docs/README.md` (one index row for this record), `docs/tasks/TASK-2026-11-28-missions-awareness-d1.md` (this record)
- **Approval Boundary**: Owner sign-off closes this record. Local commit only on explicit owner ask; no push, tag, or PR.
- **Created**: `2026-11-28 08:22 (UTC+13)`
- **Work Type**: `Code Work`
- **TDD Enforcement Mode**: `disabled` - dependency-ordered milestones with a complete test strategy (repo convention); the pure parser is unit-tested regardless

## Boundaries
- **Objective**: Add read-only daily-mission awareness to AutoFish: a folded panel section renders the live lofi.town quests (daily + weekly: objective, reward, progress/status, reset countdown) parsed from the Quests DOM, and the optional local capture path carries a mission snapshot that `GET /dashboard` renders. Zero game inputs; claiming excluded.
- **In Scope**:
  - `src/missions.js` - new UMD `// @ts-check` module: DOM walker (thin) + pure parser (unit-tested)
  - `panel.js` - folded `Missions` section rendering parser output, refreshed with the existing tick
  - `fishserve.js` - accept a mission snapshot on the existing capture path (additive optional field, no breaking change) and expose it to `/dashboard`
  - `dashboard.html` - Missions section rendering the latest snapshot
  - `types.d.ts`, `tests/missions.test.js` (parser unit tests using the captured DOM text shapes)
  - `docs/STATE.md` sync + `docs/README.md` index row
- **Explicit Non-Goals**:
  - No claiming / auto-claim (D2): the reader may *observe* `.cozy-missions-claim` presence but never clicks
  - No non-fishing mission automation; non-fishing objectives are displayed only
  - No paywall interaction beyond honest reporting (HARD-1: the Cozier focus-fishing paywall is never bypassed)
  - No changes to the fishing loop, guards, or dial/vision paths
  - No breaking changes to existing capture consumers (additive optional field only)
- **Dependencies**: M0 spike evidence (folded below); owner confirmations pending and non-blocking: Cozy/Cozier account status; whether the owner's panel needed a restart after the spike's session-store writes
- **Risk**: Low-Medium - touches panel render and the capture payload; mitigated by a pure parser under unit test, an additive optional payload field, and the full Extended-tier suite
- **Verification Condition**: `npm run typecheck && node build-userscript.js && node --test` exit 0 from the repository root; parser tests cover the captured DOM text shapes; `check-doctor.sh` exit 0; `docs/README.md` index present before any test run

## Acceptance Criteria
- [x] **AC-1**: The parser converts the captured Quests DOM shapes (folded below) into mission models `{ objective, reward, progress or status, scope: daily|weekly }` and is unit-tested with those real shapes (including `Complete` status and `0/1`-style progress and both countdown formats `HH:MM:SS` / `D:HH:MM:SS`).
  - **Result**: `Met`
  - **Evidence**: `tests/missions.test.js` (8 tests, all passing in the final `node --test` run) covers the captured daily and weekly line sequences, separators, "Complete", both countdown formats, and the no-fabrication rule for missing progress lines
- [x] **AC-2**: The panel renders a folded Missions section (daily + weekly rows + countdown) driven by the parser; collapsed by default; the `<=264 px` panel budget holds (HARD-3).
  - **Result**: `Met`
  - **Evidence**: `panel.js` — `missionsSec = section('Missions')` (collapsed by default like every tier-2 fold), `renderMissions()`/`missionsBlock()` render parser output per scope with cached last-read per scope; rows use ellipsis within the fixed card width; no width change to the card
- [x] **AC-3**: The capture path carries a mission snapshot as an additive optional field, `fishserve.js` stores/serves it, and `GET /dashboard` renders the latest snapshot; existing consumers keep working unchanged.
  - **Result**: `Met`
  - **Evidence**: `autofish.js` `exportRun()` adds `missions` via the same guarded-hook pattern as `panelState` (null when the Quests panel shows nothing; error object instead of a throw); `fishserve.js` persists the whole export payload unchanged and `GET /report` gains `missions: latestMissions(RUNS())`; `dashboard.html` renders it; the pre-existing export/report tests pass unchanged
- [x] **AC-4**: At acceptance, `npm run typecheck`, `node build-userscript.js`, and `node --test` all exit 0 with the new tests passing and no pre-existing test regressed; HEAD moves only via the owner-authorized commit at the gate.
  - **Result**: `Met`
  - **Evidence**: final runs on the complete tree: `npm run typecheck` exit 0 (after 4 JSDoc `@type` fixes in the new module), `node build-userscript.js` exit 0 (dist rebuilt, 458,915 B), `node --test` 456/456 pass (448 pre-existing + 8 new), exit 0
- [x] **AC-5**: `docs/STATE.md` and `docs/README.md` are synced and `check-doctor.sh` exits 0 with `docs-drift OK` and `state-freshness OK`.
  - **Result**: `Met`
  - **Evidence**: `docs/README.md` index row added before the first test run (Run #1 lesson); `docs/STATE.md` §3/§3A/§7/§8/§9 synced with the §3A projection mirroring this record; final `check-doctor.sh` output recorded in Verification Evidence

## M0 Evidence (folded per owner instruction — spike Run #2, 2026-11-28)
- **A1 DOM-readable: validated.** Quests panel is pure DOM under a `.cozy-missions-panel` root: `H1 "Quests"`, `daily`/`weekly` tab buttons, mission rows (objective text, reward node, progress/status node), live countdown text node, aria-labeled buttons. The game world itself is canvas (2 canvases) but all UI chrome is HTML. `.cozy-mission-progress-fill` and `.cozy-mission-completion-check` carry state; `.cozy-missions-claim` exists in CSS (with `:disabled` states) but **0 claim elements were present in DOM** — completed quests show a completion-check + `Complete` status text (auto-grant; coins unchanged). `.starter-locked-missions` CSS variant exists but was not active.
- **A2 fishing-aligned: validated, n=1 day.** Daily: `Catch 10 fish` (550, Complete), `Sell 200 coins worth of fish` (500, Complete), `Place 1 furniture in your Burrow` (450, 0/1). Weekly: `Catch 75 fish` (1,550, Complete), `Catch 5 epic fish` (1,550, Complete), `Visit 10 friends' burrows` (1,500, 0/10). Fishing vs non-fishing classification is display-hint only (text-based), never an automation gate.
- **A3 reset boundary: validated-adjusted.** Daily countdown `12:49` at ~08:09 NZDT puts the daily reset at ~08:00 UTC; weekly countdown uses `D:HH:MM:SS` (`1:12:48:21`). **The bot reads the countdown from DOM and displays it as-is; it never assumes local midnight for missions** (the daily-cap clock in `session.js` is a separate concern).
- **A4 claim affordance: validated-nuanced.** Completed quests render status text (auto-grant); a `.cozy-missions-claim` control may appear on fresh completions. D1 is read-only: observe presence, never click. D2 (claiming) is a separate future task.
- **Capture shapes available for tests** (from live extraction): row text `Sell 200 coins worth of fish` + reward `500` + status `Complete`; row text `Place 1 furniture in your Burrow` + reward `450` + progress `0/1`; countdown `12:49:52` (daily) and `01:12:48:21` (weekly).
- **Open questions carried**: (1) Cozy/Cozier account status (my spike tab saw no Cozier scrim during an active 95-minute focus session; "Upgrade to Cozy" was visible in the tray) — affects how often HARD-1 skip logic fires, not its existence. (2) Whether the owner's own panel needed a restart after the spike's session-store writes. **Owner reply at sign-off (2026-11-28 08:37 UTC+13) echoed the question placeholders without answers; both remain unanswered and are recorded as unknown, never inferred.**

## Execution Policy
- **Mode**: `Gated Mode`
- **Batch Authorization**: `N/A - single-session, single-owner`
- **Soft Checkpoint**: `Around 60 minutes of implementation time`
- **Hard Checkpoint**: `At or before 90 minutes; stop and checkpoint regardless of completeness`
- **Event-Driven Checkpoints**: `Scope expansion, multi-contract discovery (would force a docs/specs/ file per owner instruction), or handoff`
- **Stop Conditions**: `Failed verification after 2 repair attempts, missing owner input, or owner stop`
- **Host Timer Capability**: `not measured`

## State and Ownership
- **Execution State**: `completed`
- **Mapped `pk:tasks` Status**: `Done`
- **Active Task Pointer**: `TASK-2026-11-28-missions-awareness-d1`
- **Start Time**: `2026-11-28 08:22 (UTC+13)`
- **Current Actor**: `ZCode session (GLM-5.3-Flash)`
- **Next Action**: Owner sign-off received ('sign-off commit') at 2026-11-28 08:37 (UTC+13); D2 (claim affordance) parked per owner instruction - not started.

### Transition History
| Previous State | New State | Timestamp | Actor | Reason | Evidence |
|---|---|---|---|---|---|
| `N/A` | `planned` | `2026-11-28 08:22 (UTC+13)` | `ZCode session` | `Created from Lite template at L2 Minimal depth (owner-directed)` | `scratch log Run #3` |
| `planned` | `in_progress` | `2026-11-28 08:22 (UTC+13)` | `ZCode session` | `M0 evidence folded; implementation starting` | `this record, M0 Evidence section` |
| `in_progress` | `awaiting_review` | `2026-11-28 08:45 (UTC+13)` | `ZCode session` | `Implementation complete; Extended-tier verification green; owner sign-off requested` | `npm run typecheck exit 0; node build-userscript.js exit 0; node --test 456/456; see Verification Evidence` |
| `awaiting_review` | `completed` | `2026-11-28 08:37 (UTC+13)` | `lead (owner reply)` | `Owner sign-off 'sign-off commit'; D2 parked per owner instruction` | `owner reply recorded in the scratch dogfood log (Run #3)` |

## Evidence and Completion
- **Changed Files**:
  - `src/missions.js` - new UMD module (125 ln / 5,164 B): thin `readQuests(doc)` DOM walk + pure `parseLines`/`shapeRead`/`countdownScope`; claim control observed, never activated
  - `tests/missions.test.js` - new (94 ln / 4,453 B): 8 tests over the captured M0 DOM shapes + assembly/export/report contract checks + a read-only (no `.click`) assertion
  - `panel.js` - `Missions` tier-2 fold (`section('Missions')`, collapsed by default), `renderMissions()`/`missionsBlock()` with per-scope last-read cache, `exportMissions()` hook, 8 CSS rows
  - `fishserve.js` - `latestMissions(dir)` helper + additive `missions` field on the `GET /report` response
  - `dashboard.html` - Missions panel section + `renderMissions()` in the refresh path
  - `autofish.js` - additive `missions` field in `exportRun()` (guarded hook, same contract as `panelState`)
  - `build-userscript.js` - `src/missions.js` added to `CORE_MODULES`
  - `types.d.ts` - `exportMissions?()` on the core interface + `AutoFishMissions?` on `Window`
  - `dist/autofish.user.js` - rebuilt (458,915 B)
  - `docs/README.md` - one index row for this record
  - `docs/STATE.md` - §3 pointers, §3A projection, §7 item 6 update, §8 continuity row, §9 spend row
  - `docs/tasks/TASK-2026-11-28-missions-awareness-d1.md` - this record
- **Scope Change Records**: `None`
- **Checkpoint Records**: `None`
- **Handoff Records**: `None`
- **Verification Evidence**: `npm run typecheck` exit 0 (after 4 JSDoc `@type` fixes in the new module - the only repair cycle); `node build-userscript.js` exit 0 (dist rebuilt, byte-freshness guard green); `node --test` 456/456 pass, exit 0 (448 pre-existing + 8 new, none regressed); final `check-doctor.sh` exit 0 with `docs-drift OK` and `state-freshness OK` (output at the gate).
- **CI Evidence**: `N/A - not run; no push`
- **Review Evidence**: `Owner sign-off received 2026-11-28 08:37 (UTC+13): reply 'sign-off commit' (sign-off + local atomic commit authorization; D2 explicitly not started)`
- **Commit Evidence**: `Pending - two-commit pattern per workflows/commit.md: the owner-confirmed milestone commit carries this record; the Commit Evidence entry citing that SHA is added by a docs-only follow-up commit`
- **Pull Request Evidence**: `N/A`
- **Release Evidence**: `N/A`
- **Blocker and Resume Condition**: `None`
- **Completion State**: `completed`
- **Acceptance Results**: `AC-1 met; AC-2 met; AC-3 met; AC-4 met; AC-5 met`
- **Changed-File Summary**: `13 files committed: 2 new (module + tests) + 7 implementation edits + dist rebuild + 4 docs (README row, STATE sync + archive repair, this record); 0 deletions of pre-existing behavior. The card's "12" became 13 because the state-guard archival repair touched docs/STATE-ARCHIVE.md during the gate.`
- **Completion Exception**: `None`
- **Completion Decision and Timestamp**: `Accepted - owner sign-off 'sign-off commit' at 2026-11-28 08:37 (UTC+13)`
