# Project State & Living Execution Tracker

<!-- Bounded projection: respect `state-guard:` thresholds in `PROMPTKIT.md`; `pk:checkpoint` archives completed history to `docs/STATE-ARCHIVE.md`. -->
## 1. Executive Summary & Current Position
- **Project Name**: lofitown-autofishing (autofish 3.9.70: Dual-surface non-white trophy screen capture + clean card-only floating Lightbox)
- **Current Milestone / Epic**: Milestone 2 — trustworthy accuracy and seat-aware sessions; Milestone 1 (in-game panel) & Milestone 3 (self-updating distribution) closed.
- **Overall Status**: ACTIVE — **v3.9.70** release verified (`tsc --noEmit` exit `0`, `470/470` unit tests pass, Chromium card-only Lightbox screenshot verified), cutting & publishing `v3.9.70`.
- **Current Working Branch**: `main` (pre-existing CRLF/mode diffs remain untouched on `run.sh`, `docs/releases/3.9.{51,56}.md`, and `docs/reviews/2026-11-23-catch-and-focus-live.md`).
- **Last Updated**: 2026-11-28
- **Engine Version**: v2.6.1 @ unknown
- **Runtime**: Node v26.13.1 (WSL), zero dependencies, no bundler

---

## 2. Milestone & Task Progress
- [/] **Milestone 1** — in-game AutoFish panel (session reducer, server records, layout, HUD, guards G1-G7, wake lock + reload resume, install page). Live-verified.
- [/] **Milestone 2** — trustworthy accuracy & seat-aware sessions (fish-attempt oracle, catch ledger, WebGL readback, post-render hook, `__fish.doctor()`, `__fish.exportRun()`, guard/blind diagnostics). Detailed 3.9.6–3.9.31 notes & closed tasks `T1`–`T10`, `Milestone R`, `Milestone 3` archived in `docs/STATE-ARCHIVE.md`.

---

## 3. Active Working Set
- **Target Workspace / Package (if Monorepo)**: standalone repo, no bundler, plain CommonJS + browser globals
- **Active RFC / Spec**: None - implementation task in flight at L2 Lite depth under `preset: solo-fast` (M0 claim evidence + the D1 record are the folded evidence base); `PLAN-trophy-alerts-dashboard` spec remains implemented & verified.
- **Active Task Spec**: `docs/tasks/TASK-2026-11-28-missions-claim-d2.md` (Level 2)
- **Key Source Files in Flight**: `src/loop.js`, `autofish.js`, `session.js`, `panel.js`, `fishserve.js`, `dashboard.html`, `scripts/overnight-report.js`, `types.d.ts`, `dist/autofish.user.js`, `tests/*.test.js`, `README.md`, `AUTOFISH.md`, `docs/*`.
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
- **Task ID**: `TASK-2026-11-28-missions-claim-d2`
- **Task Record**: `docs/tasks/TASK-2026-11-28-missions-claim-d2.md`
- **Ceremony Level**: `2`
- **Specification**: `None - L2 Lite planning under preset solo-fast; M0 claim evidence (TASK-2026-11-28-missions-awareness-d1) and the D1 implementation are the folded evidence base`
- **Execution Scope**: `src/missions.js`, `autofish.js`, `panel.js`, `fishserve.js`, `dashboard.html`, `types.d.ts`, `tests/missions.test.js`, `dist/autofish.user.js` (rebuild), `docs/STATE.md`, `docs/README.md` (one index row for this record), `docs/tasks/TASK-2026-11-28-missions-claim-d2.md` (this record)
- **Execution State**: `completed`
- **Mapped `pk:tasks` Status**: `Done`
- **Active Task Pointer**: `TASK-2026-11-28-missions-claim-d2`
- **Owner / Current Actor**: ZCode session (GLM-5.3-Flash)
- **Start Time**: `2026-11-28 09:01 (UTC+13)`
- **Current Revision**: `main` (`v3.9.70`)
- **Next Action**: Owner sign-off received ('sign-off D2 commit') at 2026-11-28 09:21 (UTC+13); local atomic commit authorized (pre-existing dirt, `.pkab/`, and the scratch #607 log excluded). A live claim smoke against the real Quests panel remains an owner-assisted follow-up - the game has shown zero live claim controls so far (auto-grant), so first live behavior is expected to be honest "nothing to claim" reports.

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
1. **Monitor `v3.9.65` overnight soak.** Confirm `overnight-report.js` coverage cleanly after an unattended Flow night. (Status 2026-11-28: the soak was observed live during the D2 smoke — 94 catches today, 20 capture posts saved — then cleared/paused with owner approval; fishing left IDLE. Re-run when convenient.)
2. **Field-run across local midnight.** Verify that only the post-midnight share spends the new day's cap (`Timed` mode) and that `Flow` mode runs smoothly across rollover.
3. **Measure the Zen frame budget.** Use `__fish.perf()` on Gecko before changing any scan throttle.
4. **Watch the for-anywhere prompt scan** for false positives on other white UI (name tags, chat bubbles) at untested window sizes.
5. **Run the `v3.9.70` live in-game smoke test** and monitor local `fishserve` `/dashboard` metrics (carried from the closed trophy task's Next Action).
6. **Missions-bot follow-up (`TASK-2026-11-28-daily-missions-scoping`, signed off 2026-11-28 - D1 then D2).** M0 spike done (A1-A4 resolved; daily reset ≈08:00 UTC read from the DOM countdown, decoupled from local midnight); D1 implemented and signed off as `TASK-2026-11-28-missions-awareness-d1`; D2 auto-claim awareness/handling implemented under a fresh owner go as `TASK-2026-11-28-missions-claim-d2` (L2 Lite, `preset: solo-fast`): pure exact-match claim planner, opt-in (default off) guarded claim pass with HARD-1 stand-downs (focus session, Cozier upsell), additive panel/dashboard/capture claim state - signed off and committed locally 2026-11-28 (owner reply 'sign-off D2 commit'). A read-only live smoke passed 2026-11-28 (L1, §8); a live claim-action observation remains open (the game showed 0 claim controls — auto-grant). The Cozier focus-fishing paywall stays a hard constraint (detect + report, never bypass); the owner's Cozy/Cozier status and post-spike panel-restart fact remain unknown (recorded as unanswered in the D1 record).

---

## 8. Session Continuity Log
Compact record of pairing sessions (older rows archived in `docs/STATE-ARCHIVE.md`):
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Date | Engineer / Agent | Milestone / Focus | Key Changes & Artifacts |
| :--- | :--- | :--- | :--- |
| 2026-11-28 | Antigravity (pk:plan) | Rare alerts, 24h Trophy Viewer, Local Dashboard & 12h soak fixes | Fixed false `lost (cast prompt)` on unconfirmed sightings during `awaitingCard`, added `row.golden` propagation, Web Audio `Rare catch chime`, 24h `IndexedDB` cropped catch-card viewer (`LEG`/`SEC`/`shiny·golden`), 6h-cached clickable update pill, 1-click `↓ CSV` export, `fishserve.js` `GET /report` + `GET /dashboard` (`dashboard.html`), expanded `catches.csv` (`+profile,+shiny,+golden`), `data/runs/` pruning (`14d`/`1000`), and bounded `result-missing` auto-reload (`<=2/h`). `tsc --noEmit` 0 errors; `node --test` `446/446` pass; `check-doctor.sh` exit `0`. | `src/loop.js`; `autofish.js`; `session.js`; `panel.js`; `fishserve.js`; `dashboard.html`; `scripts/overnight-report.js`; `types.d.ts`; `dist/autofish.user.js`; `tests/*.test.js`; `docs/specs/2026-11-28-trophy-alerts-and-local-dashboard.md`; `docs/tasks/TASK-2026-11-28-trophy-alerts-and-local-dashboard.md` |
| 2026-11-28 | ZCode (GLM-5.3-Flash, pk:plan Minimal) | Daily-missions bot scoping block (#607 dogfood) | Created `docs/tasks/TASK-2026-11-28-daily-missions-scoping.md` (L2 Minimal: directions D1-D3, Cozier paywall as hard constraint HARD-1, `ASSUMPTION-1`..`4`, M0-M2 sketch) plus its scope-1 record after `tests/docs.test.js:32` demanded docs indexing; synced this tracker (§3/§3A/§7/§8/§9) and indexed both records in `docs/README.md`. `npm run typecheck` exit 0; `node --test` 448/448; no code changes; owner sign-off 2026-11-28 ('sign-off D1 commit' - D1 selected); closed with an owner-authorized atomic docs-only commit. | `docs/tasks/TASK-2026-11-28-daily-missions-scoping.md`; `docs/tasks/TASK-2026-11-28-daily-missions-scoping.scope-1.md`; `docs/README.md`; `docs/STATE.md` |
| 2026-11-28 | ZCode (GLM-5.3-Flash, pk:spike + pk:plan Minimal) | M0 live DOM spike & D1 mission awareness (#607 dogfood Runs #2-#3) | Live ego-browser spike resolved `ASSUMPTION-1..4` (Quests DOM readable; reset ≈08:00 UTC via DOM countdown; rewards auto-granted; claim CSS observed, never clicked) with 0 casts/0 presses. Implemented D1: new `src/missions.js` (thin DOM walk + pure parser, 125 ln), `tests/missions.test.js` (8 tests, 94 ln), panel `Missions` fold (read-only, ≤264px budget), additive `exportRun.missions`, fishserve `/report` `missions` field from newest snapshot, dashboard Missions section; dist rebuilt. `npm run typecheck` exit 0; `node build-userscript.js` exit 0; `node --test` 456/456. | `src/missions.js`; `tests/missions.test.js`; `panel.js`; `fishserve.js`; `dashboard.html`; `autofish.js`; `build-userscript.js`; `types.d.ts`; `dist/autofish.user.js`; `docs/tasks/TASK-2026-11-28-missions-awareness-d1.md`; `docs/README.md`; `docs/STATE.md` |
| 2026-11-28 | ZCode (GLM-5.3-Flash, pk:plan Lite, solo-fast) | D2 mission auto-claim awareness & handling (#607 dogfood Run #4) | Preset switched to `solo-fast` via `./.promptkit/init.sh --solo-fast` (verified `preset: solo-fast`; installer degraded the Engine Version stamp to `unknown @ unknown` — restored to `v2.6.1 @ unknown`; doctor exit 0). D2 implemented under a fresh owner go lifting the 08:37 parking: pure `planClaims` exact-match planner + claim-aware `readQuests` (`src/missions.js` +35 ln), `F.pressElement` PointerEvent primitive + additive `exportRun.claims` (`autofish.js` +32 ln), opt-in `Auto-claim missions` toggle (default off) + guarded 60 s `autoClaimPass` with HARD-1 stand-downs (focus session, Cozier upsell) + claimable annotations + `exportClaimState` hook (`panel.js` +118 ln), additive `claims` in `latestMissions` + dashboard, 2 FishApi declarations, 10 new tests (`tests/missions.test.js` +103 ln). `npm run typecheck` exit 0; `node build-userscript.js` exit 0; `node --test` 466/466 (456+10) — all first-run green, zero repair cycles. Owner sign-off 'sign-off D2 commit' 2026-11-28 09:21; committed locally per the two-commit pattern; dist rebuilt; `src/loop.js` untouched. | `src/missions.js`; `autofish.js`; `panel.js`; `fishserve.js`; `dashboard.html`; `types.d.ts`; `dist/autofish.user.js`; `tests/missions.test.js`; `docs/tasks/TASK-2026-11-28-missions-claim-d2.md`; `docs/README.md`; `docs/STATE.md` |
| 2026-11-28 | ZCode (GLM-5.3-Flash, L1 live smoke, ego + computer-use) | D2 userscript live smoke — **PASS** (read-only, owner-directed) | Installed the committed `dist/autofish.user.js` into ego's Tampermonkey from the local fishserve URL (TM Reinstall diff = exactly the D1+D2 block). Live on `app.lofi.town`: `doctor()` idle — 0 casts, 0 presses, never started/seated; `exportRun` carries `missions` (honest null when Quests closed) + `claims {pref:false}`; panel shows `Auto-claim missions off` by default; live Quests read: daily scope, 3 real rows, `claimCount 0`, planner reason `auto-grant: completed quests show no claim controls` (ground truth: 0 claim controls in DOM); the sampler post carried it — `/report` serves `missions`+`claims` and `/dashboard` renders the Claimable row; one guarded pass with pref on: `planned 0, clicked 0`, honest `no quests read`, then toggled back off (`stored false` verified after a clean reload). Observation: ego-window churn (repeated game socket disconnects + TM reinstall/reload races) produced a transient stale-panel export lag (`claims.pref` one toggle behind storage) that self-healed on a clean reload — persisted pref, guard chain and pass behavior all correct; the overnight soak sharing that profile was cleared/paused with owner approval (20 capture posts saved). dist byte-fresh (rebuild zero drift); typecheck/build/tests green post-smoke. | `dist/autofish.user.js`; `fishserve.js`; `dashboard.html`; `docs/STATE.md` |

---

## 9. Session Spend Ledger
<!-- Table Invariant: Keep rows strictly contiguous without blank lines; escape literal pipes as \|; use <br> for multi-line cells -->

| Session | Turns | Measured in/out | Estimated context payload | Note |
| :--- | :--- | :--- | :--- | :--- |
| 2026-11-22 (PromptKit sync) | ~16 | host telemetry unavailable | 128k–240k heuristic context payload | duration=not tracked; repairs=1; interventions=3; verification=`node --test` 369/369; outcome=accepted |
| 2026-11-27 (PromptKit 2.6.1 upgrade & checkpoint) | ~5 | host telemetry unavailable | not measured | duration=not tracked; repairs=0; interventions=3; verification=`node --test` 428/428, `check-doctor.sh` exit 0; outcome=accepted |
| 2026-11-28 (pk:plan missions scoping, #607 dogfood) | ~15 | host telemetry unavailable | not measured | duration=not tracked; repairs=1 (docs-index test failure fixed via scope change 1); interventions=1 (completion/sign-off gate); verification=`npm run typecheck` exit 0, `node --test` 448/448, `check-doctor.sh` exit 0; outcome=accepted (owner sign-off 'sign-off D1 commit') |
| 2026-11-28 (D1 missions awareness, #607 Run #3) | ~22 | host telemetry unavailable | not measured | duration=not tracked; repairs=1 (4 tsc errors in new module fixed with `@type` annotations) + 1 state-guard archival repair; interventions=1 (completion/sign-off gate); verification=`npm run typecheck` exit 0, `node build-userscript.js` exit 0, `node --test` 456/456, `check-doctor.sh` exit 0; outcome=accepted (owner sign-off 'sign-off commit') |
| 2026-11-28 (D2 missions auto-claim, #607 Run #4, solo-fast) | ~35 hand-tallied | host telemetry unavailable | not measured | duration=not tracked; repairs=0 (typecheck, build and tests all first-run green; 1 STATE.md Engine Version stamp restore after the preset installer degraded it); interventions=1 (completion/sign-off gate); verification=`npm run typecheck` exit 0, `node build-userscript.js` exit 0, `node --test` 466/466, `check-doctor.sh` exit 0; outcome=accepted (owner sign-off 'sign-off D2 commit') |

- **Running total**: `not measured` on current session (host telemetry unavailable); 128k–240k heuristic context payload preserved on the 2026-11-22 historical row. Refreshed by `pk:checkpoint`; one row per real work session.
- **Note evidence**: use `duration=<value>; repairs=<count or not tracked>; interventions=<count or not tracked>; verification=<result or not tracked>; outcome=<accepted | rejected | incomplete | blocked | not tracked>`. Never infer `0`, `passed`, or `accepted` from missing evidence.
- **Evidence boundary**: this ledger is operational telemetry, not CPAC benchmark evidence. Heuristic context payload is not provider billing telemetry or actual spend; avoided rework remains `not measured` without comparative evidence. Preserve historical rows and the five-column shape without silent backfill.
