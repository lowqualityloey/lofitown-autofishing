# Task: Trophy Retention, Card Cleanup, Event Context and List Triage

Level: 2 (Controlled) · Owner: lead · Created: 2026-11-28 · Status: in_progress · TDD Enforcement Mode: disabled

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

- Baseline: `npm run typecheck` exit 0 after Phase 1 source edits; full gate recorded per commit.
- Real store: read-only verification only; no production data writes.
