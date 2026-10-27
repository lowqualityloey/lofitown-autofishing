# Project State & Living Execution Tracker

## 1. Executive Summary & Current Position
- **Project Name**: lofitown-autofishing (autofish 3.0 + in-game control panel)
- **Current Milestone / Epic**: Milestone 1 — in-game AutoFish panel (plan tasks 1-10)
- **Overall Status**: ACTIVE
- **Target Release / Deadline**: v1.0.0 usable panel / not tracked
- **Current Working Branch**: main
- **Last Updated**: 2026-10-27
- **Engine Version**: v2.0.1 @ unknown

---

## 2. Milestone & Task Progress

### Milestone Roadmap
- [/] **Milestone 1** — in-game AutoFish panel: session reducer, server session records, core
  pause/zones hooks, collision-free placement, HUD, guards G1-G7, wake lock + reload resume,
  bookmarklet install page. Code + 30 unit tests land; live browser verification still partial.

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
- [ ] T10 docs — AUTOFISH.md run section done; spec §14 checklist report pending

---

## 3. Active Working Set
- **Target Workspace / Package (if Monorepo)**: standalone repo, no bundler, plain CommonJS + browser globals
- **Active RFC / Spec**: `docs/specs/2026-10-27-in-game-panel-design.md` (approved)
- **Active Task Spec**: `docs/superpowers/plans/2026-10-27-autofish-panel.md` (approved route)
- **Key Source Files in Flight**: `panel.js`, `session.js`, `layout.js`, `autofish.js`, `fishserve.js`, `install.html`, `autofish.user.js`, `tests/*.test.js`
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
| 2026-10-27 | Placement | Panel position comes from the live exclusion rect (`__fish.zones()`) at runtime, not from fixed coordinates; no room means collapse to the pill. | same spec |

---

## 7. Next Immediate Actions (Queued)
1. Run the spec §14 checklist against the live game at the user's real window size and record
   which items were observed versus only unit-tested.
2. Have the user run the panel for one real session (install page → bookmarklet) and confirm the
   Start/Stop, counters and cooldown feel right in their own browser.

---

## 8. Session Continuity Log
Compact record of pairing sessions to enable instant chat resumption:
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Date | Engineer / Agent | Milestone / Focus | Key Changes & Artifacts |
| :--- | :--- | :--- | :--- |
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
