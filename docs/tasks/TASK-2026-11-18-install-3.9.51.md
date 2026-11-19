# 3.9.51 post-night install checklist

Install only after the morning report has been read and saved. At the start of this install the
live tab was on 3.9.49; it was reloaded at 08:13 and now runs 3.9.51. Reloading ends the night's
run.

## Before the reload

- [ ] The morning report has been generated from `data/runs` and saved.
- [ ] Expect **no** `nepchur` row in `sessions.csv` tonight: 3.9.49's panel returns early for named
      profiles, so the report says `unbounded`. That is the gap this build closes.
- [ ] Leave the night's session live if you want the reload to post its row; if it was already
      stopped, the night stays unbounded. The 3.9.51 reload posts the interrupted session as a
      `reload` row under `nepchur`, and re-running the report afterwards bounds the night (the gap
      since the last snapshot reads as unaccounted) - but only after the gate below has passed.
- [ ] The reload row is a bound, not a catch record: it carries the interrupted session's
      `minutes` but **0 catches** (the heartbeat stores no catch count), and its `started_at` is the
      reload time rather than the session start. Use it to bound coverage, never to total catches.

## Pre-install gate - blocking

Do not install or reload the userscript until every box below is checked. A reload before this
gate writes the reload row five-column: it reads back as `default`, the named night stays
unbounded, and restarting later cannot recover the lost profile. The 2026-11-19 08:13 reload did
exactly that.

- [ ] PR #28 is merged and the checkout fishserve runs from is fast-forwarded to it.
- [ ] `systemctl --user restart fishserve` has run; `MainPID` and the start timestamp changed.
- [ ] `head -1 sessions.csv` reads `time,started_at,minutes,catches,reason,profile`.
- [ ] `curl -s "http://127.0.0.1:8731/sessions?profile=nepchur"` returns the **local** day and
      `"profile":"nepchur"`.
- [ ] Only then replace the userscript and reload the tab.

## Install

- [ ] `node build-userscript.js`; `grep '@version' dist/autofish.user.js` reads `3.9.51`.
- [ ] Replace 3.9.49 with `dist/autofish.user.js` in Tampermonkey, then reload the game tab once.
- [ ] `__fish.version` and the panel header both read `3.9.51`.

## Prove it on a short run

- [ ] Start a session, catch a few, then **stop it** (or reload): rows are written when a session
      ends, not per catch. `tail -1 sessions.csv` then ends with `,nepchur`.
- [ ] `__fish.status().stats`: `pressRejected` is 0 and `misses` is 0.
- [ ] Over slow dials in `__fish.report().outcomes`, mean presses is above 1.44 (3.9.49: 61% got
      one). `const s = __fish.report().outcomes.filter(d => Math.abs(d.omega || 0) < 150); s.reduce((a, d) => a + d.presses, 0) / s.length`
- [ ] First-press gate: `firstPressHeld` is rare by the explicit cap
      **`firstPressHeld / dials <= 0.20`** - held first presses on at most one in five closed dials -
      and `holdPassesMax` stays under one rotation; `firstPressForced` is below 3.9.49's 37.
      Do **not** compare forced with held: `firstPressForced` counts budget expiry, can increment
      without a hold, and can exceed held. Calibration: 3.9.49 was 37/456 = 8.1%; the completed
      3.9.51 run was 6/57 = 10.5%; the larger live 3.9.51 sample was 17/98 = 17.35% at the
      2026-11-19 09:34 read. The cap still catches the all-held 37/37 failure while leaving headroom.
      The next build adds `stats.firstPressHeldForced` for dials that held and then forced; keep
      this 20% cap as the interim gate until that build is installed.

## If it regresses

- [ ] Reinstall the 3.9.49 build from the main checkout
      (`git show v3.9.49:dist/autofish.user.js > /tmp/autofish-3.9.49.user.js`) and reload. The new
      session rows stay readable; the old build simply writes `default`.
