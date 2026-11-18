# 3.9.51 post-night install checklist

Install only after the morning report has been read and saved. The live tab is still running
3.9.49; reloading ends the night's run and logs the interruption as a `reload` session row.

## Before the reload

- [ ] The morning report has been generated from `data/runs` and saved.
- [ ] The night's session row is in `sessions.csv` and names `nepchur`.
- [ ] Merge this work into the checkout fishserve runs from, then restart the server **before** the
      userscript:
      `systemctl --user restart fishserve`
      `systemctl --user is-active fishserve`
      `curl -s 'http://127.0.0.1:8731/sessions?profile=nepchur'`
      An old server ignores `profile` and writes five-column rows, so this order matters.

## Install

- [ ] `node build-userscript.js`; `grep '@version' dist/autofish.user.js` reads `3.9.51`.
- [ ] Replace 3.9.49 with `dist/autofish.user.js` in Tampermonkey, then reload the game tab once.
- [ ] `__fish.version` and the panel header both read `3.9.51`.

## Prove it on a short run

- [ ] Start a session; after ~10 catches, `tail -1 sessions.csv` ends with `,nepchur`.
- [ ] `__fish.status().stats`: `pressRejected` is 0 and `misses` is 0.
- [ ] Over slow dials in `__fish.report().outcomes`, mean presses is above 1.44 (3.9.49: 61% got one).
- [ ] `firstPressHeld` appears only on narrow/fast dials, and `firstPressForced` is far below it.

## If it regresses

- [ ] Reinstall the 3.9.49 build (`git show v3.9.49:dist/autofish.user.js > /tmp/autofish-3.9.49.user.js`)
      and reload. The new session rows stay readable; the old build simply writes `default`.
