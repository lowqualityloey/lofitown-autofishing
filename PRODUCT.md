# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo desktop `lofi.town` (`app.lofi.town`) players using Chrome, Edge, or Firefox with Tampermonkey (or Violentmonkey), running either casual daytime sessions or unattended overnight sessions.

- **Balanced surface priority**: Keep zero-server Tampermonkey simplicity on the primary HUD surface (`Start / Pause`, `Stop`, timer, counters, Catch history), while housing power-user session guards, profile switches, and overnight telemetry (`fishserve.js` + `/dashboard`) cleanly inside foldable sections and the local companion dashboard.

## Product Purpose

AutoFish automates repetitive fishing in `lofi.town` by reading rendered canvas frames and pressing the reel dial reliably, while keeping catches, rarity counts, daily budgets, and session diagnostics legible in plain words. Success means effortless single-file installation for casual fishing and trustworthy, self-diagnosing recovery across hours-long sessions without losing data.

## Positioning

A **single-file, zero-server-required** userscript (`dist/autofish.user.js`) whose HUD, session state machine, catch ledger, 24h IndexedDB trophy viewer, and CSV export all work offline inside the browser, paired with **honest failure reporting**: when something stops working (standing up, occluded tab, `waiting-for-result` lock, `core-crash`, or a blind detector), the panel pauses and names the exact cause and recovery action instead of silently burning time or faking progress.

## Operating Context

- **Primary HUD (`panel.js`)**: Closed Shadow DOM floating overlay (`264 px` wide card, collapsible to a `48 px` `🎣` pill) on `https://app.lofi.town/`. Supports Flow nonstop fishing and Timed/budgeted schedules, per-profile local ledgers, optional Web Audio rare chimes, 24h IndexedDB cropped trophy cards (`LEG`/`SEC`/`shiny·golden`), 6h-cached Tampermonkey release checks, and 1-click `↓ CSV` export.
- **Local Capture Server (`fishserve.js` + `dashboard.html` + `install.html`)**: Optional companion Node HTTP server on `127.0.0.1:8731` streaming `catches.csv` rows, `sessions.csv` rows, `shots/diag/` diagnostics, and 5-minute `data/runs/` snapshots (`14` days / `1,000` files pruning, `<24h` protected), plus the `GET /dashboard` overnight analytics view.

## Capabilities and Constraints

- **Desktop browser only**: Requires a visible, non-occluded desktop window (the game freezes timers when hidden/minimised); mobile and headless environments are unsupported.
- **Zero runtime dependencies & browser-local first**: Plain ES/CommonJS (`// @ts-check` verified via dev-only `typescript`) with no bundler, no external runtime libraries, and no mandatory server; all catch ledgers and budgets live in `localStorage` and rare card thumbnails (`<=240 px` JPEG) live exclusively in `IndexedDB` (`never localStorage`).
- **Multi-profile isolation**: Multiple game accounts in one browser maintain isolated catch histories, daily budgets, cooldowns, and IndexedDB trophy cards.
- **Safety & rate guards**: Honest pause reasons (`seat`, `hidden`, `focus`, `no-catch`, `cast-stall`, `player-block`, `profile-open`, `result-missing`), rolling `3/10m` zombie core-revive cap, bounded `<=2/60m` `result-missing` auto-reload when `Resume after reload` is on, and `<=264 px` panel footprint preserving game UI legibility.
- **No external network tracking**: No analytics or third-party calls beyond explicit user-enabled GitHub release checks (`!BASE` userscript mode) and optional localhost `fishserve`.

## Brand Commitments

- **Identity**: `AutoFish` / `lofi.town AutoFish` (`MIT` license, explicitly unaffiliated with `lofi.town`).
- **Voice & Copy**: Direct, plain-English UI labels and status banners that state *what happened*, *why it paused or stopped*, and *what the user should do next*. Quiet by default (`Rare catch chime` and `Local capture` opt-in).

## Evidence on Hand

- Live browser screenshots and documentation in [README.md](README.md), [AUTOFISH.md](AUTOFISH.md), `docs/images/in-game.jpg`, and `docs/images/panel.jpg`.
- Architecture specs, release notes, and living state tracker in [docs/STATE.md](docs/STATE.md) and `docs/specs/`.
- Live soak telemetry & test suite (`446/446` `node --test` passing; `v3.9.65` Flow live soak `81/82` caught `98.8%`; overnight `147/151` `97.4%` observed in `/dashboard`).
- **Absences not to fabricate**: Do not invent external user testimonials, server uptime promises, ban immunity claims, or mobile support.

## Product Principles

1. **Zero-server default, optional depth**: A casual Tampermonkey user must be able to fish, track stats, preview 24h rare cards, and export CSVs without touching a terminal.
2. **Honesty over fake uptime**: Never mask a stalled loop, missed frame, hidden tab, or locked game state as active fishing; stop/pause transparently with actionable plain-English recovery guidance.
3. **Stay out of the game's way**: Respect the compact `<=264 px` HUD budget, avoid covering fishing zones (`layout.js`), keep notifications quiet until opted in, and isolate accounts by profile.
4. **Local ownership of data**: Keep ledgers in browser storage (`localStorage`/`IndexedDB`), snapshots in local filesystem files, and zero external dependencies.

## Accessibility & Inclusion

- **Plain-English diagnostics**: Explain every pause reason, blocker, and first-time optional prompt clearly without bot-internal jargon.
- **Full keyboard access**: Ensure every interactive control (`button`, clickable badges, sortable/clickable rarity counters, tabs, and popovers) supports semantic roles, visible focus states, and `Enter`/`Space` activation.
- **Low-glare overnight readability**: Preserve comfortable contrast and restrained visual noise for unattended or dark-room desktop viewing.
