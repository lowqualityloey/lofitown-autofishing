# Task Record: D2 — mission auto-claim awareness & handling (HARD-1 preserved)
<a id="TASK-2026-11-28-missions-claim-d2"></a>

## Identity
- **Record Type**: `Task Record`
- **Record Form**: `Lite`
- **Task ID**: `TASK-2026-11-28-missions-claim-d2`
- **Ceremony Level**: `Level 2 (Controlled)` — `preset: solo-fast` (Lite task record by default; preset applied 2026-11-28 09:01 via `./.promptkit/init.sh --solo-fast`, verified `grep '^preset:' PROMPTKIT.md` → `preset: solo-fast`, `check-doctor.sh` exit 0)
- **Specification**: `None - L2 Lite planning under preset solo-fast; M0 claim evidence (TASK-2026-11-28-missions-awareness-d1) and the D1 implementation are the folded evidence base`
- **Owner / Actor**: lead / ZCode session (GLM-5.3-Flash) - PromptKit OS dogfooding Run #4 for lowqualityloey/promptkit-os#607 (balanced + solo-fast)
- **Execution Scope**: `src/missions.js`, `autofish.js`, `panel.js`, `fishserve.js`, `dashboard.html`, `types.d.ts`, `tests/missions.test.js`, `dist/autofish.user.js` (rebuild), `docs/STATE.md`, `docs/README.md` (one index row for this record), `docs/tasks/TASK-2026-11-28-missions-claim-d2.md` (this record)
- **Approval Boundary**: Owner sign-off closes this record. Local commit only on explicit owner ask; no push, tag, or PR.
- **Created**: `2026-11-28 09:01 (UTC+13)`
- **Work Type**: `Code Work`
- **TDD Enforcement Mode**: `disabled` - dependency-ordered milestones with a complete test strategy (repo convention); the pure claim planner is unit-tested regardless

## Boundaries
- **Objective**: Extend the D1 read-only missions awareness with D2's claim awareness and handling: the Quests read detects claim controls and plans claims only under an exact-match rule; an opt-in (default off), guarded panel pass claims completed missions through the same synthetic PointerEvent trust as the dial press; claim state surfaces in the panel fold, `/dashboard`, and the capture path additively. The Cozier focus-fishing paywall is never bypassed (HARD-1), and every D1 read-only guarantee holds everywhere except the single new guarded claim path.
- **Authorization note**: D2 was parked at the D1 sign-off (2026-11-28 08:37, "D2 parked per owner instruction"). This session carries a fresh owner instruction (2026-11-28, this task's brief) explicitly directing D2 (mission auto-claim awareness/handling) under the solo-fast preset - that instruction is the lifting go, recorded here per the parking condition.
- **In Scope**:
  - `src/missions.js` - pure `planClaims(read)` planner (exact-match rule, honest auto-grant/ambiguous reasons) + `readQuests` carrying `claimCount` and the `claims` plan; the reader itself stays activation-free
  - `autofish.js` - `F.pressElement(el)`: one guarded element-targeted PointerEvent press (pointerover/move/down/up), the only new input primitive, same trust level as `tap()`
  - `panel.js` - `autoClaim` pref (off by default) with Settings toggle row; `autoClaimPass()` orchestrator (guards below) on a 60 s scheduler; Missions rows annotate claimable state; `exportClaimState()` hook; capture export gains additive `claims`
  - `fishserve.js` - `latestMissions()` also returns the additive `claims` field when a snapshot carries it
  - `dashboard.html` - claimable row in the Missions section
  - `types.d.ts`, `tests/missions.test.js` (planner unit tests + guard contract assertions)
  - `docs/STATE.md` sync + `docs/README.md` index row
- **Explicit Non-Goals**:
  - No D3 mission-targeted behavior; no changes to the fishing loop, guards, or dial/vision paths (`src/loop.js` untouched)
  - No session-progress annotation ("this session advanced X") - the presentational half of D2 is deferred as a separate follow-up; this task is the owner-directed claim awareness/handling half
  - No paywall bypass or interaction (HARD-1): the claim pass stands down while a focus session is active or the Cozier upsell overlay is on screen, and only ever presses `.cozy-missions-claim` controls inside the Quests panel
  - No breaking changes to existing capture consumers (additive optional fields only)
  - No live game automation in this task: verification is unit + contract tests; a live claim smoke needs an owner-assisted session and stays owner-gated
- **Dependencies**: M0 claim-affordance evidence (`.cozy-missions-claim` CSS with `:disabled` states, 0 controls present at spike time, completed rewards auto-granted) and the D1 reader, both folded in `TASK-2026-11-28-missions-awareness-d1`
- **Risk**: Low-Medium - exactly one new input path, behind an off-by-default toggle, clicking only exact-match-planned controls; mitigated by a pure planner under unit test, guard contract assertions, per-objective dedupe, and the full Extended-tier suite
- **Verification Condition**: `npm run typecheck && node build-userscript.js && node --test` exit 0 from the repository root with no pre-existing test regressed and the D1 read-only assertions unmodified; `check-doctor.sh` exit 0; `docs/README.md` index present before any test run

## Acceptance Criteria
- [x] **AC-1**: A pure `planClaims(read)` decides claims only under an exact match: the number of visible `.cozy-missions-claim` controls equals the number of completed missions, paired in row order; zero controls with completed rows reads honestly as auto-grant; any mismatch reads as ambiguous and plans nothing; nothing is fabricated.
  - **Result**: `Met`
  - **Evidence**: `tests/missions.test.js` planner tests (4 tests: exact match plans completed indices in row order; zero controls with completed rows = auto-grant with an empty plan; count mismatch = ambiguous with a spelled-out reason; malformed input safe) - all passing in the final `node --test` run
- [x] **AC-2**: `readQuests` carries `claimCount` and the `claims` plan on every read; the reader and the panel's Missions rendering stay activation-free - the D1 read-only contract test passes **unmodified**.
  - **Result**: `Met`
  - **Evidence**: `tests/missions.test.js` 'the panel never activates the claim control - read-only by contract' (byte-identical to the D1 version - the patch script only *appended* tests) passes in the final run; `src/missions.js` and the `renderMissions`..`missionsBlock` slice contain no `.click(`; the only press path is `autoClaimPass()` -> `F.pressElement()`
- [x] **AC-3**: Claim handling exists only as `autoClaimPass()` (panel) pressing through `F.pressElement()` (core), and every pass enforces: pref on (default off), visible tab, no focus session hold, no Cozier upsell overlay on screen (HARD-1 stand-downs), a non-ambiguous plan, controls still present and re-counted at click time, inside `.cozy-missions-panel`, not disabled, rendered, and never twice for the same objective; the pass never throws into the session.
  - **Result**: `Met`
  - **Evidence**: `tests/missions.test.js` 'the D2 claim pass guards every click' asserts every guard in the `autoClaimPass` source slice plus no `.click(`; 'the core press primitive' asserts the PointerEvent sequence + visibility guard in `F.pressElement`; 'auto-claim is a persisted pref that defaults off' asserts `var autoClaimPref = false` + load/save prefs wiring; scheduler throws are swallowed by design (a claim problem must never reach the session)
- [x] **AC-4**: Claim state is visible and additive: the Missions fold annotates claimable rows within the `<=264 px` budget (HARD-3), `exportRun()` carries `claims`, `fishserve.js` `/report` serves it, and `/dashboard` renders it; existing consumers keep working unchanged.
  - **Result**: `Met`
  - **Evidence**: `missionsBlock()` reuses the existing row status span (text + one CSS class, no width change); `exportRun` gains `claims` via the same guarded-hook contract as `missions` ('exportRun carries the claim state additively' test); `latestMissions` returns `claims: rec.claims || null` ('latestMissions serves the additive claims field' test); dashboard renders a Claimable row only when a snapshot carries one; all pre-existing export/report/catch tests passed unchanged in the final run
- [x] **AC-5**: At acceptance, `npm run typecheck`, `node build-userscript.js`, and `node --test` all exit 0 (456 pre-existing + 10 new tests, none regressed); `docs/STATE.md` and `docs/README.md` are synced; `check-doctor.sh` exits 0 with `docs-drift OK` and `state-freshness OK`.
  - **Result**: `Met`
  - **Evidence**: final runs recorded in Verification Evidence; `docs/README.md` index row landed before the first test run (Run #1 lesson)

## Execution Policy
- **Mode**: `Gated Mode`
- **Batch Authorization**: `N/A - single-session, single-owner`
- **Soft Checkpoint**: `Around 60 minutes of implementation time`
- **Hard Checkpoint**: `At or before 90 minutes; stop and checkpoint regardless of completeness`
- **Event-Driven Checkpoints**: `Scope expansion beyond the listed files, multi-contract discovery, or handoff`
- **Stop Conditions**: `Failed verification after 2 repair attempts, missing owner input, or owner stop`
- **Host Timer Capability**: `not measured`

## State and Ownership
- **Execution State**: `completed`
- **Mapped `pk:tasks` Status**: `Done`
- **Active Task Pointer**: `TASK-2026-11-28-missions-claim-d2`
- **Start Time**: `2026-11-28 09:01 (UTC+13)`
- **Current Actor**: `ZCode session (GLM-5.3-Flash)`
- **Next Action**: Owner sign-off received ('sign-off D2 commit') at 2026-11-28 09:21 (UTC+13); local atomic commit authorized (pre-existing dirt, `.pkab/`, and the scratch #607 log excluded). A live claim smoke against the real Quests panel remains an owner-assisted follow-up - the game has shown zero live claim controls so far (auto-grant), so first live behavior is expected to be honest "nothing to claim" reports.

### Transition History
| Previous State | New State | Timestamp | Actor | Reason | Evidence |
|---|---|---|---|---|---|
| `N/A` | `planned` | `2026-11-28 09:01 (UTC+13)` | `ZCode session` | `Created from Lite template at L2 depth under preset solo-fast (fresh owner go lifting the 08:37 D2 parking)` | `this record, Authorization note` |
| `planned` | `in_progress` | `2026-11-28 09:05 (UTC+13)` | `ZCode session` | `Implementation starting (scratch-anchor patch flow per repo convention)` | `scratch log Run #4` |
| `in_progress` | `awaiting_review` | `2026-11-28 09:10 (UTC+13)` | `ZCode session` | `Implementation complete; Extended-tier verification green on first runs; owner sign-off requested` | `npm run typecheck exit 0; node build-userscript.js exit 0; node --test 466/466; see Verification Evidence` |
| `awaiting_review` | `completed` | `2026-11-28 09:21 (UTC+13)` | `lead (owner reply)` | `Owner sign-off 'sign-off D2 commit'; local atomic commit authorized` | `owner reply recorded in the session scratch dogfood log (Run #4)` |

## Design Notes (Lite planning content)
- **Claim planning is pure and conservative.** `planClaims({ missions, claimCount })` returns `{ count, planned, ambiguous, reason }`: exact match (claimCount === completed count) plans the completed indices in row order; zero controls with completed rows returns the honest auto-grant reason with an empty plan; any other combination is `ambiguous` with a spelled-out reason and an empty plan. M0 evidence says completed quests normally show no controls at all (auto-grant), so the planner's most common answer must be "nothing to claim", never a guess.
- **One input primitive, everything else guards.** The core gains only `F.pressElement(el)` (PointerEvent over/move/down/up on one element, mirroring `tap()`'s trust, plus the bot-wide visible-tab refusal). The panel's `autoClaimPass()` owns every decision: pref, visibility, focus-hold stand-down, upsell stand-down (reuse `upsellRoot()`), fresh read + plan, re-count at click time, `.cozy-missions-panel` containment, `disabled`/rendered checks, per-objective dedupe. A failed or skipped pass records an honest reason in `claimState` and never throws.
- **Read-only guarantees stay intact elsewhere.** `src/missions.js` gains no activation; `renderMissions()`/`missionsBlock()` gain no activation (the D1 no-click contract test passed unmodified); the only `.cozy-missions-claim` press path is `autoClaimPass()` -> `F.pressElement()`.
- **Scheduling mirrors existing timers.** A 60 s `claimTimer`, armed only while the pref is on (same arm/disarm pattern as `upsellTimer`), independent of the fishing tick - the loop is not touched.

## Evidence and Completion
- **Changed Files**:
  - `src/missions.js` - +35 ln (125 → 160): pure `planClaims` planner, `readQuests` carries `claimCount`/`claims`, header updated; still click-free
  - `autofish.js` - +32 ln: `F.pressElement` (element-targeted PointerEvent press with visibility refusal) + additive `claims` field in `exportRun()`
  - `panel.js` - +118 ln: `autoClaimPref`/`claimDone`/`claimState`/`claimTimer` state, Settings `Auto-claim missions` toggle row (off by default) + aria + ui wiring + handler, 60 s `autoClaimPass()` scheduler with all guards, `exportClaimState()` + core hook, Missions rows claimable annotation, 1 CSS row
  - `fishserve.js` - `latestMissions()` returns additive `claims` field
  - `dashboard.html` - Claimable row in the Missions section (rendered only when a snapshot carries claims)
  - `types.d.ts` - `pressElement?()` + `exportClaimState?()` on `FishApi`
  - `tests/missions.test.js` - +103 ln (94 → 197): 10 new tests (4 planner, reader click-free, press primitive, exportRun additive, guarded pass contract, prefs default-off, fishserve additive)
  - `dist/autofish.user.js` - rebuilt (byte-freshness guard green in the suite)
  - `docs/README.md` - one index row for this record (before the first test run)
  - `docs/STATE.md` - §3 pointers, §3A projection, §7 item 6 update, §8 continuity row, §9 spend row
  - `docs/tasks/TASK-2026-11-28-missions-claim-d2.md` - this record
- **Scope Change Records**: `None`
- **Checkpoint Records**: `None`
- **Handoff Records**: `None`
- **Verification Evidence**: `npm run typecheck` exit 0 (first run, zero repair cycles - the D1 `@type` annotation idiom applied pre-emptively); `node build-userscript.js` exit 0 (first run; dist rebuilt); `node --test` 466/466 pass, exit 0 (first run: 456 pre-existing + 10 new, none regressed; the D1 read-only contract test passed unmodified); `check-doctor.sh` exit 0 at the gate (session run 2): `docs-drift OK - projection agrees with the canonical Task Record`; `state-freshness OK: 160 lines / 5606 tok` - no archival repair needed. Preset-switch doctor run 1 exit 0 pre-task (158 lines / 4997 tok).
- **CI Evidence**: `N/A - not run; no push`
- **Review Evidence**: `Owner sign-off received 2026-11-28 09:21 (UTC+13): reply 'sign-off D2 commit' (sign-off + local atomic commit authorization; pre-existing dirt, .pkab/, and the scratch #607 log excluded; no push, no PR)`
- **Commit Evidence**: `Owner-confirmed milestone commit on main (2026-11-28; 11 files; pre-existing dirt and .pkab/ excluded) - SHA and diffstat recorded by the docs-only follow-up commit per the workflows/commit.md two-commit pattern`
- **Pull Request Evidence**: `N/A`
- **Release Evidence**: `N/A`
- **Blocker and Resume Condition**: `None`
- **Completion State**: `completed`
- **Acceptance Results**: `AC-1 met; AC-2 met; AC-3 met; AC-4 met; AC-5 met`
- **Changed-File Summary**: `11 files in scope: 1 new Task Record + 8 code/test/dist edits + 2 docs syncs (README row, STATE sync); pre-existing CRLF/mode dirt and .pkab/ untouched; src/loop.js untouched`
- **Completion Exception**: `None`
- **Completion Decision and Timestamp**: `Accepted - owner sign-off 'sign-off D2 commit' at 2026-11-28 09:21 (UTC+13)`
