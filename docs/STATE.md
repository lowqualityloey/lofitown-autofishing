# Project State & Living Execution Tracker

## 1. Executive Summary & Current Position
- **Project Name**: lofitown-autofishing (autofish 3.0 + in-game control panel)
- **Current Milestone / Epic**: Milestone 2 — trustworthy accuracy and seat-aware sessions (fish-attempt
  oracle, catch ledger, frame budget, seat pauses); Milestone 1 (in-game panel) closed
- **Overall Status**: ACTIVE — private repo published at github.com/lowqualityloey/lofitown-autofishing
- **Target Release / Deadline**: v1.0.0 usable panel / not tracked
- **Current Working Branch**: main
- **Last Updated**: 2026-10-28
- **Engine Version**: v2.0.1 @ unknown

---

## 2. Milestone & Task Progress

### Milestone Roadmap
- [/] **Milestone 1** — in-game AutoFish panel: session reducer, server session records, core
  pause/zones hooks, collision-free placement, HUD, guards G1-G7, wake lock + reload resume,
  bookmarklet install page. Code + 33 unit tests. Live verification: panel mounts, real-click
  Start/Stop, counters, cooldown, drag release and adaptive prompt detection all observed in the
  browser; 1 Salmon caught by the bot in 24 s at 1234x1023.

- [/] **Milestone 2** — trustworthy accuracy: the per-fish-attempt oracle replaced per-press scoring
  (28 caught / 30 attempts, Wilson 95% CI 78.7-98.2%); the dial search went from 83 ms to 4 ms a
  call; fishing was found to be seat-based, so a missing cast prompt is now named, the session clock
  pauses while unseated, and the pause honours the clock window and the daily cap. 110 tests.
- [x] **Milestone R** — private repository published (README, MIT licence, docs index); `shots/`
  (game bundle, screenshots) and the local PromptKit scaffolding stay out of git.

### Active Milestone Task Breakdown
Track tasks using atomic checklists (`[x]` Done, `[/]` In Progress, `[ ]` Queued, `[!]` Blocked):

- [x] T1 session reducer (`session.js`) — 6 tests
- [x] T2 server session records + static assets (`fishserve.js`) — 6 tests
- [x] T3 core hooks: `__fish.pause/resume/resetStats/zones`, `onCatch`, panel-safe `tap`
- [x] T4 placement math (`layout.js`) — 8 tests
- [x] T5 HUD shell (`panel.js`): shadow DOM, drag, 1 Hz counters, Start/Stop
- [x] T6 duration / clock window / waiting state
- [x] T7 guards G1-G7 + session log rows — 10 tests
- [x] T8 wake lock + reload survival
- [x] T9 install page (`install.html`) + userscript (`autofish.user.js`)
- [x] T10 docs — AUTOFISH.md run + "finding the prompt at any window size" sections; observed-vs-reasoned checklist in `docs/reviews/2026-10-27-panel-verification.md` (follow-up round appended)

---

## 3. Active Working Set
- **Target Workspace / Package (if Monorepo)**: standalone repo, no bundler, plain CommonJS + browser globals
- **Active RFC / Spec**: `docs/specs/2026-10-27-in-game-panel-design.md` (approved)
- **Active Task Spec**: `docs/superpowers/plans/2026-10-27-autofish-panel.md` (approved route)
- **Key Source Files in Flight**: `autofish.js`, `panel.js`, `session.js`, `layout.js`, `build-userscript.js`, `dist/autofish.user.js`, `tests/*.test.js`
- **Verification Commands (Scoped)**:
  - Unit Tests: `node --test` (never `node --test tests/` — fails on Node v24.22.1)
  - Server smoke: `FISHSERVE_PORT=8741 node fishserve.js` then `curl -s localhost:8741/recent?n=1`
  - Typecheck / Linter: none configured

---

## 3A. Execution-Control Projection (Optional)

> This section is a synchronized projection for checkpoint continuity when the host project uses Controlled Work. The canonical authority remains `docs/tasks/<task-id>.md`; disagreement with that record is a validation failure and leaves execution blocked or `checkpoint_due` until reconciled. When a field carries verbatim command output containing a pipe character (for example a validator summary `VALID|RECORDS=28`), escape it as `\|` inside markdown table cells so the table does not read it as a column separator; it then renders as the verbatim `|`.

- **Local Task Source**: `docs/tasks/<task-id>.md`
- **Task ID**: `TASK-<task-slug>` (preserve `TASK-YYYY-MM-DD-<slug>` for legacy/`none`-profile records)
- **Task Record**: `docs/tasks/<task-id>.md`
- **Ceremony Level**: `[Level 1 (Standard) | Level 2 (Controlled) | Level 3 (Release-Critical)]`
- **Specification**: `docs/specs/[specification].md`
- **Execution Scope**: `[Repository, workspace, package, or session boundary]`
- **Execution State**: `[planned | ready | in_progress | checkpoint_due | blocked | paused | handoff_ready | awaiting_review | completed | aborted]`
- **Mapped `pk:tasks` Status**: `[To Do | In Progress | In Review | Done]`
- **Active Task Pointer**: `[Task ID while active, otherwise None]`
- **Owner / Current Actor**: `[Person, role, agent, or session]`
- **Start Time**: `[YYYY-MM-DD HH:MM UTC or N/A]`
- **Current Branch**: `[Branch name]`
- **Current Revision**: `[Exact commit or revision]`
- **Checkpoint Policy**: `[Soft/hard intervals, event triggers, and host timer capability/limitation]`
- **Blockers and Resume Condition**: `[Blocker, owner, evidence, and precise condition, or None]`
- **Verification Status**: `[Commands, results, and timestamp]`
- **CI Evidence**: `[Provider, workflow/job, run, revision, result, or N/A]`
- **Changed-File Summary**: `[Current working set summary]`
- **Latest Checkpoint**: `[Record path or None]`
- **Latest Handoff**: `[Record path or None]`
- **Next Action**: `[Exactly one prioritized action]`

#### Field-mapping (checkpoint labels)

| Label | Quick (L1) required | From /handoff payload | Derivable from local git | Degrades to (when unmappable) |
| :--- | :--- | :--- | :--- | :--- |
| Record Type | yes | no | no | n/a |
| Checkpoint ID | yes | no | no | n/a |
| Task ID | no | yes | no | TRACEABILITY_MISSING (full); `N/A — no Task Record (Level 0/1)` (quick) |
| Specification | no | yes | no | POLICY_LIMITATION |
| Created | yes | partial | yes | n/a |
| Checkpoint Type | no | no | no | POLICY_LIMITATION |
| Execution State | yes | yes | no | not measured |
| Objective | yes | yes | no | not measured |
| Completed Work | no | partial | no | not measured |
| Remaining Work | yes | partial | no | not measured |
| Changed Files | no | yes | yes | not measured |
| Branch / Revision | no | yes | yes | n/a |
| Locked Decisions and Invariants | no | yes | no | not measured |
| Verification Evidence | no | yes | no | not measured |
| CI Evidence | no | partial | no | POLICY_LIMITATION |
| Blockers | yes | partial | no | not measured |
| Scope Changes | no | partial | no | not measured |
| Next Action | yes | yes | no | not measured |
| Resume Condition | yes | partial | no | not measured |
| Recorded By | yes | no | no | POLICY_LIMITATION |

The importer emits a `Ceremony Level` line in every draft whose level is known, so a `quick` draft re-validates at the quick tier. Level 0 payloads are refused (`REFUSED-L0`); unlabeled payloads default fail-closed to the `full` tier. Verdicts: `QUICK-VALID` (all ten quick labels resolve at Level 1; unresolved full-only labels degrade via `POLICY_LIMITATION` and are never reported as full-valid), `FULL-VALID` (all 20 labels and a resolvable Task ID), otherwise `DRAFT-INCOMPLETE`. The exit status is 0 only for `QUICK-VALID` or `FULL-VALID`. A resolvable linked Task Record owns the tier: a lower payload claim is flagged as a downgrade (`POLICY_LIMITATION`) and the draft takes the record's level. A supplied `Task ID` that does not resolve, or a `Checkpoint ID` that is not a stable canonical ID, stays visible in the draft and counts as unresolved, so canonical re-validation reports the same failure.

---

## 3B. Release-Evaluation Handoff (Optional)

> Use this projection only when PromptKit OS release evaluation is being handed from QA/Reviewer to a Release Coordinator. It is a durable handoff, not approval, and the canonical evaluation or Task Record remains authoritative.

- **Evaluation ID**: `[evaluation ID or N/A]`
- **Release Candidate Commit**: `[exact candidate revision or N/A]`
- **Preliminary SemVer Candidate**: `[preliminary version, including prerelease identifier when applicable, or N/A]`
- **QA/Reviewer Result**: `[Pass | Fail | Pending | N/A]`
- **Unresolved Blockers**: `[blocker, owner, and resolution condition, or None]`
- **Requested Release Coordinator Decision / Next Approval Action**: `[exact human decision requested, or N/A]`
- **Handoff Status**: `[Ready for Coordinator Review | Blocked | Deferred | N/A]`
- **Approval Boundary**: `This projection does not approve a candidate or version and does not authorize tag creation, hosted release creation, changelog publication, remote operations, deployment, or rollback.`
- **Source Evaluation / Task Record**: `[authoritative record path or N/A]`

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
  - none for the panel code; live in-game verification of the guards and of actual fishing at the
    user's window size is still outstanding.
- **Architectural Questions**:
  - none open — placement, history storage, pause semantics and the clock-window meaning were settled
    in the approved spec.
- **Technical Debt & Risks**:
  - **Viewport-sensitive core.** `findBubble`/`findCatch` scan fixed rects
    (`autofish.js:111` box x690-1050 y215-425, `autofish.js:150` box x620-985 y315-720) tuned for
    1522x954 with the user's camera position. Measured in the agent browser at 1620x1031: the live
    `REEL!` bubble rendered at (810,88), i.e. 127 px above the scan box, and `__fish.findBubble()`
    returned `null` while the prompt was plainly on screen, so the bot never cast. The prompt is
    anchored in world space above the player, so it moves with the camera, not only with the window
    size. Not fixed here on purpose: the current boxes are the configuration the account has 85
    logged catches with. A wider or player-relative scan is the follow-up if the bot ever stops
    casting in the user's own window.
  - **Port collision.** Port 8731 on the Windows host is held by an older fishserve that answers
    404 for `/panel.js`. The browser talks to whatever listens there, not to the WSL instance. Use
    `FISHSERVE_PORT=8741` (or stop the old process) — the panel derives its API origin from its own
    script URL, so any port works.
  - **Ban risk** sits entirely with the user's account; the bot does client-side input only and
    refuses to run while the tab is not visible.

---

## 6. Recent Architectural Decisions (ADR Log)
| Date | Title & Scope | Decision Summary | ADR File |
| :--- | :--- | :--- | :--- |
| 2026-10-27 | Control surface | In-game floating DOM panel (shadow root) instead of a local dashboard page, because a separate window would cover the game and a hidden/covered game freezes. | `docs/specs/2026-10-27-in-game-panel-design.md` |
| 2026-10-27 | Session history | Records live in the server (`sessions.csv`, `GET /sessions?day=`), never in localStorage. | same spec |
| 2026-10-27 | Pause semantics | Pause is not a stop: no cooldown, and paused/waiting time never counts toward session length or the daily cap. | same spec |
| 2026-10-28 | Catch history | Per-catch ledger in `localStorage` (`autofish:log:v1`), written only from parsed catch text. Session records stay server-only; the ledger is history, never a scoreboard, and rarity may be filled from the embedded catalogue with `derived:true`. | `docs/specs/2026-10-28-catch-log.md` |
| 2026-10-27 | Placement | Panel position comes from the live exclusion rect (`__fish.zones()`) at runtime, not from fixed coordinates; no room means collapse to the pill. | same spec |
| 2026-10-28 | Frame budget | UI `getImageData` is a GPU readback (~2.1 ms per 360x210 box). The bubble scan is throttled to 25 Hz idle / 11 Hz with a dial locked, the whole-surface prompt scan to 3 Hz, and per-pixel loops read channels by index. The dial sample keeps the full loop rate because accuracy depends on it. Measured: the old build held the page at 27.6 fps, this one at 111-138 fps. | `AUTOFISH.md` 2026-10-28 frame rate |
| 2026-10-28 | Accuracy oracle | A press is never a win or a loss. The unit is the fish attempt: opened by the first press after the last catch, closed by parsed catch text (caught) or by the cast prompt returning (lost). Rarity/time-limit tables were read out of the game bundle; one fish is many presses on a level bar. | `AUTOFISH.md` one fish is many presses |
| 2026-10-28 | Seat-based fishing | `showCastButton` is emitted only from the character's sit path, so an unseated character can never be rescued by clicking. The bot never synthesises movement (an earlier walk rung unseated the character and lost the run) and names the condition as `needsSeat` after 45 s without a prompt. | `AUTOFISH.md` why the bot stops casting |
| 2026-10-28 | Seat pause | `fact.seat` pauses the session before any fishing time is credited, without pausing the core (the core is what spots the returning prompt). The pause honours the clock window and an already-spent daily cap, and ends with `no-seat` after 30 minutes. | this file, section 7 |
| 2026-10-28 | Frame budget (dial search) | The dominant cost was `lockDial` at 83.3 ms a call eight times a second (670 ms/s, 67% of the main thread) - 99,000 rim samples per call, each with its own trig call and a fresh 4-element array. Geometry unchanged: trig tables, a `Uint8Array` rim mask per read, index-only predicates, and `inkMix` without per-pixel arrays. `findCatch` throttled to 100 ms. Measured: 4.2-4.3 ms a call, idle frame rate 32.2 -> 140.6 fps. | `AUTOFISH.md` 2026-10-28 the dial search was the real lag |

---

## 7. Next Immediate Actions (Queued)
1. ~~Re-import and reload~~ (done 2026-10-28): the page now runs the shipped userscript with one
   panel, and the seat pause was measured live - `paused`/`seat` with `fishingMs` frozen at 898 993
   across 2.6 s, then `running` again on the same clock. The window/cap branches are still reducer
   tests only, because they need a schedule boundary to actually pass.
2. Watch a real overnight run: the 30-minute seat cap, the window stop and the cap stop have never
   fired in the field, and only a night will show whether a stall costs hours or nothing.
3. Settle the two lost fish in the 28/30 sample. Both scored `cast prompt`; one showed a
   shape-accepted card (304x420 / 320x436, ink 0.115-0.116) that never produced parsed text, so
   `parseCatch` can still drop a win silently when no dial is locked - fix that path or prove the
   loss genuine.
4. Watch for false positives from the for-anywhere prompt scan on other white UI (name tags, chat
   bubbles) at window sizes nobody has tested yet.

---

## 8. Session Continuity Log
Compact record of pairing sessions to enable instant chat resumption:
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Date | Engineer / Agent | Milestone / Focus | Key Changes & Artifacts |
| :--- | :--- | :--- | :--- |
| 2026-10-27 | lead (DSH session) | M1 catch-card freeze | Commits 228c517, 28e77b1, 14abfe6: card detection by solid rectangle (integral image, solid seed grown while solid, tap the seed centre), `cardAnywhere()` removed, stale-canvas and opaque-layer guards; 34 tests. Cause found from pixels: an event card's artwork spills outside the frame, so the connected blob measured 700x576 at 46% fill and `findCatch()` returned null. Live: the stuck card dismissed, then 22 s and 25 s runs with 28/28 dials closed, 0 errors, Eel/Herring/Bass logged. |
| 2026-10-27 | lead (DSH session) | M1 fix round after first user trial | Commits 1ab882d, 6682c20, ba2c9e6: adaptive prompt scan (fixed boxes first, then the whole UI layer), capture-phase drag listeners, `POST /diag` + `__fish.captureUI()`, `readUI` canvas-loss guard, reducer clock fallback; 33 tests. Live: drag releases, `REEL!` 108x44 at (618,270) found, 1 Salmon in 24 s. |
| 2026-10-28 | lead (DSH session) | Dial search was the lag | The user reported lag still there after importing. rAF attribution put 84% of the main thread in the userscript loop; instrumented function timers put 67% of it in `lockDial` (83.34 ms x 8/s), 16% in `findCatch`. Fix: precomputed trig tables, `rimMask`/`rimHits` over a `Uint8Array`, index-only `isRim`/`isGreen`/`isPin`, `inkMix` without arrays, `cardCheckMs` 100. Live: 4.2-4.29 ms per lock over 82 calls, idle fps 32.2 -> 140.6, 1/1 fish caught with 0 ghosts 0 errors. 4 new `tests/perf.test.js` guards; 94 tests pass. |
| 2026-10-28 | lead (DSH session) | Fishing is seat-based | The long "bot stops casting" stall was finally explained from the game bundle: the cast prompt is only emitted from the sit path, so standing up (a stray tap, a walk) kills fishing until the player sits again. Commit 58abc48 replaced the walk rung of the cast-recovery ladder with a `needsSeat` watchdog; 6d91243 put the same fact in the panel footer. 103 tests. |
| 2026-10-28 | lead (DSH session) | Seat pause + repo published | da2d328 pauses the session clock while unseated (core untouched, 30 min cap, `no-seat`), f13967f makes that pause honour the clock window and a spent daily cap. Added README, MIT licence, docs index and the docs/STATE refresh; repo pushed private to github.com/lowqualityloey/lofitown-autofishing (28 files, `shots/` excluded). 110 tests. |
| 2026-10-28 | lead (DSH session) | Frame rate | The user reported lag; measured 27.6 fps with the bot running vs 141.3 with it stopped. Cause: a 360x210 readback plus 75,600 per-pixel array allocations every frame, a whole-surface read at 5 Hz, and reads while a dial was locked. Fix: index-only loops, bubble scan 25 Hz / 11 Hz locked, prompt scan 3 Hz. After: 111-138 fps, 3/3 fish caught, 0 misses. `tests/perf.test.js` (4 guards); 90 tests pass. |
| 2026-10-27 | lead (DSH session) | M1 tasks 1-9 | Commits 3bbc92a..ec04344: `session.js`, `layout.js`, server session routes, core hooks, `panel.js`, `install.html`, `autofish.user.js`, 30 passing tests. Three live bugs found and fixed (null `ui` refs, `.wrap{position:fixed}`, `F.zones()` before first bubble). |

---

## 9. Session Spend Ledger
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Session | Turns | Measured in/out | Estimated context payload | Note |
| :--- | :--- | :--- | :--- | :--- |
| not tracked | not tracked | not tracked | not tracked | not tracked |

- **Running total**: not tracked — refreshed by `pk:checkpoint`; keep measured tokens and heuristic context-payload ranges as separate totals and never add them together. One row per real work session (trivial sessions under ~5 turns with no workflow usage write nothing). When host metering is unavailable, compute the lower and upper bounds independently via the heuristic (`turns × 8k` through `turns × 15k tok/turn`) rather than emitting a midpoint or `not measured`.
- **Note evidence**: use `duration=<value>; repairs=<count or not tracked>; interventions=<count or not tracked>; verification=<result or not tracked>; outcome=<accepted | rejected | incomplete | blocked | not tracked>`. Never infer `0`, `passed`, or `accepted` from missing evidence.
- **Evidence boundary**: this ledger is operational telemetry, not CPAC benchmark evidence. Heuristic context payload is not provider billing telemetry or actual spend; avoided rework remains `not measured` without comparative evidence. Preserve historical rows and the five-column shape without silent backfill.