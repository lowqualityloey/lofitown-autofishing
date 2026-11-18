# Spec: overnight capture and the morning report (3.9.45-3.9.47)

Status: implemented and live-verified 2026-11-18 · release pending · Level 2

## Problem

The page keeps resolved fish attempts in `autofish:run:v1:<profile>` and caps that store at 250
rows. A night at roughly 1.3 attempts a minute is 600+ attempts, so more than half the night rolls
off before morning. The 2026-11-17 night lost **7 h 43 m** this way: `data/runs` jumps from
`07:18:47Z` to `15:01:45Z`, and the page store only reached back to `12:12:41Z`.

A console-pasted sampler had the same failure in a different place: it died with the page. The
capture must therefore belong to the panel, survive a reload, heal when it stops, and say on the
panel whether it is actually writing. The morning report must read one night and verdict whether
the data reaches the end of that night's session.

## Goals

1. Sample `__fish.exportRun()` immediately and every five minutes while the pref is on.
2. Re-arm after a page load without asking again, and heal a dead sampler or a failed post.
3. Report from the panel: armed, posting, failed, stale, or re-arming.
4. Let the owner correct a fishserve address that moved without editing localStorage.
5. Make the whole "Overnight capture" row the control, because the status line tells the owner to
   click it.
6. Read the night that the newest snapshot belongs to, not "everything ever captured".
7. State whether the capture reached the last logged session, and fail loudly when it did not.

## Non-goals

Cloud upload, authentication, multiple simultaneous fishserves, capture while the page is closed,
retroactive recovery of a night that was never sampled, and any change to fishing behaviour.

## Prefs and address

The capture pref lives with the other panel prefs in `autofish.prefs`:

```json
{ "overnight": true, "overnightBase": "http://127.0.0.1:8731" }
```

- `overnight` is the switch. `overnightBase` is the last accepted fishserve origin.
- The address must match `^https?://[^/]+:\d+$`; a trailing slash is stripped. A path is rejected,
  because the sampler appends `/export` itself.
- A panel served by fishserve already has `BASE`; that origin wins and no prompt is shown. The
  inlined userscript has `BASE === null`, so the first enable asks for an address and stores it.
- The pref is browser-wide, not per profile: it points at a server, not at a catch history.

## Sampler contract

The panel loads `<origin>/overnight.js` (the file is `scripts/overnight-export.js`) and sets
`window.__overnightBase = origin` first.

The sampler resolves its POST origin as:

1. `window.__overnightBase`, when present (the panel path);
2. `http://127.0.0.1:<window.__overnightPort>`, when present (older console-pasted installs);
3. `http://127.0.0.1:8731` (documented console-paste fallback).

It strips trailing slashes and POSTs to `<origin>/export`.

- The first snapshot runs on load, before the panel can leave the tab unattended.
- The interval is five minutes. At ~1.3 attempts/minute that is about seven new rows between
  posts, well below the 250-row cap, so consecutive snapshots overlap.
- The payload is `__fish.exportRun()` as JSON; fishserve writes one file per post to
  `data/runs/export-<ISO>.json`.
- `window.__overnight` is installed before the first POST and exposes:
  - `status()` -> `{ stopped, posts, last: { at, reason, attempts, file } | null, lastError }`;
  - `now()` -> force one snapshot;
  - `stop()` -> stop the timer only.
- A failed POST sets `lastError` and is never allowed to throw out of the sampler's error handler.
  The message names the origin it tried.

## Panel state and controls

The status line under the meters is the capture's face:

| State | Text | Tone |
| --- | --- | --- |
| off | empty; line hidden | - |
| loading | `capture: loading the sampler from <origin>...` | normal |
| load failed | `capture: no answer - click to change the address` | amber |
| no address | `capture: no address - click Overnight capture` | amber |
| sampler missing/stopped | `capture: the sampler is not running · re-arming` | amber |
| first post in flight | `capture armed · first post in flight` | green |
| healthy | `capture armed · N post(s) · last HH:MM` | green |
| failed post | `capture armed · N posted · last post failed: <message>` | amber |
| stale | healthy line plus ` · stale (fishserve gone?)` when the last post is over 11 min old | amber |

The 11-minute threshold is two missed five-minute posts and is one constant shared by the line and
the healer.

- The whole row (`.row`) toggles the pref. One listener on the row; the switch's own click bubbles
  into it, so the label and the button each toggle exactly once.
- When the line is amber and the panel is inlined (`!BASE`), the line is a button: pointer cursor,
  `role="button"`, `tabindex="0"`, and Enter/Space work. Clicking it prompts for a corrected
  origin. A valid answer stops the old sampler, saves the pref, clears the backoff and re-arms.
  Cancelling or entering an invalid origin changes nothing.
- A served panel cannot edit its address; its origin is the server that served it.
- The line's title carries the full origin and, when a retry is pending, the backoff explanation.
  The 244 px line ellipsizes long failures; the full text remains in the title and the accessibility
  tree.

## Self-healing

`tick()` calls `healCapture()` once a second, outside the render path. It only acts when the pref
is on and an address exists.

| Finding | Action |
| --- | --- |
| no sampler, or `status().stopped` | load `/overnight.js` again |
| live sampler with `lastError` | call `__overnight.now()`; never stack a second timer |
| live sampler whose last post is over 11 min old | call `__overnight.now()` |
| no address | do nothing; only the toggle can supply one, and nobody should be prompted at 3 a.m. |

Attempts back off **30 s, 1 min, 2 min, 5 min**, reset on a healthy arm or a successful post. The
backoff stamp is set before each attempt, so fishserve is asked at most once per step while it is
down.

## Session rows and coverage

Session ends post to `BASE` when fishserve served the panel; the inlined install posts to the
capture address (`BASE || captureServer()`), so the same `sessions.csv` that the report reads is
fed by the same server. The default-profile guard is unchanged.

## Morning report

`node scripts/overnight-report.js` reads one night by default:

- It dates each snapshot from `exportedAt`, then the `export-<ISO>` file name, then mtime.
- The default window is the 12 hours ending at the newest snapshot, not "now", so a report run the
  next afternoon reads the night rather than every file ever captured.
- `--all` merges everything; `--hours N` and `--since ISO` move the window; explicit file paths
  read exactly those files.
- Attempts the page store carried from an earlier run are left out of the totals; the summary says
  how many were dropped.
- It merges snapshots by attempt id, reports catch rate with a Wilson interval, width bands, losses,
  gaps over ten minutes, cut reasons, doctor verdicts, the last perf line, and the sessions
  fishserve logged in the same window.
- The `## Coverage` section compares the newest attempt with the last session row:
  `complete`, or `X h Y m unaccounted - the capture stopped at HH:MM` (or "posts kept landing, but
  no attempt was recorded after"), naming the moment. With no session row it says so and does not
  fail.
- Exit status is 1 only for a truncated or unreadable night; 0 otherwise (including no session
  row).

## Failure modes

| Failure | Expected behaviour |
| --- | --- |
| fishserve down at page load | load fails; amber line says no answer; click the line after starting it |
| fishserve moves ports | last post fails or goes stale; click the amber line, enter the new origin |
| sampler script deleted/stopped | line says re-arming; tick loads it again on the backoff |
| POST fails while sampler lives | line turns amber with the origin in the message; healer retries with `now()` |
| page reloads | pref on: mount loads the sampler and posts immediately; no prompt |
| capture off | line hidden; no requests |
| no address ever supplied | no traffic; enabling prompts once, cancelling leaves it off |
| report before the first session row | prints no-session-row note, exit 0 |
| capture died before the last session | `## Coverage` names the unaccounted time, exit 1 |

## Verification

- `node --test` covers the sampler origin/fallbacks and the failed-post status, the panel row and
  line guards, night scoping, coverage, and a session-to-report integration.
- The live verification is `docs/reviews/2026-11-18-capture-address-live.md`: real clicks in the
  real game with the panel's shadow root left closed, both address directions, and the
  `PORT` bug found and fixed.
