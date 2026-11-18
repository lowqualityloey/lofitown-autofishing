# Overnight capture in the real game - live verification, 2026-11-18

Environment: BrowserOS neo, `https://app.lofi.town/?ref=home_hero`, 1435x944 window, profile
`nepchur`, 502 players in the lobby. The page ran the rebuilt **3.9.47** loaded from
`http://127.0.0.1:8731/autofish.user.js`; the Tampermonkey install was 3.9.46, so it was unmounted
and the page copy injected for this check. The panel kept its real **closed** shadow root. Fishserve
ran on 8731, then on 8732 after the address was moved. Unit tests at the time: `node --test` -> 340
pass, 0 fail.

This is the check the earlier harness could not make: the harness had to open the shadow root to
reach the controls. Here the closed root stayed closed. Coordinates were measured through CDP
`DOM.getDocument({pierce:true})`/`DOM.getBoxModel` and the clicks were sent through the BrowserOS neo
input bridge, not DOM `.click()`.

## Observed

| Check | Result |
| --- | --- |
| Rebuilt 3.9.47 mounts in the real game | pass - `__fish.version === "3.9.47"`, panel header `v3.9.47`, one host, no `mountError` |
| The panel is still a closed shadow root | pass - no page-accessible `shadowRoot`; coordinates were read through CDP's pierced DOM tree |
| A real click expands the pill | pass - trusted click at (37,37), card 266x378, section header available |
| A real click opens Session & guards | pass - trusted click at (145,293), `aria-expanded="true"` |
| A real click on the Overnight capture **label** arms it | pass - trusted click at the label box, prompt `fishserve address for overnight capture`, accepted `http://127.0.0.1:8731`; pref `overnight:true`, `overnightBase:"http://127.0.0.1:8731"`, line `capture armed · 1 post · last 19:09` |
| The first snapshot reaches the server | pass - `__overnight.status()` posts 1, 250 attempts, `export-2026-11-18T06-09-52-273Z.json`; fishserve logged `export  250 attempts  nepchur` |
| A moved fishserve turns the line amber | pass - 8731 stopped, 8732 started, `__overnight.now()` failed; line `capture armed · 1 posted · last post failed: POST failed: Failed to fetch - is fishserve running on http://127.0.0.1:8731?`, class `capture warn`, `role="button"`, `tabindex="0"`, `cursor:pointer` |
| A real click on the amber line asks for a correction | pass - trusted click at (145,119); prompt opened with the stale address as its default |
| Accepting the new origin corrects and re-arms | pass - accepted `http://127.0.0.1:8732`; pref/base both 8732; line `capture armed · 1 post · last 19:11`; `__overnight.status()` posts 1, lastError null, `export-2026-11-18T06-11-01-191Z.json` |
| The old server gets nothing after the correction | pass - 8731's log ends at the 06:09 export; no 06:11 row |
| The cycle repeats | pass - 8732 stopped, amber again; amber-line click accepted 8732 after restart; `export-2026-11-18T06-12-51-856Z.json`, line `1 post · last 19:12` |
| Panel clicks are real and do not reach the game | pass - six `click` events on the host, every one `isTrusted: true`; the panel's host swallows the game-side event |

The exact click log was: (37,37) pill, (145,293) section header, (130,638) capture label twice, and
(145,119) amber line twice. The accessibility tree exposed the line as
`button "capture armed · ..."` while it was clickable; after the correction it became a non-actionable
generic with `tabindex="-1"`.

## Not observed

| Check | Why |
| --- | --- |
| A full overnight run and its morning `## Coverage` | requires the night; this check covers the capture path and both address directions only |
| The 11-minute stale-post branch | the failed-post branch was used instead; both share the amber line and the healer |
| A backoff retry after 30 s/1 m/2 m/5 m | the correction happened immediately; the timer path is unit-guarded |
| A browser restart re-arming from prefs | would have reverted the injected build to Tampermonkey 3.9.46 |
| Tampermonkey installing 3.9.47 | not released at verification time; the page copy was injected |
| The line remembering a wrap/long form | the 244 px line ellipsizes long failures; full text is in the title and AX tree |

## Finding that mattered: the failed-POST branch was dead

The live failed post exposed a defect in 3.9.47's new sampler error path. The message still named a
removed `PORT`:

```js
state.lastError = 'POST failed: ... - is fishserve running on ' + PORT + '?';
```

`PORT` no longer existed, so the handler threw a `ReferenceError` inside its own `catch`.
`lastError` stayed `null`, the line stayed green, and the amber post-failure state could never be
reached. The fix names the resolved origin (`ORIGIN`) instead. A VM test now runs a real sampler
against a rejecting `fetch` and asserts `lastError` contains the origin and the underlying error,
and that `now()` reports again without throwing. This is why the live check existed: the 339-test
suite at the time did not cover the failed-post message.

## Limitations and cleanup

- This was a **page injection**, not a Tampermonkey install. The open tab runs 3.9.47; a reload
  restores 3.9.46 until the release is installed.
- The test left `overnightBase` at `http://127.0.0.1:8732` with `overnight:false`; the capture was
  toggled off and the temporary fishserve processes were stopped. The three test exports remain in
  `data/runs`.
- The screenshots were captured from the real BrowserOS neo window with Win32 `PrintWindow`, then
  cropped to the panel above the Profile selector. The profile name and catch counters are visible
  in the originals; the docs copies keep the capture line and Overnight row but leave the profile
  selector out of frame, and were inspected before staging.
- The amber line is intentionally one line. At 244 px, a long POST failure shows
  `last post failed: POST fai...`; the origin and full error are in the tooltip. A wrap or a shorter
  label is a possible polish item, not a correctness issue.

## Evidence

- `docs/images/capture-armed-3.9.47.png` - corrected 8732 address, line green.
- `docs/images/capture-stale-3.9.47.png` - 8732 stopped, line amber.
- Spec: `docs/specs/2026-11-18-overnight-capture.md`.
- Task: `docs/tasks/TASK-2026-11-18-overnight-capture.md`.

## Next

1. Release 3.9.47 and install it in Tampermonkey; reload and confirm the version persists.
2. Run one real night with fishserve on a stable port, then read `## Coverage` and record the result
   in this review and the task.
