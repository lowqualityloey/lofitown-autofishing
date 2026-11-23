# Catch path and focus/seat behavior - live verification, 2026-11-23

Environment: BrowserOS neo on `https://app.lofi.town/?ref=home_hero`, with the rebuilt
**3.9.55** userscript installed through Tampermonkey from
`http://127.0.0.1:8731/autofish.user.js`. The panel header and installed source both read
`v3.9.55`. The served file matched the committed dist: **376,535 bytes**, sha256
`d76f94acd67aa67976ae4d75e0c6a5b24dd16883b10480683834c9bfe3c180bd`. Fishserve ran on
`127.0.0.1:8731`; the branch was `freebuff/lofitown-autofish-behavior-review` at
`466b163`, four commits ahead of `main` at `2640df0`.

Verification state: `node --test` -> **372 pass, 0 fail**; `node build-userscript.js` exits
0 and leaves the committed `dist/` unchanged; `git diff --check main...HEAD` is clean.

## Observed

| Check | Result |
| --- | --- |
| The rebuilt script posts a catch to `/catch` | pass - `/recent` ended at `22:54:03Z` before the run; after Start it gained new rows at `23:07:27Z` (Asian Swamp Eel) and `23:07:43Z` (Nurse Shark), followed by more catches. `/recent` is written only by a successful `/catch` POST. |
| The panel tracks the posted catches | pass - the live panel showed the matching catch count and latest catch; the initial post-start run reached 6 catches before the reload used for the seat check. |
| A real seat pause is detected | pass - a trusted CDP movement hold stood the character up; after 45 s the core logged `needs a seat` (`no cast prompt: sit on a waterside chair`), `status().needsSeat` was true, and the panel was `paused` with `pauseReason: "seat"`. The footer read `clock paused — nothing to bite: sit on a chair by the water`. |
| Focus takes over an active seat pause | pass - clicking **Pause in focus sessions** on the real panel set `focusMode: true`, changed the reducer to `paused` / `pauseReason: "focus"`, released the seat cast hold (`cast hold ... on: false`), and replaced the seat footer with `paused for this focus session (toggle off to resume)`. `status().needsSeat` stayed true, so the seat fact was not lost. |
| Focus off restores the seat pause and warning | pass - toggling the real control off set `focusMode: false`, returned the panel to `paused` / `pauseReason: "seat"`, re-enabled the seat cast hold (`cast hold ... on: true`), and brought the `sit on a chair by the water` footer back. |
| The next live catch posts after resume | pass - after the character was seated again, the panel was paused by the user; pressing **Resume** returned it to `running` (`pauseReason: null`, `needsSeat: false`). The next catch was an **Axolotl**, Rare / Exquisite, `0.24kg`, `$73`, at `23:21:44.679Z` in `/recent`, and the panel count advanced from 3 to 4. |

The focus/seat clicks and key hold used the real BrowserOS input bridge; the panel's closed
shadow root remained closed. The bot itself remained seat-only - the movement key was a test
action, not a new bot behavior.

## Not observed

| Check | Why |
| --- | --- |
| Release or mirror asset verification | This branch has not been version-bumped, tagged or published. |
| A live session crossing local midnight | The 3.9.55 budget split remains a queued field run. |
| Zen/Gecko frame timing | The live check was Chromium; `__fish.perf()` on Zen is still open. |
| Prompt-scan false positives at untested viewport sizes | Not part of this focused check. |

## Release state

The behavior-review branch's dist is **376,535 bytes** at sha256
`d76f94acd67aa67976ae4d75e0c6a5b24dd16883b10480683834c9bfe3c180bd`. The published
v3.9.55 asset is a different build (376,149 bytes, sha256 `5544671ed0c0`). A same-version
Tampermonkey update therefore cannot deliver these fixes; shipping them requires a
patch release decision, without changing the version or pushing in this checkpoint.

## Cleanup and limits

Temporary screenshots, accessibility snapshots and CDP click logs were removed. The working
tree contains only the pre-existing mode-only changes to `docs/releases/3.9.51.md` and
`run.sh`; they were left unstaged and untouched. No push, tag or version bump was made.
