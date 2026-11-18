# Task: overnight capture you can trust (3.9.45-3.9.47)

Level: 2 (Controlled) · Owner: lead · Started: 2026-11-17 · Status: released; overnight acceptance
in progress

## Objective

Make an overnight run survive the page's 250-attempt cap, reloads, a fishserve restart and a moved
fishserve address, and make the morning report say whether the capture reached the end of the run
instead of quietly ending at the last sampled attempt.

## Evidence that it is needed

- The 2026-11-17 night lost **7 h 43 m**: `data/runs` jumps from `07:18:47Z` to `15:01:45Z`, and
  the page store only reached back to `12:12:41Z`.
- 3.9.45 moved the sampler into the panel so a reload re-arms it; 3.9.46 added the tick/heal path;
  the first live 3.9.47 check found that the sampler's failed-POST handler still referenced a removed
  `PORT`, so `lastError` was never set and the post-failure amber state was unreachable.
- The report's original default merged every snapshot ever captured and measured gaps only between
  attempts, so the exact failure shape (capture dies while the run continues) printed as a clean
  night.

## Contract

- `overnight` and `overnightBase` live in `autofish.prefs`; the address is a validated
  `http(s)://host:port` origin, pathless.
- The sampler posts to `window.__overnightBase` and falls back to `__overnightPort` then
  `http://127.0.0.1:8731`.
- The first snapshot posts immediately; the timer is five minutes.
- `__overnight.status/now/stop` are available; the object is installed before the first POST.
- The panel line reports off/loading/error/arming/armed/failed/stale; the whole row toggles; an amber
  line in an inlined panel is a button that corrects the address.
- Tick heals a dead sampler and a failed/stale post on the 30 s/1 m/2 m/5 m backoff; a missing
  address is never prompted for at night.
- The report reads the 12 h ending at the newest snapshot, filters earlier-run attempts, and ends
  with `## Coverage`; exit 1 on a truncated/unreadable night, 0 with no session row.
- Session rows go to the same origin as the capture when the panel is inlined.

The full contract is `docs/specs/2026-11-18-overnight-capture.md`.

## Acceptance

1. A VM run of the real sampler posts to the whole stored origin, not just its port; the legacy port
   and the documented 8731 default still work.
2. A failed POST records `lastError` naming the origin and does not throw out of the handler.
3. Panel guards: a reload re-arms; the healer does not stack timers; the row's label and switch each
   toggle once; the amber line asks for an address only when editable; a served panel cannot edit.
4. Report tests cover night anchoring, explicit windows, earlier-run attempt filtering, the three
   coverage verdicts, and a real session row posted by the panel's body.
5. Live, with the panel's shadow root closed: a real click on the Overnight capture label arms the
   capture; a real click on the amber line corrects a moved origin and writes an export to the new
   server, with no further writes to the old one.
6. `node build-userscript.js` produces the committed dist; `node --test` passes.

## Result

- 3.9.47 is built (360,594 bytes) and the suite is **340 passing / 0 failing**.
- Live 2026-11-18 in BrowserOS neo on `app.lofi.town`, panel v3.9.47 with a closed shadow root:
  - label click -> prompt -> `http://127.0.0.1:8731`, pref on, `capture armed · 1 post · last 19:09`,
    a 250-attempt export;
  - fishserve moved to 8732 -> failed post -> amber line, `role="button"`, pointer cursor;
  - amber-line click -> prompt defaulted to 8731 -> accepted 8732, pref/base corrected, armed again,
    new export on 8732; 8731 received no further export;
  - repeated the stale/fix cycle once to capture both states.
- The live check found and fixed the `PORT` bug; a regression test now fails without the origin in
  the failure message.
- Released later on 2026-11-18: tag `v3.9.47` on `6dfbbab`, source and public mirror byte-identical
  at 360,594 bytes / sha256 `b2c072b5e4a2`. Tampermonkey lists 3.9.47 and a reload leaves
  `__fish.version` and the panel header at 3.9.47.
- Acceptance run started at 06:39:13Z with fishserve on 8731: first snapshot 250 attempts
  (`export-2026-11-18T06-39-13-390Z.json`), capture line green, panel running; the first new attempt
  caught an Alligator Gar. The morning `## Coverage` report is still pending.

## Verify

- `node build-userscript.js`
- `node --test`
- `node scripts/overnight-report.js` after a night (default 12 h window; check `## Coverage` and
  exit status)
- `node scripts/release.js --check` after the tag

## Out of scope

- Cloud upload, authentication, capture while the page is closed, or recovering attempts that were
  never sampled.
- Any change to fishing, detection, press timing or the catch ledger.
- Making `data/runs` a database; it remains one JSON file per snapshot.

## Release

Released 2026-11-18 as **v3.9.47** (tag on commit `6dfbbab`), carrying 3.9.45-3.9.47 together. The
source release and public mirror are identical at 360,594 bytes / sha256 `b2c072b5e4a2`, and
`node scripts/release.js --check` passes. Installed in Tampermonkey and confirmed after a reload.
The overnight acceptance run started at 06:39:13Z; its morning `## Coverage` verdict and exit status
are still to be recorded.
