# Task Record: Scope the lofi.town daily-missions bot (paywall as constraint)
<a id="TASK-2026-11-28-daily-missions-scoping"></a>

## Identity
- **Record Type**: `Task Record`
- **Record Form**: `Lite`
- **Task ID**: `TASK-2026-11-28-daily-missions-scoping`
- **Ceremony Level**: `Level 2 (Controlled)`
- **Specification**: `None - scoping-only task run at L2 Minimal planning depth; the Full-planning RFC (docs/specs/) is deliberately deferred to implementation kickoff after the owner picks a direction`
- **Owner / Actor**: lead / ZCode session (GLM-5.3-Flash) - PromptKit OS dogfooding run for lowqualityloey/promptkit-os#607
- **Execution Scope**: `docs/tasks/TASK-2026-11-28-daily-missions-scoping.md` (new) plus `docs/STATE.md` sync (§3 pointers, §3A projection, §7 queued action, §8 continuity row, §9 spend row), plus per Scope Change 1: `docs/README.md` (two index rows: this record and the scope-1 record) and `docs/tasks/TASK-2026-11-28-daily-missions-scoping.scope-1.md`. No source, dist, tests, or config changes.
- **Approval Boundary**: Owner sign-off closes this record. Direction pick (D1/D2/D3) and any implementation planning, commit, push, or PR require explicit owner authorization in a later turn.
- **Created**: `2026-11-28 07:18 (UTC+13)`
- **Work Type**: `Research Work` (scoping/planning; documentation output)
- **TDD Enforcement Mode**: `N/A - exception work type (research/documentation; no code under test)`

## Boundaries
- **Objective**: Produce a decision-ready scoping block for a lofi.town daily-missions bot capability: candidate directions each with outcome, key assumption, and cheapest kill test; the Cozier focus-fishing paywall recorded as a hard design constraint; game-side unknowns captured as owned Assumption Records; and a phased milestone sketch - enough for the owner to pick a direction and authorize (or reject) implementation planning.
- **In Scope**:
  - Scoping content in this record (directions D1-D3, hard constraints, assumption records, milestone sketch M0-M2)
  - `docs/STATE.md` sync as listed under Execution Scope
- **Explicit Non-Goals**:
  - No missions-bot implementation (no `src/`, `autofish.js`, `panel.js`, `fishserve.js`, `dist/`, or `tests/` changes)
  - No Full-planning RFC/spec document in this task (deferred by design at Minimal depth)
  - No bypass, circumvention, or automation-around of the focus-fishing (Cozier) paywall, and no new scrim-dismissal behavior beyond the existing opt-in `Cozier popup` cosmetic toggle - hard constraint HARD-1, never negotiable at any ceremony level
  - No live game automation or DOM reconnaissance in this task (requires an owner-assisted live session)
  - No web research on game mechanics; game-side facts enter only as Assumption Records
- **Dependencies**: Owner-assisted live lofi.town session for the M0 DOM-reconnaissance spike (owner action, before implementation planning)
- **Risk**: Low - docs-only scoping change; primary risk is a wrong product direction, mitigated by three priced directions and an explicit owner decision gate before any build work
- **Verification Condition**: `npm run typecheck && node --test` exit 0 from the repository root (docs included); `bash .promptkit/scripts/check-doctor.sh` exit 0 with `state-freshness` OK; working tree carries no changes outside the two files in Execution Scope

## Acceptance Criteria
- [x] **AC-1**: This record contains a complete scoping: at least two candidate directions each with outcome, key assumption, and cheapest kill test; the paywall stated as a hard constraint; and a phased milestone sketch flagging the live-session dependency.
  - **Result**: `Met`
  - **Evidence**: this record, "Scoping" section (D1-D3 with outcome/assumption/kill test; HARD-1; M0-M2)
- [x] **AC-2**: Every game-side unknown material to the directions is captured as an `ASSUMPTION-*` record with impact, validation action, owner, and status - none asserted as fact.
  - **Result**: `Met`
  - **Evidence**: this record, "Assumption Records" table (`ASSUMPTION-1`..`4`, all `unvalidated` with owner and validation action)
- [x] **AC-3**: `docs/STATE.md` is synced: §3A projection points at this Task ID (level 2, state `awaiting_review`), §7 retains the carried v3.9.66 smoke action plus the missions follow-up, §8 gains exactly one new continuity row, §9 gains exactly one new spend row with honest `not measured`/unavailable markers.
  - **Result**: `Met`
  - **Evidence**: `git diff --stat docs/STATE.md` at the gate; `check-doctor.sh` `state-freshness OK` line (final run)
- [x] **AC-4**: At acceptance, `npm run typecheck` exits 0 and `node --test` exits 0 with all tests passing, and HEAD stays at `60f268c` throughout the work (no commits made by this task).
  - **Result**: `Met`
  - **Evidence**: `npm run typecheck` exit 0; `node --test` 448/448 pass (exit 0); HEAD verified `60f268c` (see Verification Evidence)

## Execution Policy
- **Mode**: `Gated Mode`
- **Batch Authorization**: `N/A - single-session, single-owner; no batched autonomous actions`
- **Soft Checkpoint**: `N/A - scoping block sized well under 60 minutes`
- **Hard Checkpoint**: `N/A - same reason`
- **Event-Driven Checkpoints**: `Owner direction change, scope expansion, or handoff`
- **Stop Conditions**: `Missing owner input, failed verification, or owner stop`
- **Host Timer Capability**: `not measured`

## State and Ownership
- **Execution State**: `completed`
- **Mapped `pk:tasks` Status**: `Done`
- **Active Task Pointer**: `TASK-2026-11-28-daily-missions-scoping`
- **Start Time**: `2026-11-28 07:13 (UTC+13)`
- **Current Actor**: `ZCode session (GLM-5.3-Flash)`
- **Next Action**: Run the M0 DOM-reconnaissance spike in an owner-assisted live session (validates `ASSUMPTION-1`..`4`), then plan D1 implementation as a separate Task Record (`pk:plan`, Full depth).

### Transition History
| Previous State | New State | Timestamp | Actor | Reason | Evidence |
|---|---|---|---|---|---|
| `N/A` | `planned` | `2026-11-28 07:18 (UTC+13)` | `ZCode session` | `Created from Lite template at L2 Minimal depth` | `N/A` |
| `planned` | `in_progress` | `2026-11-28 07:19 (UTC+13)` | `ZCode session` | `Scoping content drafted into this record` | `this record, Scoping section` |
| `in_progress` | `awaiting_review` | `2026-11-28 07:23 (UTC+13)` | `ZCode session` | `Verification tier green after scope change 1; owner sign-off requested` | `npm run typecheck exit 0; node --test 448/448; see Verification Evidence` |
| `awaiting_review` | `completed` | `2026-11-28 07:39 (UTC+13)` | `lead (owner reply)` | `Owner sign-off 'sign-off D1 commit'; D1 selected for the first implementation pass` | `owner reply recorded in the session dogfood log (scratch)` |

## Scoping (Deliverable)

### Context from repo evidence (read this session)
- **Paywall (measured 2026-10-28, free account; `AUTOFISH.md` "Focus sessions and the Cozier popup")**: joining a public focus session works on a free account but mounts a non-dismissible full-screen "Fish while you focus with Cozier" modal; a free account cannot focus-fish while it runs. The panel already detects focus sessions via the `FOCUS` page-title channel, offers the off-by-default `Cozier popup` cosmetic toggle for the upsell scrim, and the `no-catch` watchdog notices a paywalled focus session. The owner framed this paywall as **a constraint, not a bug** (handoff 2026-11-28) - recorded as HARD-1 below.
- **Existing surface a missions bot can reuse**: fishing loop plus guards (`seat`, `hidden`, `focus`, `no-catch`, `cast-stall`, `player-block`, `profile-open`, `result-missing`), catch ledger + species catalogue, Timed daily budget, Flow mode, `fishserve.js` + `/dashboard`, and the headless simulator test path (`tests/simulator.test.js`).
- **Intersection with STATE.md §7 field items**: daily-mission resets interact with the midnight-rollover question (§7 item 2) and the daily-cap clock semantics.

### Hard constraints
- **HARD-1 (paywall)**: A missions bot must never bypass, weaken, or automate around the Cozier focus-fishing paywall. Missions that require Cozier/focus-fishing are detected, reported honestly in panel/dashboard copy (same plain-English voice as existing pause reasons), and skipped. No new scrim-dismissal behavior beyond the existing opt-in `Cozier popup` toggle. - source: owner instruction 2026-11-28 ("with the focus-fishing paywall as a constraint, not a bug"); reinforced by PRODUCT.md principles 2 (honesty) and 3 (stay out of the game's way).
- **HARD-2 (client-side input only)**: Same trust level as the existing dial press - synthetic input in a visible tab only, no network manipulation; the STATE.md §5 ban-risk framing carries over unchanged.
- **HARD-3 (panel budget)**: Any missions UI fits the existing `<=264 px` panel footprint budget (PRODUCT.md).

### Candidate directions
- **D1 - Mission awareness (read-only)**: read daily missions and show per-mission progress in a folded panel section and on `/dashboard`; no new game actions. Outcome: owner sees missions without opening game UI; zero added gameplay risk. Key assumption: `ASSUMPTION-1`. Cheapest kill test: the M0 spike's 10-minute live DOM inspection.
- **D2 - Mission-aware fishing assistant**: D1 plus session progress annotation ("this session advanced X") and auto-claim of completed missions via the same synthetic-click trust as the dial press. Outcome: missions complete as a byproduct of fishing. Key assumptions: `ASSUMPTION-1` + `ASSUMPTION-4`. Cheapest kill test: M0 confirms the claim affordance is a plain DOM click.
- **D3 - Full missions bot**: D2 plus mission-targeted behavior (e.g., preferring actions that advance missions). Outcome: maximal automation. Key assumptions: `ASSUMPTION-1`..`ASSUMPTION-4` plus a mission-action mapping. Cheapest kill test: explicit owner go/no-go after M0; recommended to defer.

**Recommendation**: D1 then D2, phased; D3 stays out of scope for the first release.

- **Owner decision (2026-11-28 07:39 UTC+13, sign-off reply)**: D1 selected for the first implementation pass; D2 remains the follow-on candidate; D3 deferred.

### Phased milestone sketch (implementation would be a separate Task Record)
- **M0 (`pk:spike`, owner-assisted live session)**: DOM reconnaissance - missions UI structure, state semantics, reset boundary, claim affordance, Cozier-gated mission detection. Exit: `ASSUMPTION-1`..`ASSUMPTION-4` validated or killed.
- **M1**: mission reader + panel and `/dashboard` display (pure read path; simulator-testable like the existing vision modules).
- **M2**: auto-claim + paywall-skip reporting (gated on M0 evidence; separate Task Record).

### Assumption Records
| ID | Assumption | Impact if wrong | Validation action | Owner | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ASSUMPTION-1` | Daily missions and their state are readable from the page DOM (no canvas/vision readback needed). | D1/D2 detection cost balloons into vision work like the dial reader. | M0 live DOM inspection | lead | unvalidated |
| `ASSUMPTION-2` | Mission objectives align with actions the bot already performs (fishing counts/species), not separate minigames. | D2 value drops; D3 scope grows beyond fishing. | M0 inspection of objective texts | lead | unvalidated |
| `ASSUMPTION-3` | Missions reset on a daily boundary compatible with the bot's local-midnight daily-cap semantics. | Mission-day tracking desyncs around rollover. | M0 plus the §7 midnight field-run | lead | unvalidated |
| `ASSUMPTION-4` | Completed missions expose a claim affordance reachable by the same synthetic-click trust level as the dial press. | D2 auto-claim is unsafe; fall back to D1 plus manual claim. | M0 claim-affordance check | lead | unvalidated |

## Evidence and Completion
- **Changed Files**:
  - `docs/tasks/TASK-2026-11-28-daily-missions-scoping.md` - new Task Record (this file)
  - `docs/STATE.md` - §3 pointers, §3A projection, §7 queued action, §8 continuity row, §9 spend row
  - `docs/README.md` - one index row for the new task record (Scope Change 1)
  - `docs/tasks/TASK-2026-11-28-daily-missions-scoping.scope-1.md` - Scope Change Record (Scope Change 1)
- **Scope Change Records**: `docs/tasks/TASK-2026-11-28-daily-missions-scoping.scope-1.md` - added the `docs/README.md` index row demanded by `tests/docs.test.js:32` after the first `node --test` run failed on the unindexed record
- **Checkpoint Records**: `None`
- **Handoff Records**: `None`
- **Verification Evidence**: `npm run typecheck` exit 0; `node --test` 448/448 pass, exit 0 (final run, executed 2026-11-28 with all four changed files in tree). Two earlier `node --test` runs exited 1 on `tests/docs.test.js:32` (unindexed new records: first the task record, then the scope-1 record) - resolved by indexing both in `docs/README.md` via Scope Change 1; the test was not modified. `check-doctor.sh`: exit 0 pre-change (install verification) and exit 0 at the gate (`docs-drift OK - projection agrees with the canonical Task Record`; `state-freshness OK: 163 lines / 5844 tok`); two intermediate doctor runs exited 1 on `docs-drift DIVERGED` while the 3A projection was being reconciled field-by-field to this authoritative record (last divergence: `Owner / Current Actor` naming difference between this record's Identity and State sections).
- **CI Evidence**: `N/A - not run; no push`
- **Review Evidence**: `Owner sign-off received 2026-11-28 07:39 (UTC+13): reply 'sign-off D1 commit' (sign-off + D1 direction pick + local commit authorization)`
- **Commit Evidence**: `Pending - two-commit pattern per workflows/commit.md: the owner-confirmed milestone commit carries this record; the Commit Evidence entry citing that SHA is added by a docs-only follow-up commit (a commit cannot contain its own hash)`
- **Pull Request Evidence**: `N/A`
- **Release Evidence**: `N/A`
- **Blocker and Resume Condition**: `None`
- **Completion State**: `completed`
- **Acceptance Results**: `AC-1 met; AC-2 met; AC-3 met; AC-4 met`
- **Changed-File Summary**: `4 files: 1 new Task Record + 1 tracker sync + 1 docs index row + 1 scope change record; 0 source/dist/test changes`
- **Completion Exception**: `None`
- **Completion Decision and Timestamp**: `Accepted - owner sign-off 'sign-off D1 commit' at 2026-11-28 07:39 (UTC+13)`
