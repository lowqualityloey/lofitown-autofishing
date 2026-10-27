# AutoFish panel — live verification, 2026-10-27

Environment: BrowserOS neo tab `https://app.lofi.town/` (Windows-side browser, WSL2 host server),
viewport 1620x1031, fresh account (0 catches, "Catch a fish 0/1" quest open). Server:
`FISHSERVE_PORT=8741 node fishserve.js` in WSL, reached from the page as `http://127.0.0.1:8741`.
Unit tests at the time of writing: `node --test` → 30 pass, 0 fail.

## Observed

| Check | Result |
|---|---|
| `panel.js` injects from a plain script tag (the bookmarklet path) | pass — `window.__panel.mounted === true`, `mountError === null` |
| Dependencies load from the origin that served `panel.js` | pass — `autofish 3.0`, `AutoFishSession`, `AutoFishLayout` all present after injection on port 8741 |
| Shadow-DOM host is created and visible in-game | pass — `div#autofish-panel`, 266x280, screenshot shows the card inside the game |
| Panel never covers the play area | pass — exclusion union (bubble + dial + card + hint zone) computed live from `__fish.zones()`; `AutoFishLayout.intersects(hostRect, exclusion) === false` in repeated placements |
| Placement adapts instead of using hardcoded coordinates | pass — with the hint zone at (771,282) the panel moved to the top-left inset corner; earlier, with a different zone, it sat at top-right |
| Real mouse click on Start reaches the panel through the closed shadow root | pass — a synthetic-free click at (309,260) (`elementFromPoint` → `autofish-panel`) set phase `running`, `__fish.running === true`, `stats.frames` climbed, HUD showed RUNNING + Stop + "59 min left" |
| Real mouse click on Stop ends the session | pass — phase `cooldown`, `__fish.running === false`, `stopReason "user"`, `fishingMs 227093`, `cooldownUntil` set 30 min ahead |
| The game never sees panel clicks | pass — no game reaction to the two clicks; `stats` unchanged |
| Counters advance while running | pass — "today" meter went 0 → 3 min / 4 h 00 |
| State is observable from outside the closed shadow root | pass — `host.dataset.phase` / `host.dataset.catches` mirror the reducer state |
| A stopped session writes a server row | pass — `GET /sessions?day=2026-10-27` returned `{time:"2026-10-27T04:18:14.743Z", started_at:"2026-10-27T04:14:28.436Z", minutes:4, catches:0, reason:"user"}` for the 3 min 47 s run the panel ended |

## Not observed (unit-tested only, or not reachable in this browser)

| Check | Why |
|---|---|
| Guards G1-G7 live (hidden pause/stop, no-catch retry, error burst, duration, window end, daily cap, cooldown refusal) | each has a reducer test in `tests/session.test.js`; the live trigger for most needs minutes of waiting and a real catch |
| Actual fishing at the user's window size | this browser is a different account and window; the `REEL!` prompt rendered at (810,88), outside the core's fixed scan box (see below) |
| Wake lock grant, banner on refusal | requires a visible unattended run; here the page was frontmost the whole time |
| Reload resume, `reload` session row | would have interrupted the run under test; the row logic is unit-tested |
| Pill collapse | needs a viewport where no candidate rect fits, or a deliberate resize; window resize is blocked from the agent side (`Browser.getWindowForTarget` → `target_scope_unsupported`) |
| Drag position persistence | drag needs a pointer sequence over a closed shadow root; not exercised live |

## The finding that matters: bubble scan box vs. the real prompt

`autofish.js:111` scans the fixed rect `{x:690, y:215, w:360, h:210}`, and `autofish.js:150` scans
`{x:620, y:315, w:365, h:405}`. In this window the live `REEL!` prompt was drawn at (810,88) —
inside the width, 127 px above the box — and `__fish.findBubble()` returned `null` the whole time it
was on screen. A manual click at that spot did cast the rod, so the account and the game were fine;
only the detector's window was wrong. The prompt is anchored above the player in world space, so it
moves with the camera, not just with the viewport.

This was **not repaired** here: the fixed boxes are the configuration the user's account has 85
logged catches with, and silently widening them risks tapping unrelated white UI. A player-relative
or user-calibrated bubble box is the right follow-up, with the user in the loop.

## Fixed during this verification

1. `build()` assigned a fresh `ui` object after the steppers had already stored elements into it, so
   `render()` threw `Cannot read properties of null (reading 'val')` and the panel died silently
   (host in the DOM, `mounted` false). Now `ui` is reset first and filled with `Object.assign`.
2. `.wrap{position:fixed}` made the card ignore the host's `left/top`, so the host measured 0x0 and
   placement and dragging were meaningless. Now `position:relative`.
3. `F.zones()` threw `Cannot read properties of undefined (reading 'x')` when no bubble or dial had
   existed yet; the hint-zone branch now checks both.
4. `panel.js` mounted silently when the mount threw; `mount()` now records `window.__panel.mountError`
   and removes the broken host.
5. Default corner was top-right, on top of the game's coin/upgrade controls. Corners now start
   top-left and below a 72 px top inset, so the panel clears the game's HUD strip.

## Follow-up round: the user's first real trial (same day)

The user reported, from their own window (game viewport about 1022x810): *"after pressing start it
doesn't start casting/catching fish or reeling"* and *"if i try to move the autofish window with the
mouse pointer it permanently sticks on it ... it just follows the mouse pointer"*. The screenshot
showed `CAST!` at about (510, 511) page coordinates, far outside the fixed scan boxes, which
confirmed the finding above was the whole story for bug 1.

**Drag never ended** (`panel.js`): the host swallows bubbled `pointerup` with `stopPropagation` (it
must, so the game never sees panel clicks), and `pointermove` was not in that list — so with pointer
capture set, the panel followed every move while the window-level `endDrag` listener never fired.
`dragging` stayed non-null forever and `place()` opens with `if (!host || dragging) return;`, so the
panel was never placed again. The drag listeners are now on `window` in the **capture** phase
(`pointermove`, `pointerup`, `pointercancel`, `blur`), and the stepper repeat also stops on a
capture-phase release anywhere. Verified live with real CDP mouse events: the panel followed the
pointer to (332, 294), stayed there after release, and ignored a later pointer move.

**Blind detection** (`autofish.js`): the fixed boxes remain the first attempt, then the core scans
the whole UI layer at quarter scale for connected components that look like a prompt — a white
capsule 45-190 x 24-110 with 45% white fill and 2-50% dark ink — and, for the catch card, a cream
panel 200-620 x 220-700. Verified against the real thing at a 1234x1023 viewport by Marlin's Fish
Shack: the live `REEL!` measured 108x44 at (618, 270) and was found by both the box pass and the
anywhere pass. A 24-second run then produced 5 bubbles, 10 dials locked, 9 dials closed, 5 presses
and **one caught Salmon (11.2 kg)**.

Two smaller fixes from the same round:

6. `readUI()` threw `Cannot read properties of undefined (reading 'width')` while the SPA had no
   canvases (route change / soft reload). Every frame counted as an error, so the panel saw an error
   burst and stopped the session as `errors`. It now reports "nothing drawn" instead.
7. `reduce()` used `Number(fact.at) || 0`, so a fact without a clock started a session at the epoch;
   the next tick credited `now - 0` ms of fishing time and the session died as a `daily-cap` hit. It
   now falls back to `Date.now()`. (Found by hand: a test dispatch without `at` wrote a
   `29,884,614 min` session row, which was removed from `sessions.csv`.)

Also added: `POST /diag` plus `__fish.captureUI()`. A run that finds nothing for 20 seconds uploads
one PNG of the UI layer and its counters to `shots/diag/`, so the next blind report can be fixed
from the pixels the bot actually saw.

## Rare catch cards (epic and up) froze the bot

After the fixes above the user fished for real and caught a **Whale Shark (Epic)** — and the bot
stopped dead in front of the card. Cause: a rare catch tints the card frame by rarity (pink for
epic) and adds a large creature image, so the cream-fill test that finds common cards scored the
Whale Shark card too low. `findCatch()` returned `null`, the card was never tapped away, and since a
card blocks the next cast the loop sat there for minutes with the session still `running`.

Fixed by adding a shape pass: every card, whatever its rarity colours, is one large fully opaque
panel drawn on a dimmed screen, so `findCatch()` now also accepts the biggest opaque card-sized blob
(180-760 x 250-820, fill >= 0.55) and taps its measured centre. Order is box -> cream -> shape, so
common cards behave exactly as before. Verified live: `card by shape` fired on real cards at
300-340 x 376-416 while the session kept fishing (2 catches, 19 dials closed in ~30 s), and the text
parser already handles the epic layout (`Whale Shark | Epic | 26.6t | Impressive | $247`), so those
catches are recorded and not just dismissed.

Known limit: the shape rule cannot tell a catch card from another large opaque game panel (a menu).
Both are tapped, which is what the bot already did to cream cards.
