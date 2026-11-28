# Task: Trophy Retention, Card Cleanup, Event Context and List Triage

Level: 2 (Controlled) · Owner: lead · Created: 2026-11-28 · Status: completed · TDD Enforcement Mode: disabled

## Objective

Complete the approved trophy and Event UI follow-ups: make the 24h/40-card retention boundary visible, let a card be kept past expiry, clean existing card PNGs reversibly, explain an empty Event tab, and make the duplicate-heavy trophy list searchable/grouped. Keep version 3.9.74 and do not tag, release, push or deploy.

## Scope

- `panel.js`: trophy retention metadata and footer; Keep action in the lightbox; opt-in saved-card cleanup with original backup and restore; filter counts and Event empty context; search/sort/group list; unreadable-blob and legacy-missing fallbacks.
- `tests/trophy-ui.test.js` and existing test updates: pure helpers and source guards.
- `dist/autofish.user.js`: rebuilt after each phase.
- This task record.

## Non-goals

- No image download/export control in the lightbox. The current suite intentionally keeps the lightbox card-only.
- No real-store writes during testing; all writes are tested in a throwaway incognito profile.
- No version bump, tag, release, push or deploy.
- Do not modify the pre-existing dirty files (`docs/STATE.md`, `docs/releases/3.9.51.md`, `docs/releases/3.9.56.md`, `docs/reviews/2026-11-23-catch-and-focus-live.md`, `run.sh`, `.pkab/`).

## Acceptance Criteria

1. `AC-1 Retention`: the viewer shows count/cap, slots or next eviction, nearest expiry and missing count; a kept card survives the 24h TTL, but the 40-card cap still evicts from the lowest-priority end; Keep is reversible.
2. `AC-2 Cleanup`: a user-triggered cleanup decodes saved blobs, runs `stripCardSpecks({ pad: 8, minFrac: 0.01 })`, stores a new PNG and the original backup, reports progress/skips, and supports restoring originals. A failed card keeps its existing blob.
3. `AC-3 Event context`: filter counts update after render/save/prune/clear; each filter has a named empty state; Event explains that capture starts with this build and may show the all-time ledger counts.
4. `AC-4 Triage`: species search, newest/rarity/weight sort, and duplicate grouping; every card in a group remains reachable through the lightbox.
5. `AC-5 Resilience`: a blob that fails to decode shows the card-shaped placeholder rather than a broken image; a missing blob without a reason says it predates failure reasons.
6. `AC-6 Verification`: `npm run typecheck`, `node build-userscript.js` and `node --test` exit 0 after each phase; the throwaway browser check leaves the real store at 39 records / 37 PNGs / 2 missing.

## Evidence

- Commits: `c3c324e` (retention + Keep), `ba9c7cb` (reversible cleanup), `a3f4a03` (filter counts + Event context), `941d592` (search/sort/group), `e8d5e6c` (unreadable-card resilience), `aef7f2b` (Keep keeps the open group).
- Automated: `npm run typecheck` exit 0; `node build-userscript.js` wrote 541,236 bytes; `node --test` **494/494** pass.
- Incognito throwaway store (39 records / 37 PNGs / 2 missing): footer read `39/40 saved · 1 kept · 1 slot left · oldest expires in 1h · 2 missing`; tab counts 39/15/5/2/6/5; search preserved focus/cursor; newest/rarity/weight sorting and ×N grouping worked; a six-card group opened `1 of 6`; ArrowRight moved to `2 of 6`; Escape closed and returned focus; Keep changed to `Kept`/`aria-pressed=true` without leaving the group and released cleanly.
- Cleanup: `clean` required the second click, cleaned the synthetic speckled card, stored one backup, and `restore` returned the original; the other 36 cards were reported already clean; missing cards were skipped. Decode failure test showed `Card screenshot could not be read.` instead of a broken image; legacy missing showed `Captured before failure reasons were recorded.`; an empty Event tab showed both the capture-boundary sentence and `All-time ledger: 614 Halloween · 30 Christmas caught.`
- Layout: the trophy popup measured 264px, the toolbar had no horizontal overflow (search 175px, sort ending at 244px).
- Phase 5B remains deferred: no download/export control was added, and the existing card-only lightbox contract is unchanged.
- Real store: only read; no task write and no synthetic profile. Baseline was 39 records / 37 PNGs / 2 missing. During the check the live game independently appended `Phantom Jellyfish` at 2026-11-28T14:32:31Z (profile `nepchur`), leaving **40 records / 38 PNGs / 2 missing**. That row was not created, cleaned, kept, or deleted by this task; it was left untouched.
