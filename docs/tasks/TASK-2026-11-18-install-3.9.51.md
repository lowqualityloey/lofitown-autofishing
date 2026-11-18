# 3.9.51 post-night install checklist

Install only after the morning report has been read and saved. The live tab is still running
3.9.49; reloading ends the night's run.

## Before the reload

- [ ] The morning report has been generated from `data/runs` and saved.
- [ ] Expect **no** `nepchur` row in `sessions.csv` tonight: 3.9.49's panel returns early for named
      profiles, so the report says `unbounded`. That is the gap this build closes.
- [ ] Leave the night's session live if you want the reload to post its row; if it was already
      stopped, the night stays unbounded. The 3.9.51 reload posts the interrupted session as a
      `reload` row under `nepchur`, and re-running the report afterwards bounds the night (the gap
      since the last snapshot reads as unaccounted).
- [ ] Merge PR #28 into `main`, then pull it in the checkout fishserve runs from and restart the
      server **before** the userscript:
      `systemctl --user restart fishserve`
      `systemctl --user is-active fishserve`
      `curl -s "http://127.0.0.1:8731/sessions?profile=nepchur"`
      The endpoint defaults to the server's local day; `&day=$(date +%F)` is equivalent. After the
      restart expect `"profile":"nepchur"` and a six-column header in `sessions.csv`. An old server
      ignores `profile` and writes five-column rows, so this order matters.

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
- [ ] `firstPressHeld` is rare (fast dials should skip the hold entirely) and `firstPressForced`
      is far below it (3.9.49: 37/37).

## If it regresses

- [ ] Reinstall the 3.9.49 build from the main checkout
      (`git show v3.9.49:dist/autofish.user.js > /tmp/autofish-3.9.49.user.js`) and reload. The new
      session rows stay readable; the old build simply writes `default`.
