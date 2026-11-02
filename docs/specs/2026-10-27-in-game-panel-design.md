# AutoFish control panel — design

Date: 2026-10-27
Status: draft for approval
Chosen approach: **panel inside the game** (picked in conversation)

## 1. Intent

The bot works; operating it does not. Today a session starts by pasting `autofish.js` into the page
from DevTools and ends by remembering to call `__fish.stop()`. There is no clock, no visible state,
and a page reload silently wipes everything.

The goal is an app-shaped control surface for one person sitting at the desk: install once, see a
small panel over the game, start a bounded session, watch it work, and have it stop itself.

## 2. Who it is for, and why now

One user (the owner) playing lofi.town in BrowserOS neo. The bot has already landed 85 catches
(`catches.csv`), so the uncertain part is done; the remaining gap is purely operational. The user
does not want to touch the console, and has said the manual start is the blocker.

## 3. Goals

1. One click to arm — no DevTools, no pasted code, no console.
2. A small panel over the game that never covers the fishing area and can be moved or collapsed.
3. A session has a length, and ends itself; an optional clock window (start 21:00, stop 23:00).
4. Live truth: elapsed time, dials, presses, catches this session, last catch read back.
5. Guards that stop a silently broken run instead of letting it run for hours.
6. A record of every session, so "did it actually fish while I was away" is answerable.

## 4. Non-goals

- Rewriting the detector. `autofish.js` behaviour stays as verified on 2026-10-27.
- Multiple accounts, packet tampering, memory editing, fingerprint evasion, hidden-tab operation.
- Multi-user, hosted, cloud sync, mobile.
- Auto-seating the character; if the avatar is not at a fishing spot, the panel says so and stops.

## 5. Anti-goals — failure even if it works

- The panel covers the CAST!/REEL! bubble, the dial, or the catch card, or swallows the bot's own
  synthetic press.
- The bot runs into a frozen/hidden game and reports success.
- A reload or navigation leaves the page pressing with no one watching.
- Sessions become metronomic or 24/7 — that raises exposure for no gain.

## 6. Constraints (measured, not assumed)

| Fact | Value | Source |
|---|---|---|
| Game freezes when the window/tab is not visible | `visibilityState` gate; rAF stops | SPIKE.md §7, live |
| A blanked screen ends the run | `navigator.wakeLock.request('screen')` keeps the display awake | Chrome/Edge screen wake lock |
| Detector reads | `drawImage` of the UI canvas — DOM is invisible to it | autofish.js |
| Page | Next.js SPA at app.lofi.town, no CSP header or meta tag | curl 2026-10-27 |
| Local server | 127.0.0.1:8731, CORS open, already reachable from the https page | 85 logged catches |
| **Geometry is viewport-relative** | dial (863,371) / bubble (864,319) at 1522×954; dial (813,407) / bubble (810,358) at 1620×1031 | SPIKE.md vs AUTOFISH.md |
| Catch card rect (at 1522×954) | x 620–985, y 315–720 | AUTOFISH.md |
| Canvas size | follows the browser window; dpr 1 | live |

**No coordinate is hardcoded anywhere in this design.** The two measured sets are the same layout at
two window sizes, which is why the panel must read the live geometry from `__fish` instead of
assuming 1522 or 1620 wide.

Because the detector reads canvas pixels directly, a DOM panel above the game is **invisible to the
detector** — it cannot confuse bubble or dial detection. The remaining interference risk is pointer
events, and it is real: `tap()` dispatches at `document.elementFromPoint(x,y)`, so a panel sitting
over the dial would receive the bot's own press and discard it. §9 makes that impossible.

## 7. Approaches considered

**A. Panel inside the game (chosen).** A DOM overlay injected into the lofi.town page. Nothing else
is opened, so the game never loses visibility because of the UI. Cost: cramped UI, dies on reload,
needs a bootstrap step.

**B. Dashboard at 127.0.0.1:8731.** Grow `fishserve.js` into a real page with config, history and
charts. Best-looking, worst failure mode: the dashboard window must be arranged beside the game and
never on top of it, and covering the game freezes the bot while the dashboard still says "running".

**C. Both.** Panel for run control, dashboard for review. Deferred: A is built first and the server
contract in §12 is written so B can be added without rework.

Chosen because A removes the freeze failure mode entirely and kills the "I don't know how to start
this" step in the same move.

## 8. Bootstrap

Two paths, same entry point (`panel.js`); ship both, document the bookmarklet first.

1. **Bookmarklet** — zero install. An install page at `127.0.0.1:8731/install` presents a
   draggable link. Clicking it on the lofi.town tab injects:
   `javascript:(()=>{const s=document.createElement('script');s.src='http://127.0.0.1:8731/panel.js?'+Date.now();s.onerror=()=>alert('AutoFish: start fishserve first');document.documentElement.appendChild(s)})()`
   Fallback if the script element is refused: `fetch(...).then(r=>r.text()).then(t=>eval(t))`.
   Both are viable because the page sets no CSP (verified); pick whichever passes live.
2. **Userscript** (Tampermonkey/Violentmonkey) — install once, auto-injects on every load of
   `app.lofi.town`. Served as `/autofish.user.js`. Optional, for the user who wants it permanent.

Requirement: `node fishserve.js` must be running. The bookmarklet's `onerror` says so.

## 9. Panel — placement, and never eating a press

- Host element: `div#autofish-panel` on `document.body`, `position: fixed`,
  `z-index: 2147483647`, **shadow root** so page CSS cannot leak in or out.
- **Live exclusion rect.** The panel asks `__fish.zones()` for the union of the bubble rect, the
  dial rect (`F.hint` / `F.geo`) and the catch-card rect, recomputed every 250 ms and on resize.
  That is the only geometry the panel trusts.
- **Placement rule.** The panel may sit anywhere whose rect does not intersect the exclusion rect
  (inflated by 12 px). Default anchor: bottom-left, above the exclusion rect's bottom edge. On
  collision — window resize, or the game moving — the panel clamps along the nearest free edge; if
  no free edge exists it **collapses to the pill** and says why. It never sits over a press point.
- **Hard belt on the core.** `tap()` gains one check: if `document.elementFromPoint(x,y)` resolves
  inside `#autofish-panel`, retarget the event at the UI canvas instead. Even a bug in placement
  cannot then swallow a press.
- Draggable by its header; position and collapsed state persist in `localStorage`.
- Collapsed state: a 48×48 pill showing state colour + catches this session. Click to expand.
- **Pointer isolation:** the panel host stops `pointerdown|pointerup|click|mousedown|mouseup|
  touchstart` from reaching the game's document-level handlers, so a human click on the panel can
  never move the character.
- No text inputs (durations are buttons) so a focused control can never swallow Space, which the
  core uses to press the dial.
- Re-attach watchdog: if the page's framework removes the host, re-append it (1 s check).

## 10. Panel — contents

**Header:** "AutoFish" · state chip (Idle / Waiting / Running / Paused / Cooldown) · collapse.

**Session**
- Duration: `−` `[60 min]` `+` stepper in 5-minute steps, press-and-hold to accelerate, range
  5–240 (remembered). Preset chips `30` `60` `90` snap in one tap.
- Cooldown and daily cap are set the same way: defaults 30 min and 240 min, ranges 5–120 and 30–480.
- Clock window toggle, then two ±15-minute steppers for start and stop (no text fields).
- One button, always: **Start** → **Stop**. The clock window is what makes Start mean "arm now,
  begin at the window"; there is no second stop button, because every stop cools down.

**Live** (1 Hz from `__fish.status()`): elapsed fishing time, dials, presses, catches, last catch
(`Star Fish · 1.4 kg`).

**Safety line:** visible-tab ✓/✗, errors, "N min left this session", "daily X/240 min".

## 11. State machine and guards

States: `idle → waiting → running ⇄ paused → cooldown → idle`

- `waiting`: armed for a clock window. Only reachable with the window switched on.
- `paused`: a guard tripped. **Not a stop** — no cooldown, and time spent paused or waiting does
  not count toward the session length or the daily cap. Only real fishing time counts.
- Pausing lets any in-flight dial expire on its own (losing one fish is the correct cost) and leaves
  a catch card on screen untouched until the loop resumes.

| Guard | Trigger | Action |
|---|---|---|
| G1 hidden | `visibilityState !== 'visible'` > 5 s while running | pause, banner "game not visible"; auto-resume 3 s after visible |
| G1b hidden too long | hidden > 120 s | stop, reason `hidden` |
| G2 no catch | running, 0 catches in 10 min of fishing time | unattended: pause 60 s, retry, up to 3 times, then stop `no-catch`; attended: pause and wait |
| G3 error burst | > 20 errors in 60 s | stop, reason `errors` |
| G4 duration | session fishing time reached | stop, reason `duration` |
| G4b window end | clock stop time reached (wins over G4) | stop, reason `window` |
| G5 daily cap | 240 min of fishing today | refuse Start, banner with the reset time (local midnight) |
| G6 cooldown | 30 min after a **stop** (never after a pause) | Start disabled with a countdown |
| G7 reload | page reload while a session was live | write a counted `reload` row; resume only if the session was armed for a clock window, the window still contains now, and resume-after-reload is on — otherwise stay `idle` |

**Session ownership.** The core's own `maxMinutes` stop (default 240) must not fight the panel: the
panel sets `maxMinutes` to the session length + 2 min so the core can never fire first, and treats
any core stop it did not ask for as reason `core-max`. One owner, one clock.

## 12. Architecture

```
bookmarklet / userscript
      │  loads
      ▼
panel.js ──ensures──► autofish.js (window.__fish, unchanged behaviour)
   │      1 Hz status + onCatch hook + zones()
   │      POST /session, GET /sessions?day=, GET /recent
   ▼
fishserve.js (127.0.0.1:8731) ──► catches.csv, sessions.csv
```

`panel.js` owns the session controller. `autofish.js` owns the game loop. The server owns the
record. No part reaches into another's job.

### History is the server's

The 240-minute daily cap, the 30-minute cooldown and the reload banner all read **`sessions.csv`
through `GET /sessions?day=YYYY-MM-DD`**, not `localStorage`: storage survives a cleared profile
only by accident, and a session that ended by reload must still count. `localStorage` holds only
the live session heartbeat (what the reload banner reads next time).

A reload during a live session writes a partial row with reason `reload` and **counts** toward the
cap — an interrupted run still spent exposure.

### `autofish.js` additions (backward compatible)
- `F.paused` flag; `step()` returns immediately when set (keeps the rAF loop alive).
- `F.pause()`, `F.resume()`, `F.resetStats()`.
- `F.onCatch = fn(record)` — called from `recordCatch` after a successful parse.
- `F.zones()` — `{bubble, dial, card}` rects from the live hint/geo, for placement.
- `tap()` retargets to the canvas if `elementFromPoint` lands inside the panel (§9).

### `fishserve.js` additions
- `GET /panel.js` — the HUD module (`no-store`, CORS open, like `/autofish.js`).
- `GET /install` — HTML page with the draggable bookmarklet and the server-start reminder.
- `GET /autofish.user.js` — userscript wrapper.
- `POST /session` — appends `time, started_at, minutes, catches, reason` to `sessions.csv`.
- `GET /sessions?day=` — that day's rows, summed for the cap and the cooldown.
- `GET /recent?n=5` — last catches as JSON, for the panel footer.

### Unattended sessions

The user chose to let sessions run while they are away, which promotes three nice-to-haves to
requirements:

- **Display wake lock.** While `running` or `waiting` the panel holds
  `navigator.wakeLock.request('screen')` and re-acquires it on `visibilitychange`. Released on stop.
  Without it the OS blanks the screen, the game freezes, and G1b kills the session after 2 minutes.
- **Guards recover instead of waiting.** G2 retries by itself (§11). Anything that needs a human
  judgement stops the session rather than leaving it paused forever.
- **Reload survival.** The userscript re-injects on load; the panel then shows one banner — "session
  interrupted by reload, resumed" — only under G7's conditions, and the reload row still counts.

The install page carries the checklist: start `fishserve`, open the town, arm the session, keep the
window visible, and (recommended) turn off automatic suspend for the evening.

### Session controller as a pure function
`session.js` exports `reduce(state, now, facts) → {state, actions[]}` with no DOM. `panel.js` only
renders and dispatches. This makes the guards testable with `node --test` and no browser.

## 13. Files

| File | Change |
|---|---|
| `session.js` | new — pure state machine |
| `panel.js` | new — shadow-DOM HUD, timers, guards wiring |
| `autofish.js` | additions per §12, behaviour unchanged |
| `fishserve.js` | new routes per §12 |
| `tests/session.test.js` | new — guard and transition tests |
| `AUTOFISH.md` | rewritten run section: install page, panel, guards |
| `docs/STATE.md` | filled from real session state at each milestone |

## 14. Verification

- `node --test tests/session.test.js` — every transition and guard, including hidden, reload, and
  the pause-does-not-cool-down rule.
- A placement test: force each of the two measured canvas sizes and assert the panel rect never
  intersects the bubble, dial or card rect.
- Live unattended: arm a 5-minute clock window, walk away, confirm the screen stays awake, a catch
  lands, and the session stops at the window end.
- Live reload: reload mid-session with resume-after-reload on, confirm the banner and that the row
  was written; reload with it off, confirm the panel stays idle.
- Live, in order: (1) bookmarklet injects and the pill appears; (2) Start runs 3 minutes and logs at
  least one catch; (3) Stop ends it and Start is disabled for the cooldown; (4) covering the window
  pauses within 5 s and resumes on reveal; (5) a 3-minute session writes one `sessions.csv` row;
  (6) reloading mid-session leaves a `reload` row and Start still refuses for the cooldown.

## 15. Phases

1. **Panel shell** — shadow DOM, pill, expand, Start/Stop, live counters, placement rule, no timer.
2. **Sessions** — duration, clock window, guards G1–G7, `sessions.csv`, `GET /sessions`.
3. **Install + polish** — install page, userscript, position memory, docs, `AUTOFISH.md` rewrite.

Each phase is independently usable and verifiable live.

## 16. Left to the builder

- Exact HUD styling and spacing.
- How the pill draws the state colour (border, dot, or background).
- Whether `sessions.csv` or JSONL is nicer to read later.
- Re-attach strategy if the Next.js app re-renders aggressively.

## 17. Risks

- **Ban risk is the user's, and it is real.** Automation is almost certainly against lofi.town's
  rules. This design does not attempt to evade detection; it caps exposure (bounded sessions,
  cooldown, daily cap) and makes each run intentional. Nothing here makes it safe in the sense of
  permitted.
- The panel is DOM; if the game ever starts reading DOM it would notice. Nothing suggests it does.
- Screen wake lock can be refused (battery saver, some Linux sessions). The panel must say so
  plainly instead of promising an unattended run it cannot deliver.
- Chrome may throttle `setInterval` in a background tab; the guards read `visibilityState` first, so
  a throttled tick can only delay a stop, never cause a press, because rAF stops too.
