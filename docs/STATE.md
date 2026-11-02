# Project State & Living Execution Tracker

## 1. Executive Summary & Current Position
- **Project Name**: lofitown-autofishing (autofish 3.9.9 + in-game control panel)
- **Current Milestone / Epic**: Milestone 2 — trustworthy accuracy and seat-aware sessions (fish-attempt
  oracle, catch ledger, frame budget, seat pauses); Milestone 1 (in-game panel) closed. Milestone 3
  (self-updating distribution) closed
- **Overall Status**: ACTIVE — private source at github.com/lowqualityloey/lofitown-autofishing, public
  distribution mirror at github.com/lowqualityloey/lofitown-autofishing-dist
- **Target Release / Deadline**: 3.9.9 release / not tracked
- **Current Working Branch**: `main` (this worktree); `audit/autofish-3.9` is merged into it
- **Last Updated**: 2026-11-02
- **Runtime**: Node v24.22.1, no dependencies, no bundler

---

## 2. Milestone & Task Progress

### Milestone Roadmap
- [/] **Milestone 1** — in-game AutoFish panel: session reducer, server session records, core
  pause/zones hooks, collision-free placement, HUD, guards G1-G7, wake lock + reload resume,
  bookmarklet install page. Code + 33 unit tests. Live verification: panel mounts, real-click
  Start/Stop, counters, cooldown, drag release and adaptive prompt detection all observed in the
  browser; 1 Salmon caught by the bot in 24 s at 1234x1023.

- [/] **Milestone 2** — trustworthy accuracy: the per-fish-attempt oracle replaced per-press scoring
  (latest long run 103 caught / 112 attempts, 92.0%, Wilson 95% CI 85.4-95.7%); the dial search went
  from 83 ms to ~1 ms a call; fishing was found to be seat-based, so a missing cast prompt is now
  named, the session clock pauses while unseated, and the pause honours the clock window and the
  daily cap, plus the 2026-11-02 field-audit fixes; 3.9.6 holds the first press on a narrow or fast
  dial until the spin-rate fit is stable; 3.9.7 moves detection to a post-render renderer hook; 3.9.8
  presses containment's already-open window (`inside-now`) instead of waiting a rotation; 3.9.9
  replaces the per-read `getImageData` garbage with one reusable WebGL buffer; 3.9.10 makes the
  quarter-scale snapshot allocation-free and bounds the first-press hold to a fraction of one pass;
  3.9.11 backs off the whole-surface recovery scan, which was a 250-300 ms stall every second while
  waiting for a bite; 3.9.12 fixes the snapshot framebuffer ordering, without which that path had
  never actually run. 233 tests.
- [x] **Milestone R** — private repository published (README, MIT licence, docs index); `shots/`
  (game bundle, screenshots) and the local PromptKit scaffolding stay out of git.
- [x] **Milestone 3** — self-updating distribution: a private repository's release assets answer an
  anonymous Tampermonkey update check with 404, so every release is mirrored to the public
  `lofitown-autofishing-dist` repository, and `scripts/release.js` refuses unless the build committed
  at the tag, the source asset and the anonymously served mirror asset are byte-identical. 3.8.9
  added the stable `@updateURL`; 3.8.10 moved it to the mirror.

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
- **Active RFC / Spec**: `docs/specs/2026-10-28-catch-log.md` (the panel design spec is [docs/specs/2026-10-27-in-game-panel-design.md](specs/2026-10-27-in-game-panel-design.md); its decisions are also the ADR log in §6)
- **Active Task Spec**: `docs/tasks/autofish-panel.md`
- **Key Source Files in Flight**: `autofish.js`, `panel.js`, `session.js`, `layout.js`, `build-userscript.js`, `scripts/release.js`, `dist/autofish.user.js`, `tests/*.test.js`
- **Verification Commands (Scoped)**:
  - Unit Tests: `node --test` (never `node --test tests/` — fails on Node v24.22.1)
  - Build: `node build-userscript.js`; a test fails when the committed `dist/` is stale
  - Release mirror: `node scripts/release.js --check` after every tag — verifies both release assets
    against the tagged build and fetches the public URL anonymously
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
  - **Viewport sensitivity: closed.** The fixed 1620x1031 CAST/REEL box is gone: `promptBox` derives
    it from the live canvas, the dial hint is persisted per canvas size (`autofish:dial:v1`), and a
    whole-surface pass recovers a stale hint. A 1117x785 field run took 14/14 prompts from the box;
    no hardcoded seed remains.
  - **Zen frame budget unmeasured.** Every timing figure in AUTOFISH.md from 3.8.2 on is Chromium. A
    Gecko readback is not a Chromium one; measure with `__fish.perf()` before changing a throttle.
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
| 2026-10-27 | Control surface | In-game floating DOM panel (shadow root) instead of a local dashboard page, because a separate window would cover the game and a hidden/covered game freezes. | `docs/tasks/autofish-panel.md` |
| 2026-10-27 | Session history | Records live in the server (`sessions.csv`, `GET /sessions?day=`), never in localStorage. | same spec |
| 2026-10-27 | Pause semantics | Pause is not a stop: no cooldown, and paused/waiting time never counts toward session length or the daily cap. | same spec |
| 2026-10-28 | Catch history | Per-catch ledger in `localStorage` (`autofish:log:v1`), written only from parsed catch text. Session records stay server-only; the ledger is history, never a scoreboard, and rarity may be filled from the embedded catalogue with `derived:true`. | `docs/specs/2026-10-28-catch-log.md` |
| 2026-10-27 | Placement | Panel position comes from the live exclusion rect (`__fish.zones()`) at runtime, not from fixed coordinates; no room means collapse to the pill. | same spec |
| 2026-10-28 | Frame budget | UI `getImageData` is a GPU readback (~2.1 ms per 360x210 box). The bubble scan is throttled to 25 Hz idle / 11 Hz with a dial locked, the whole-surface prompt scan to 3 Hz, and per-pixel loops read channels by index. The dial sample keeps the full loop rate because accuracy depends on it. Measured: the old build held the page at 27.6 fps, this one at 111-138 fps. | `AUTOFISH.md` 2026-10-28 frame rate |
| 2026-10-28 | Accuracy oracle | A press is never a win or a loss. The unit is the fish attempt: opened by the first press after the last catch, closed by parsed catch text (caught) or by the cast prompt returning (lost). Rarity/time-limit tables were read out of the game bundle; one fish is many presses on a level bar. | `AUTOFISH.md` one fish is many presses |
| 2026-10-28 | Seat-based fishing | `showCastButton` is emitted only from the character's sit path, so an unseated character can never be rescued by clicking. The bot never synthesises movement (an earlier walk rung unseated the character and lost the run) and names the condition as `needsSeat` after 45 s without a prompt. | `AUTOFISH.md` why the bot stops casting |
| 2026-10-28 | Seat pause | `fact.seat` pauses the session before any fishing time is credited, without pausing the core (the core is what spots the returning prompt). The pause honours the clock window and an already-spent daily cap, and ends with `no-seat` after 30 minutes. | this file, section 7 |
| 2026-10-28 | Frame budget (dial search) | The dominant cost was `lockDial` at 83.3 ms a call eight times a second (670 ms/s, 67% of the main thread) - 99,000 rim samples per call, each with its own trig call and a fresh 4-element array. Geometry unchanged: trig tables, a `Uint8Array` rim mask per read, index-only predicates, and `inkMix` without per-pixel arrays. `findCatch` throttled to 100 ms. Measured: 4.2-4.3 ms a call, idle frame rate 32.2 -> 140.6 fps. | `AUTOFISH.md` 2026-10-28 the dial search was the real lag |
| 2026-10-29 | Session budget | `autofish:budget:v1` in localStorage is the authority for today's minutes and the cooldown; the server's `/sessions` is merged by `max()` and is no longer required. A stop folds the session into `todayMs`, so a restart counts it. | `AUTOFISH.md` 2026-10-29 |
| 2026-10-29 | Catch history | The ledger key is per profile (`autofish:log:v1:<profile>`), migrating the pre-profile key to `default`. A species outside the catalogue is logged as `Unknown`, shown in a `UNK` cell and kept in an `unknown` worklist. | `AUTOFISH.md` 2026-10-29 |
| 2026-10-30 | Distribution | The source repository stays private, so its release assets answer an anonymous update check with 404. Every release is also published to the public `lofitown-autofishing-dist` repository under the same tag, and `scripts/release.js` refuses unless the build committed at the tag, the source asset and the anonymously fetched mirror asset are byte-identical. The publish target is read from the userscript's `@updateURL`, never kept as a second constant. | `README.md` Releasing; `scripts/release.js` |
| 2026-11-02 | Catalogue | The embedded catalogue is now regenerated from the current game bundles by reading both the literal-object table and the size-based helper rows. 232 species (51 Volcanic), so a Volcanic catch no longer falls through to `Unknown` just because the build predates the zone. | `scripts/gen-catalogue.js`; `tests/catchlog.test.js` |
| 2026-11-02 | Pause / cooldown | Pause is a user hold: it credits the elapsed time, starts no cooldown, sends no session row and never auto-resumes. Stop ends the session and rests. The clock window and daily cap end the session without a cooldown; the self-imposed cooldown has an explicit "Start now" escape. | `session.js`; `panel.js` |
| 2026-11-02 | Profiles and history | The daily budget/cooldown key follows the profile (`autofish:budget:v1:<profile>`; default keeps the legacy key), and profile switching is idle-only. The panel shows all-time and today, today's shiny/golden counts, the kept-day count, and a confirm-guarded reset for the current profile. | `panel.js`; `autofish.js` |
| 2026-11-02 | Accuracy telemetry | Each fish attempt records average dial width; reports are split by width band and by caught-fish rarity. `__fish.calibration()` reports the live knobs and bands; `__fish.tune()` applies numeric timing knobs. Losses cannot be assigned a rarity because no card parses, so rarity is a caught-fish report, not a fake catch rate. Each fish also carries accepted/rejected presses and dial hits/misses; `widthReport` adds `pressHitRate`, `dialHitRate` and `pressesPerAttempt`, and `accuracy().recent` lists the last ten fish with their own denominators. | `autofish.js`; `tests/timing.test.js` |
| 2026-11-02 | Network default | The localhost catch POST is opt-in (`POST catches` in the panel, or `__fish.start({ logUrl })`); no default URL and no failed request in a server-free install. Reload resume is opt-in and no longer requires a clock window; a user pause is not auto-resumed by a reload. | `panel.js`; `autofish.js` |
| 2026-11-02 | Card text | A long species name is drawn as two card strings (`Yellowstripe` + `Goatfish`). `parseCard` now joins the leading pre-weight draws and keeps the longest run the catalogue knows; a tier is never joined and an unknown name keeps the single-word read. The 232-row catalogue alone did not fix the field `Unknown` rows. | `AUTOFISH.md` 3.9.1; `tests/cardtext.test.js` |
| 2026-11-02 | First-press gate | The first press on a dial has the least evidence behind it. `fitStable` requires 6 fit points over 150 ms with RMS <= 2 deg (never a clamped rate) before the first press on a dial under 60 deg wide or 300 deg/s or faster; an unstable fit skips that crossing, and a 2500 ms release forces the press even if the fit never settles. Held/forced counts are in `accuracy().stats` and logged once per dial. Later presses are never held. | `AUTOFISH.md` 3.9.6; `tests/timing.test.js` |
| 2026-11-02 | UI surface | The game merged the prompt layer into the WebGL renderer canvas: canvas 0 held 965,753 painted pixels, canvas 1 was empty (0). The bot still read canvas 1 and `adoptSurface()` now switches to the candidate with pixels (3.9.4/3.9.5), but inside the bot's rAF the renderer also reads blank (222/222 swaps) while a post-render frame reads ink 256/256. Detection must move to a post-render hook. | `AUTOFISH.md` 3.9.4 and 3.9.5 |
| 2026-11-02 | Detection timing | Detection now runs after the game draws: `installPostRender()` wraps the renderer prototype's `render()` (verified, tagged, filtered to the app canvas) and `postRenderTick()` runs the step in the same task; rAF keeps only the frame clock, hook retry and stall watchdog. `status().postRender` reports the mode. Live 3.9.7: `postRender: true` at ~100 fps, 0 errors; the bot found the new character-attached REEL bubble (116x54 at 627,251), then **4 caught / 4 attempts, 0 lost, 21/21 presses accepted, 8/8 dials**, with the first-press gate active (`firstPressHeld: 7`, `forced: 3`). | `AUTOFISH.md` 3.9.7; `tests/renderhook.test.js` |
| 2026-11-02 | Snapshot readback order | 3.9.10's quarter-scale GL path attached the texture to the framebuffer before giving it storage: `checkFramebufferStatus` returned **36054 (INCOMPLETE_ATTACHMENT)**, the code disabled the path, and the 2D `getImageData` fallback ran for the life of the page - invisible because only `allocMB` counted it. Found in review of this branch, not by a symptom. Storage is now allocated with an explicit size before the attach, a lost context falls back, and `perf().snapshot` reports which path served the read. | `AUTOFISH.md` 3.9.12; `tests/perf.test.js` |
| 2026-11-02 | Recovery cadence | `dialAnywhere` is a ~257k-test annulus sweep (250-300 ms) throttled to 900 ms, and it fires whenever nothing has locked for 2.5 s - which is the whole wait-for-a-bite phase. Measured in the live tab: 6 long tasks of 250-285 ms in 6 s while waiting; **0** with the core paused, and **0** with `dialFallbackMs` disabled. It now backs off (900 ms, 1.8 s, 3.6 s, cap 6 s), resets on a cast, a normal lock or a recovery hit, and reuses its rim-mask buffer instead of allocating 705 KB per blob. | `AUTOFISH.md` 3.9.11; `tests/dial.test.js`; `tests/timing.test.js` |
| 2026-11-02 | Quarter-scale readback | The snapshot still called `getImageData` every scan tick: 242 KB a tick at 1179x821, which lands in V8 large-object space and measured **1,384 MB allocated over 678 s (2.04 MB/s)** with a 286.8 ms worst frame against a 12.2 ms p95. It now uploads the 2D copy into our own framebuffer and reads it back with `readPixels` into one reused buffer (probe: byte-identical on 6,762 sampled pixels, no row flip, 1.30 ms vs 1.65 ms), with a one-off pixel comparison and a 2D fallback. | `AUTOFISH.md` 3.9.10; `autofish.js` |
| 2026-11-02 | First-press budget | A live capture held the first press on **9 of 18 dials and forced 2**, because the hold ceiling was a fixed 2500 ms - about four passes on a 45 deg arc at 700 deg/s, i.e. exactly the high-tier dials the owner reported as slow. The budget is now `min(firstPressMaxWaitMs, 0.4 x width/omega x 1000)`, so a hard dial presses on its first pass with the best fit available. `planPress` itself was exonerated by simulation at 10-140 fps (inside the window 100% of the time). | `AUTOFISH.md` 3.9.10; `tests/timing.test.js` |
| 2026-11-02 | Readback allocation | 121 `getImageData` calls in 5 s allocated 40.4 MB and major collections froze the page for ~250 ms about once a second while running. `readUI` now reads the renderer's WebGL buffer with `readPixels` into one reused `Uint8Array` (0.67 MB at 1179x821), flips the rows in place, and keeps the 2D path as the fallback; the shared quarter-scale snapshot still allocates ~2.4 MB/s. Live: **138.5 fps / 0 long tasks** running vs **105.2 fps / 5 long tasks, max 264.5 ms** on 3.9.8; 1/1 caught, 5/5 presses accepted. | `AUTOFISH.md` 3.9.9; `tests/perf.test.js` |

---

## 7. Next Immediate Actions (Queued)
1. Watch a real overnight run: the 30-minute seat cap, the clock-window stop and the daily-cap stop
   have never fired in the field, and only a night shows whether a stall costs hours or nothing.
2. Extend the 112-attempt run to 200 catches if a long seated session is available; 103/112 is a real
   sample and the README now quotes it, so a larger one is worth having.
3. Watch for false positives from the for-anywhere prompt scan on other white UI (name tags, chat
   bubbles) at window sizes nobody has tested yet.
4. Measure the Zen frame budget with `__fish.perf()` (bot stopped, then running) before changing any
   scan throttle; a Gecko readback is not a Chromium one.
5. Run `node scripts/release.js --check` after every tag: it is the only check that proves the public
   asset matches the tagged build.

Items 1-4 are field experiments: they need a live game tab and a human at the keyboard, and no
automated run can produce them. Item 5 is a release ritual, not a one-off.

---

## 8. Session Continuity Log
Compact record of pairing sessions to enable instant chat resumption:
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Date | Engineer / Agent | Milestone / Focus | Key Changes & Artifacts |
| :--- | :--- | :--- | :--- |
| 2026-10-27 | lead (DSH session) | M1 catch-card freeze | Commits 228c517, 28e77b1, 14abfe6: card detection by solid rectangle (integral image, solid seed grown while solid, tap the seed centre), `cardAnywhere()` removed, stale-canvas and opaque-layer guards; 34 tests. Cause found from pixels: an event card's artwork spills outside the frame, so the connected blob measured 700x576 at 46% fill and `findCatch()` returned null. Live: the stuck card dismissed, then 22 s and 25 s runs with 28/28 dials closed, 0 errors, Eel/Herring/Bass logged. |
| 2026-10-27 | lead (DSH session) | M1 fix round after first user trial | Commits 1ab882d, 6682c20, ba2c9e6: adaptive prompt scan (fixed boxes first, then the whole UI layer), capture-phase drag listeners, `POST /diag` + `__fish.captureUI()`, `readUI` canvas-loss guard, reducer clock fallback; 33 tests. Live: drag releases, `REEL!` 108x44 at (618,270) found, 1 Salmon in 24 s. |
| 2026-10-27 | lead (DSH session) | M1 tasks 1-9 | Commits 3bbc92a..ec04344: `session.js`, `layout.js`, server session routes, core hooks, `panel.js`, `install.html`, `autofish.user.js`, 30 passing tests. Three live bugs found and fixed (null `ui` refs, `.wrap{position:fixed}`, `F.zones()` before first bubble). |
| 2026-10-28 | lead (DSH session) | Dial search was the lag | The user reported lag still there after importing. rAF attribution put 84% of the main thread in the userscript loop; instrumented function timers put 67% of it in `lockDial` (83.34 ms x 8/s), 16% in `findCatch`. Fix: precomputed trig tables, `rimMask`/`rimHits` over a `Uint8Array`, index-only `isRim`/`isGreen`/`isPin`, `inkMix` without arrays, `cardCheckMs` 100. Live: 4.2-4.29 ms per lock over 82 calls, idle fps 32.2 -> 140.6, 1/1 fish caught with 0 ghosts 0 errors. 4 new `tests/perf.test.js` guards; 94 tests pass. |
| 2026-10-28 | lead (DSH session) | Fishing is seat-based | The long "bot stops casting" stall was finally explained from the game bundle: the cast prompt is only emitted from the sit path, so standing up (a stray tap, a walk) kills fishing until the player sits again. Commit 58abc48 replaced the walk rung of the cast-recovery ladder with a `needsSeat` watchdog; 6d91243 put the same fact in the panel footer. 103 tests. |
| 2026-10-28 | lead (DSH session) | Seat pause + repo published | da2d328 pauses the session clock while unseated (core untouched, 30 min cap, `no-seat`), f13967f makes that pause honour the clock window and a spent daily cap. Added README, MIT licence, docs index and the docs/STATE refresh; repo pushed private to github.com/lowqualityloey/lofitown-autofishing (28 files, `shots/` excluded). 110 tests. |
| 2026-10-28 | lead (DSH session) | Frame rate | The user reported lag; measured 27.6 fps with the bot running vs 141.3 with it stopped. Cause: a 360x210 readback plus 75,600 per-pixel array allocations every frame, a whole-surface read at 5 Hz, and reads while a dial was locked. Fix: index-only loops, bubble scan 25 Hz / 11 Hz locked, prompt scan 3 Hz. After: 111-138 fps, 3/3 fish caught, 0 misses. `tests/perf.test.js` (4 guards); 90 tests pass. |
| 2026-10-29 | lead (DSH session) | Cast ladder + dial hint | The live tab was still running a stale `3.6.1` build with perf wrappers whose `castRecovery(3)` returned `tap:false`, so earlier live readings described the old ladder. Fixed core injected and watched at 1117x785: 7 catches / 7 attempts, 0 lost, 16 dials / 16 hits / 35 presses (5.0 presses a catch), 14/14 bubble rows `tap:true`; `catches.csv` agrees (Epic Betta, Uncommon Tripod Fish). Session ended at `needs a seat`, not a dial defect. 127 tests. |
| 2026-10-29 | lead (DSH session) | 3.6.1 reinstalled in both; the panel carries the report | Both browsers updated to 3.6.1 and confirmed in-page (`__fish.version` and the panel head read `3.6.1`). Because Zen takes no synthetic keystrokes, 3.6.1 also renders `perf()` on the panel: fps / p50 / p95 / worst, each detector's ms per second, and the full JSON on click. Zen live, running, in front: 55.6 fps, p50 15, p95 46, worst 78 ms; `snapshot` 105.4, `findBubble` 54.5, `lockDial` 259.9, `findCatch` 76.4 ms/s. The expanded report read `lockDial` at 6.3 calls/s x 43.74 ms = 274.7 ms/s = 27.5% (`snapshot` 4.21 x 25.1 = 10.6%, `findBubble` 0.77 x 59.5 = 4.6%). The rate did not rise and the per-call cost did not fall (37.58 -> 43.74 ms), so the 24.6% -> 7% projection is withdrawn; the search is ~1.1 ms of a 43.74 ms call, so ~34 ms is unaccounted for and the next step is to split lockDial's timer inside the live loop (grab / rimMask / coarse scan / refine / sample), not to add a rate cap. Neo could not be read - its tab was behind a full-screen video and a covered tab is throttled to ~1 fps (14.8 fps, p95 1002 ms), which measures occlusion, not the bot. 141 tests. |
| 2026-10-29 | lead (DSH session) | Zen: lockDial's per-circle helper | The Zen tab (Gecko, 3.6.0) reported `lockDial` at 37.58 ms x 6.5/s = 24.6% of the main thread. In-page probes: the 240x240 readback is flat at 7-9 ms at any size, `rimMask` is 0.38 ms, and the 99,000-sample scan is 0.75 ms inlined but ~22 ms through 4,950 per-circle `rimHits` calls - the earlier 4.2 ms Chromium figure hid the split. Fix in 3.6.1: inline the coarse scan over the mask (same centres, radii, `hit >= 17` and first-max tie-break), keep `rimHits` for the 17-call refinement. Live, same frame: 31-33 ms -> 8-11 ms. A time-based gate was rejected: 791 shadow scans in 120 s found 4 dials, one more than 20 s after the last press. 140 tests. |
| 2026-10-29 | lead (DSH session) | Senior review round | Fixed the six review findings: persisted dial geometry + whole-surface recovery (no hardcoded seed), text cursor advance on an unparsed card, press acceptance by the new-triangle spawn (`sweepReport`/`accuracy` rewired), dead cast-retry ladder call removed, `floodComponents` de-allocation, local day store for the daily cap, CSS coordinate conversion at the tap/zones boundary. 156 tests; `dist/` rebuilt. |
| 2026-10-29 | lead (DSH session) | Live-surface prompt box | The CAST/REEL box is derived from the live canvas (`promptBox`) instead of the 1620x1031 literal. Field run at 1117x785: 14/14 bubbles from the box, 0 from `bubble anywhere` (was 11/11 fallback), 8 caught / 8 attempts, 0 lost, 34/34 presses accepted. `build-userscript.js` now stamps `F.version` from `package.json`, so an updated install no longer reports `autofish 3.0`. 163 tests. |
| 2026-10-29 | lead (DSH session) | Merge of the parallel feature branch | Installing 3.7.1 replaced a 3.6.1 build from the `repo-ingest` branch and lost the budget store, per-profile ledger, 181-species catalogue, hidden-stop/chain controls and the perf probe the user noticed. Merged `d544589` into this branch, resolved the panel budget duplication in favour of the budget store (removing `autofish:today:v1`), and released 3.8.0. Re-measured live at 1117x785: 10/10 bubbles from the box, 0 fallback, 21/21 presses accepted, 4/4 caught, 0 lost, first lock 7.6 s. 177 tests. |
| 2026-10-29 | lead (DSH session) | 3.8.7: memo readback gated | With the scan fixed, `lockDial`'s phases inverted: memo 2.84 ms (43.8%) against grab 2.21 and scan 1.04, and the memo answered 38 of 4,611 calls (0.8%). It is now tried at most once per 500 ms (`MEMO_EVERY_MS`), with skips counted in `lockPhases.memo.skipped`. Controlled A/B, same page state, synthetic remembered circle, 40 calls each: 5.94 ms ungated vs **3.71 / 3.82 ms** gated. Not validated while fishing - after the install reload the character was standing (`needsSeat: true`, 45 cast retries, none consumed), so no dial appeared; the recovery case is bounded (a memo hit returns what the search finds anyway) but wants one seated session. 179 tests. |
| 2026-10-29 | lead (DSH session) | 3.8.6 long run: detection unchanged | Six minutes of continuous fishing on 3.8.6, sampled every 60 s: 12 caught of 13 attempts (92%), 67 presses (5.6 a catch), `pressAcceptRate` 1.0 throughout, 1 lost. fps 132-139, p95 9-11 ms, `lockDial` 6.15-6.25 ms = 4.1% of wall clock, scan 0.98-1.00 ms across 3,388 calls, memo hits 28 (0.8%, matching the 0.6% before the change), so the faster scan finds the same dials at the same rate. No threshold, gate or rate changed. 179 tests. |
| 2026-10-29 | lead (DSH session) | lockDial fixed: 24% -> 4.2% of the main thread | 3.8.6 compiles the coarse scan with `new Function` at startup (same source, fresh scope, tables passed in), falling back to the literal function if a CSP refuses eval; `perf().scanCompiled` says which is live. Live Chromium, 1117x785, 90 s two-part run: scan 30.26 -> **0.95 ms** a call, `lockDial` 35.09 -> **5.91 ms** (23.1% -> 4.2% of wall clock), fps 104.5 -> **134.9**, frame p95 35.5 -> 9.6-10.8 ms. Fishing unaffected: 1 caught, 8 presses, acceptance 1.0, 0 lost. No gate, threshold or scan rate changed. 179 tests. |
| 2026-10-29 | lead (DSH session) | lockDial extraction: negative result | 3.8.3-3.8.5 lift the coarse scan out of `lockDial` into `coarseScan`. Live 3.8.3, 1117x785, 180 s: scan 30.26 ms a call, `lockDial` 35.09 at 6.6/s = 23.1% - the same as 3.8.2, so the extraction changed nothing. It did rule things out: the same source eval'd fresh is 2.26 ms, the shipped instance with a synthetic 240x240 mask is 29 ms and never warms up over 120 calls, function size (1,200 statements) 2.2-4.0 ms, closure scope (2,000 locals) 2.3 ms, a large injected script 1.7 ms. The difference travels with the function instance inside the installed userscript, not with its input; the remaining hypothesis (compilation context keeps it unoptimised) is unproven. Next experiment: compile the scan with `new Function` at startup and re-read the phases. 3.8.5 installed and fishing (1 caught, acceptance 1.0, 0 lost). 179 tests. |
| 2026-10-29 | lead (DSH session) | lockDial's missing 34 ms is the coarse scan | 3.8.2 splits `lockDial`'s own timer into memo / grab / mask / scan / refine and reports it from `perf().lockPhases`. Live Chromium, 1117x785, 180 s: 35.02 ms a call at 6.9/s = 24.1% of wall clock, of which the coarse scan is 30.28 ms (86.5%); grab 1.97, memo 2.49 (8 hits in 1,242), mask 0.17, refine 0.10. 4 caught of 8 attempts, acceptance 1.0, 0 lost, 104.5 fps, p50 7 ms. The scan does not do more work: the same loop standalone is 1.4 ms, padded with 1,200 statements 2.2-4.0 ms (so not function size), while the live call is 32-36 ms and 100 ms at span 40. A 20 s CPU profile attributes only 13 ms a call to `lockDial` self (8.9%), so the loop is running unoptimised in place rather than being attributable JavaScript. Next step is to lift the scan into its own function and re-measure; a rate cap stays rejected. 179 tests. |
| 2026-10-29 | lead (DSH session) | Branch convergence: 3.8.1 | The `repo-ingest` worktree held uncommitted 3.6.1 work (an inlined dial rim scan for Gecko and an on-screen perf box). Committed it, merged it here, and kept the measured 15/20 rim gate - the incoming patch used 17/20, the threshold that made dial locks fail on the live dial. Release 3.8.1, 178 tests; both branches now point at one commit. |
| 2026-10-30 | lead (DSH session) | 3.8.6 re-confirmed after the 3.8.7 rollback | 3.8.7 (the memo gate) was reverted unproven after its install reload left the character standing; repo and browser are back on 3.8.6, dist rebuilt, 179 tests. A seated live run then checked the released build: 7 minutes, sampled every 60 s at 1117x785, 8 caught of 9 attempts (89%), 49 presses (6.1 a catch), `pressAcceptRate` 1.0 with 89 accepted / 0 rejected, 1 lost; fps 123-139, p95 8.6-10.6 ms, scan 0.88-0.90 ms, `lockDial` 5.66-5.85 ms, memo 33 hits in 4,899 calls (0.7%). Matches the 3.8.6 signature run (12/13, 5.6 a catch, acceptance 1.0), so nothing regressed by rolling back. The seat watchdog tripped twice mid-run without stopping the session. |
| 2026-10-30 | lead (DSH session) | 3.8.7 landed on evidence: the gate, measured seated | Re-landed the memo gate as a revert of the revert and measured it in a session that was landing fish: 14 caught of 15 attempts (93%), 5.6 presses a catch, `pressAcceptRate` 1.0 with 184 accepted / 0 rejected, 1 lost - the same signature as 3.8.6, so the gate stays. Phase delta over a 192 s window (counters differenced, 5.95 `lockDial` calls/s): memo 2.7 -> **1.06 ms** a call with 76.3% of calls skipped (873 of 1,144), grab 4.13, scan 1.54, mask 0.46, refine 0.32, `lockDial` 7.51 measured against 10.93 estimated ungated - 3.42 ms saved a call, ~20 ms/s of main thread. The absolute 7.51 is not comparable to 3.8.6's 5.7 because the unfocused window ran the page at 40 fps and doubled `grab` (1.83 -> 4.13), a phase the gate cannot touch; `Emulation.setFocusEmulationEnabled` restored 111 fps for the measured window. 179 tests. |
| 2026-10-30 | lead (DSH session) | 3.8.8: the memo also needs a live dial | 3.8.7 still spent one readback every 500 ms between catches to prove a remembered circle is not a dial, so 3.8.8 also requires a lock inside `MEMO_RECENT_MS` (2000) and counts that skip as `memo.cold`. One 399.6 s delta window at 136.8 fps / p95 9.5 ms: memo **8 attempts in 2,668 calls** (99.7% skipped, 2,644 cold, 3 hits) for **22.2 ms total = 0.008 ms a call**, down from 1.06 in 3.8.7 and 2.7 in 3.8.6; grab 3.15, scan 1.21, mask 0.31, refine 0.16, `lockDial` 4.84 ms. Fishing improved rather than decayed: **11 caught of 11 attempts (100%), 56 presses (5.1 a catch), 78 accepted / 0 rejected, 0 lost**. The memo is effectively retired during normal play and only helps just after a dial is found, which is the only time it could. 180 tests. |
| 2026-10-30 | lead (DSH session) | 3.8.8 long safety run: 103 catches, memo never cost a dial | Ran 3.8.8 through one continuous seated session with the attempt recorder installed (75.2 active min, 139.8 fps median, p95 8.05): 103 caught / 112 attempts (92%), 5.84 presses a catch, 218 dials closed with 217 hit, 0 rejected presses of 602, all 9 losses `cast prompt`; memo 33 hits in 30,190 calls (99.6% skipped, 29,834 cold) at 0.008 ms a call, 252 ms total. The run was cut at 103 catches by a seat loss (~845 unconsumed `cast retry`) and then the 240 min cap, so 200 catches is still open; bot left paused, no code change. Recorded in AUTOFISH.md. |
| 2026-10-30 | lead (DSH session) | 3.8.9: a stable update URL | Added `@downloadURL`/`@updateURL` to the built header pointing at the GitHub `releases/latest/download/autofish.user.js` path, so an installed copy can find its own updates instead of a dead loopback server. Installed to both browsers through Tampermonkey's Update path (settings preserved); Neo's diff showed the directive change. 181 tests. |
| 2026-10-30 | lead (DSH session) | 3.8.10: public mirror + verified release script | The private repo's release asset answers an anonymous update check with 404, so the built userscript now updates from the public `lofitown-autofishing-dist` repository, which carries only the generated file. Added `scripts/release.js`: it publishes the build committed at the tag, requires the source asset to match it byte-for-byte, uploads those bytes, then fetches the mirror asset anonymously and compares hashes. `--check` verified both releases at 210,402 bytes / sha256 1fbf6b69b533 and the public latest URL; 182 tests. |
| 2026-10-30 | lead (DSH session) | Docs refresh | README now installs from the public release URL and quotes the 3.8.8 long run (103/112, 92.0%); STATE brought to 3.8.10 with the mirror ADR and the continuity rows moved back into §8; screenshots recaptured from the 3.8.10 panel. |
| 2026-11-02 | lead (DSH session) | 3.9.0 audit fixes | Field-report audit: regenerated the catalogue from the live bundles (232 species incl. all 51 Volcanic), fixed Unicode/punctuation card names, added a real Pause/Resume with separate Stop and a cooldown-skip escape, typed time fields, per-profile budgets and day/all-time history with reset, width/rarity accuracy reports and `__fish.calibration()`/`__fish.tune()`, opt-in reload resume and catch POST. `dist/` rebuilt; full suite 201 passing after the rebuild. |
| 2026-11-02 | lead (DSH session) | 3.9.1: wrapped card names (field run) | A seated 30.3 min field run on 3.9.0 in Neo produced 49 attempts / 47 caught, 5/5 narrow dials (45.0-58.3 deg) and 2 losses both `cast prompt` - no dial loss. It also exposed the real `Unknown` cause: 11 of 47 catches were wrapped names (`Yellowstripe` + `Goatfish`), because `parseCard` took only the first draw. `parseCard` now joins the leading pre-weight draws against the catalogue; every multi-word name is tested at its wrap boundary. `dist/` rebuilt as 3.9.1 and installed over 3.9.0 with the ledger intact; 205 tests. |
| 2026-11-02 | lead (DSH session) | 3.9.2: per-attempt wedge telemetry | Each fish carries accepted/rejected presses and dial hits/misses, width bands report pressHitRate, dialHitRate and pressesPerAttempt, and accuracy().recent lists the last ten fish; the panel acc line shows hit accepted/sent. 207 tests. |
| 2026-11-02 | lead (DSH session) | 3.9.3: seat hold stops casting; Resume overrides the seat | A seat pause keeps the core alive to spot the prompt, but its cast retry could put a line in the water, remove that prompt and deadlock the pause (live: 69 retries, line out, no prompt, 0 attempts). A seat pause now emits `holdCasts` and the retry is gated on `F.castHold`; Resume emits `holdCasts:false` and buys a 15 s `seatOverrideUntil` window so the same `needsSeat` fact cannot re-pause on the next tick. `dist/` rebuilt at 3.9.3; 209 tests. |
| 2026-11-02 | lead (DSH session) | 3.9.8: containment presses the window that is already open | `planPress` always scheduled the midpoint crossing, so a pin that had passed the midpoint while still inside the arc waited almost a full rotation - the reported "slower to react" feel. Contain (not `angle`) now returns `inside-now` and presses immediately when the pin is past centre, inside now and at judgement, and the next crossing is >60 ms away. Live in Neo, 1179x822, one seated sample: **7 caught / 7 attempts, 0 lost, 14/14 dials, 37 accepted / 0 rejected**, `firstPressHeld` 7, `firstPressForced` 1, fitted omega up to 1342 deg/s; `inside-now` appeared in `geoReasons` and `planReason`. 222 tests. |
| 2026-11-02 | lead (DSH session) | 3.9.10: the freeze was an allocation, the held press was a ceiling | A live capture in Neo (1179x821, 678 s, 3.9.9) read 106.8 fps and a 12.2 ms p95 but a **286.8 ms worst frame** and **1,384 MB allocated (2.04 MB/s)**, with 27,906 GL reads and 0 2D - so the readback path was fine and the remaining garbage was the quarter-scale `getImageData`. The same capture showed **firstPressHeld on 9 of 18 dials, forced twice**. `planPress` extracted and simulated at 10-140 fps pressed inside the window 100% of the time, exonerating the planner. 3.9.10 reads the snapshot through a WebGL round trip into a reused buffer and bounds the first press to `min(2500 ms, 0.4 x width/omega)`. 231 tests. |
| 2026-11-02 | lead (DSH session) | 3.9.11: the once-a-second stall was the recovery scan | The owner confirmed 3.9.10 fixed dial play but reported the page pausing every second while waiting to reel. Live capture: 6 long tasks of 250-285 ms in 6 s, **0** with the core paused (143.8 fps, worst 12 ms) and **0** with `dialFallbackMs` set to 0 - so the cost was `dialAnywhere`, a 900 ms-throttled ~257k-test annulus sweep that a dial-less wait triggers forever. It now backs off to 6 s and resets on a cast, a normal lock or a hit, and the 705 KB rim-mask allocation per pass is gone. 232 tests. |
| 2026-11-02 | lead (DSH session) | 3.9.12: the snapshot fix had never run | The review of this branch found `perf().readback.allocMBPerSec` still at 2.6 on the installed 3.9.11 with `canvas2d: 0`, and freezing `scanTickMs` dropped allocation to zero - so `downscaleGl` had never served a single read. Cause: the texture was attached to the framebuffer before it had storage, `checkFramebufferStatus` returned 36054 (INCOMPLETE_ATTACHMENT), and the code fell back for the life of the page; the probe that validated the approach printed the same 36054 and it was read as success. 3.9.12 allocates storage first, retries on resize, guards a lost context, counts the path in `perf().snapshot`, and resets the recovery backoff per session. 233 tests. |

---

## 9. Session Spend Ledger
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Session | Turns | Measured in/out | Estimated context payload | Note |
| :--- | :--- | :--- | :--- | :--- |
| not tracked | not tracked | not tracked | not tracked | not tracked |

- **Running total**: not tracked — refreshed by `pk:checkpoint`; keep measured tokens and heuristic context-payload ranges as separate totals and never add them together. One row per real work session (trivial sessions under ~5 turns with no workflow usage write nothing). When host metering is unavailable, compute the lower and upper bounds independently via the heuristic (`turns × 8k` through `turns × 15k tok/turn`) rather than emitting a midpoint or `not measured`.
- **Note evidence**: use `duration=<value>; repairs=<count or not tracked>; interventions=<count or not tracked>; verification=<result or not tracked>; outcome=<accepted | rejected | incomplete | blocked | not tracked>`. Never infer `0`, `passed`, or `accepted` from missing evidence.
- **Evidence boundary**: this ledger is operational telemetry, not CPAC benchmark evidence. Heuristic context payload is not provider billing telemetry or actual spend; avoided rework remains `not measured` without comparative evidence. Preserve historical rows and the five-column shape without silent backfill.
