# Task: Catch log v1

Spec: [2026-10-28-catch-log.md](../specs/2026-10-28-catch-log.md)
Level: 2 (Controlled) · Owner: lead · Started: 2026-10-28 · Status: in progress

## Objective

Keep a durable, server-free record of every **parsed** catch, broken down by species and
rarity (including shiny and event tiers), expose it through `__fish.log()` /
`__fish.logCsv()` / `__fish.logReset()`, and surface a rarity strip plus the last catch in the
in-game panel.

## In scope

- `autofish.js`: the embedded species catalogue, the pure ledger helpers, the ledger write in
  `recordCatch`, the three `__fish.log*` entry points, status/report wiring.
- `panel.js`: rarity strip + last-catch line fed from `__fish.log()`.
- `scripts/gen-catalogue.js`: offline regeneration of the embedded catalogue from a saved game
  bundle (the bundle itself stays git-ignored).
- `tests/catchlog.test.js`, `tests/panel.test.js` additions.
- `AUTOFISH.md` section, `docs/STATE.md` milestone.
- `dist/autofish.user.js` rebuilt by `node build-userscript.js`.

## Out of scope

- No change to the catch oracle (only parsed card text counts), no new input paths, no new clicks.
- No change to `catches.csv` / `sessions.csv` columns.
- No cloud sync, no IndexedDB, no second dashboard UI.
- No pixel-based rarity or level-bar reads.

## Contract

- Ledger key: `autofish:log:v1`. One write per parsed catch, inside `try/catch`; a storage
  failure must never stop the fishing loop.
- Rarity is the card's printed word when present, otherwise derived from the embedded
  catalogue and labelled `derived: true`; never guessed from pixels.
- Panel writes nothing to the ledger; it only reads.

## Acceptance

1. After a parsed catch, `__fish.log()` reports that species with count, best weight, first/last
   seen, and rarity either printed (`derived: false`) or catalogue-derived (`derived: true`).
2. The ledger survives a page reload (localStorage), and `logReset()` empties it.
3. `logCsv()` returns a header plus one row per species, parseable by a spreadsheet.
4. The panel shows per-rarity counts and the last catch, updated within one render tick.
5. `node --test` passes, `node --check autofish.js` is clean, and `node build-userscript.js`
   still produces a working single file.

## Verify

- `node --test`
- `node --check autofish.js`
- `node build-userscript.js` then grep the dist for the catalogue sentinel
- live: inject the new build in the lofi.town tab, confirm `__fish.log()` shape, panel strip,
  and at least one real catch landing in the ledger.
