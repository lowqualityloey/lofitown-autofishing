# AUTOFISH — lofi.town fishing bot

Status: **WORKING - presses land, fish are caught, and catch cards are auto-dismissed so it fishes continuously.**
"2026-10-27 findings" before trusting it for real fishing.

Note: **coins are not a valid success signal** — the counter does not move without the Cozy
subscription, so it stays at 5,484 whether or not anything is caught. Judge a press by whether the
dial ends early (see below), never by the coin total.

Run with BrowserOS neo on the lofi.town tab, with the neo window genuinely uncovered
(a covered window reports `hidden` and freezes the game).

## Install once, run forever (userscript - panel included, no server, no console)

The easiest path by a wide margin: **one file, and the whole HUD is inside it**. The panel, the
session rules (length / cooldown / daily cap / clock window), the catch list and the fishing core are
all inlined in `dist/autofish.user.js`; no local server, no bookmarklet, no console.

```bash
node build-userscript.js      # writes dist/autofish.user.js (committed; rerun after editing
                              # autofish.js, session.js, layout.js or panel.js)
npm run build:userscript      # same thing
```

1. Install Tampermonkey (or Violentmonkey) in the browser that plays lofi.town.
2. Tampermonkey -> Dashboard -> Utilities -> **Import from file** -> `dist/autofish.user.js`.
   (Or, while `fishserve` is running, open `http://127.0.0.1:8731/autofish.user.js` and press Install.)
3. Open https://app.lofi.town. The **AutoFish panel** appears top-left, marked `IDLE`.
4. Press **Start** in the panel. Stop / Pause / Resume and the session rules all work offline.
   Drag it by the header; the `–` in the header collapses it to a 48 px 🎣 pill, and clicking the
   pill brings it back.

Why the first load is OFF on purpose: an install must never start pressing keys in a tab you just
opened. The remembered choice lives in `localStorage` (`autofish:on`, `autofish.prefs`,
`autofish.live`), so a reload restores what you left.

The chip is only a **fallback**: the bootstrap checks for a mounted panel at 0.8 s, 2 s and 4 s and
only then draws `🐟 AutoFish · off · 0 caught` bottom-left (that path auto-starts if the remembered
state is on). With the panel mounting normally, no chip is created.

### What still wants the server (all optional, all degrade)

`fishserve` is now an extras server, not a requirement:

| Feature | Without fishserve |
| --- | --- |
| `/catch` CSV catch log | the POST fails silently, fishing is unaffected |
| `/sessions` history + "left N min today" | `loadToday()` catches and starts from 0 min |
| session row written after a run | banner `session log offline — the session still works` |
| `/diag` screenshot capture | `diagnosis upload failed (fishserve offline?)` |

Verified live (2026-10-28, app.lofi.town, **port 8731 confirmed dead** - `curl` refused, nothing
listening): `__panel.mounted === true`, no chip in the DOM, Start moved the panel to `RUNNING` and
the core fished (6 presses, 1 catch in 12.8 s), Stop returned `phase 'cooldown'`, `stopReason
'user'`, `__fish.running === false`, and the panel showed the expected offline banner. The panel's
shadow root is `mode: 'closed'`, so verify through `window.__panel.state()`, not the DOM.
`node --test` = 64 pass / 0 fail (the build is also checked against a fresh `build()` so a stale
committed `dist/` fails the suite).

## Run (the server path - optional extras)

Only needed for the CSV catch log, the `/sessions` history and `/diag` captures, or for loading the
bot from a bookmarklet instead of Tampermonkey. One command:

```bash
./run.sh
```

It picks the first free port at or above 8731, starts `fishserve.js`, waits until it actually
serves `/autofish.js` (not just "process started"), then prints the two things you need: the
`http://127.0.0.1:<port>/install` URL and the ready-made `javascript:` bookmarklet for copy-paste.
Keep that terminal open while fishing; Ctrl-C stops the server, and the panel in the game tab dies
with it - click the bookmarklet again after the next `./run.sh`.

Two operational traps that cost a whole evening:

- **A second server on the same port serves a stale build.** If an old `node fishserve.js` is still
  alive on 8731 (Windows side or a forgotten WSL job), the browser reaches *that* one and keeps
  loading old code no matter how often the bookmarklet is reinstalled. Check with
  `curl -s localhost:8731/autofish.js | wc -c` and compare against `wc -c autofish.js`.
- **Nothing warns you that the server died.** The panel is just a DOM script that stops being able to
  reach anything; the game keeps running and clicks do nothing.

## Run from the console (no server)

```js
// paste autofish.js into the page once, then:
__fish.start()                        // run, pressing the dial with Space
__fish.start({ press: false })        // observe only, never press
__fish.start({ pressWith: 'pointer' })// press the dial with a click instead of Space
__fish.status()                       // counters + last events
__fish.report()                       // counters + last 250 events
__fish.stop()                         // hard kill (also stop before reloading the page)
__fish.calibrate()                    // colour dump while a dial is on screen
```

## Run with the panel (no console pasting)

```bash
FISHSERVE_PORT=8741 node fishserve.js      # any free port; 8731 may already be taken on Windows
```

Then open **http://127.0.0.1:8741/install** in the lofi.town tab and drag the button to the
bookmarks bar. On the game page, click the bookmark once: a small **AutoFish** card appears in the
corner of the game and runs from there.

- **Session / Cooldown / Daily cap** — set with `−` / `+` steppers (hold to accelerate). Defaults
  60 min, 30 min, 4 h. Ranges: session 5 min – **12 h**, cooldown **1 min** – 2 h, daily cap 30 min –
  **24 h**. A session stops when its timer runs out: the cooldown then runs and the panel goes **idle** —
  it does not chain sessions on its own, so one night needs one long session. The cap only refuses a
  Start once the day's total is spent.
- **Clock window** — optional "only fish between HH:MM and HH:MM"; times move in 15-minute steps and
  the stop time wins over the duration.
- **Start / Stop** — one button. Every Stop starts the cooldown; a pause does not.
- **Meters** — time left, catches this session, presses this session, and today's total against the
  daily cap.
- **Loop stall** — when the game stops handing the bot frames (an occluded or throttled tab), the
  loop can die while the panel still says RUNNING. The panel now says **stalled** in red instead and
  stops the session clock; the bot re-arms itself as soon as frames come back.
- **Cozier popup** — **off** by default. Set it **on** to hide the *Fish while you focus with Cozier*
  upsell (and the full-screen scrim that comes with it) while a focus session is running. **Cosmetic
  only — see below.**

**Focus sessions and the Cozier popup (measured 2026-10-28, free account).** Joining a public focus
session — *Open focus menu > Together > Browse > Public Session > Join* — works on a free account, but
the game then mounts a full-screen *Fish while you focus with Cozier* modal. It is not dismissible in
any useful sense: **Not now** and the **X** both take it away for about 250 ms and it is back within a
second, and its scrim sits above both canvases, so every click aimed at the water lands on the scrim
instead. The panel's **Cozier popup** toggle hides exactly that overlay — it tags a root only while the
upsell's own `#focus-fishing-upgrade-description` paragraph is visible and untags it as soon as it is
gone, so another modal reusing the same root is never blanked — and it touches nothing else: no network
call, no `localStorage` removal, no account or subscription state.

**It does not bring fishing back.** The Cozier gate is in the game, not in the popup: 25+ minutes in a
session with the modal hidden gave **0 dials** from the bot *and* from six hand-made inputs (three
pointer clicks at the cast prompt, three Space presses), while the same bot on the same page fished
normally outside a session. So the toggle is for a clear view and working clicks while the session
clock runs — a free account still cannot focus-fish. The bot's own `no-catch` watchdog notices this
and pauses rather than burning the session.

**The panel says so up front.** A running focus session puts `FOCUS` in the page title
(`12:34 FOCUS | lofi.town`), the only part of the session state a page script can read, and the panel
checks it every tick: while it is there, a blue *focus session active — focus fishing needs Cozier,
casts are refused* line takes the banner, ahead of the log-offline chatter. It is also observable from
outside the shadow root (`window.__panel.focus()`, and `data-focus="1"` on the host). The panel does
**not** refuse to start, because a Cozier subscriber fishes in sessions normally and the panel cannot
read the account type; what it removes is the mystery, so a gated run is a decision instead of a
25-minute wait for the dial that never comes.

**Leaving it fishing unattended.** The limits are sized for it (12 h session, 24 h cap), but the tab is
the machine: the game draws on requestAnimationFrame and the fishing timer is a page timer, so a
backgrounded or minimised tab freezes both, and the panel stops the session when it sees the page
hidden. The panel asks for a screen wake lock while a session is running, which keeps the display on
when the page is visible and focused; a locked screen or a sleeping machine still ends the run. So an
overnight run means the window stays open and visible, the display stays awake, and the OS is told not
to sleep. Two known ways a long run can quietly stop: the after-catch cast stall (no cast prompt is
pressed for a minute or more while the loop still ticks) and a missed reels left waiting for a bite.

The panel never draws over the play area: it asks the core for the live bubble/dial/card rectangles
(`__fish.zones()`) and slides to a free corner every 250 ms, collapsing to a pill if there is no
room. It also keeps the screen awake while it is fishing (the game freezes when the tab is hidden),
writes a `reload` row and can resume a clock-window session after an accidental page reload, and
uploads one row per session to `sessions.csv` via `POST /session`.

The console API above keeps working and is unchanged; the panel is a front end for it. Guards the
core enforces on its own: hidden-tab pause/stop (G1), no catch for 10 min → one 60 s retry, three
times, then stop (G2), 20 errors in a minute → stop (G3), session duration (G4), clock window (G5),
daily cap (G6), cooldown between sessions (G7).

Run the tests with `node --test` (bare — `node --test tests/` fails on Node v24.22.1).

## Finding the prompt at any window size

The first version only looked inside two rectangles measured at a 1522x954 window, so at any other
size (the user's window is about 1234x975) it never saw **CAST! / REEL!** and pressed nothing. Those
boxes are still tried first; then the core scans the whole UI layer at quarter scale for a white
capsule with dark text (about 108x48) and, for the catch card, the largest solid opaque rectangle
(a solid seed the size of the smallest card, grown while it stays solid, so artwork spilling out of
the frame cannot hide the card). Verified live at 1234x1023 by Marlin's Fish Shack: 5 bubbles, 10
dials, 9 dials closed, 5 presses and a Salmon in 24 seconds.

Event cards (green frame, ribbon, an illustration that spills well past the card) broke the earlier
"largest connected opaque blob" version on 2026-10-27: the blob measured 700x576 at 46% fill, was
rejected, and the bot sat in front of a card it could not see. See
`docs/reviews/2026-10-27-event-card-freeze.md`.

`__fish.findBubble()` / `__fish.findCatch()` report what is on screen right now;
`__fish.captureUI()` grabs one PNG of the UI layer for diagnosis. The panel does that once by
itself, 20 seconds into a run that has found nothing, and uploads the frame with its counters to
`POST /diag` — the file lands as `shots/diag/ui-<time>.png` next to a `.json` of the counters, so a
blind run can be debugged from real pixels instead of guesses.

## Where it stands

| Piece | State |
|---|---|
| Finding the CAST!/REEL! bubble | **works** — pixel detection on the UI layer; presses make the bubble vanish |
| Locking the dial | **works** - centre (813, 407), radius ~91, ring score 20/20 |
| Tracking the dial for its whole life | **works** — held 15.7s until the timer expired, no false losses |
| Reading the wedge | **works** - contiguous arc at 0.69R, 45-65 deg wide, pin blanked as a wildcard |
| Pressing at the right moment | **implemented, unverified** - fires when the arc midpoint is predicted onto the pin, abs(pred) <= 6 deg |
| Catching a fish | **unconfirmed** - the coin counter cannot confirm one without Cozy, so judge by dial lifetime |

The single press that fired (margin 10°) was followed by the dial closing 52ms later, but that
dial closed at **15.7s**, which is exactly the natural lifetime every other dial showed. Coins did
not move. So that close was the timer, not a hit.

**Space is unproven.** It has neither been shown to register nor shown to be ignored. The plan said
to stop and report if Space was rejected rather than silently switching to clicks; this is that
report, with the ambiguity stated rather than papered over.

## 2026-10-27 findings (verified against the live game)

### The readback bug — root cause, finally

Both layers are **WebGL** with `preserveDrawingBuffer: false`, so reading either canvas at an
arbitrary moment returns stale or blank pixels. Every earlier "valid sample" count was measured
against garbage, which is why a phantom dial with alpha-0 holes passed as real.

The fix that works: patch the renderer base prototype's `render()` and copy the overlay canvas into
a 2D canvas **immediately after each render**, then read that copy any time.

```js
let proto = Object.getPrototypeOf(window.__PIXI_DEVTOOLS__.app.renderer);
while (proto && !Object.prototype.hasOwnProperty.call(proto, 'render')) proto = Object.getPrototypeOf(proto);
// inside: after prev.apply(this, a) ->
//   if (this.canvas === overlayCanvasEl()) { capCtx.drawImage(this.canvas, 0, 0) }
```

Anchor the overlay by **DOM** (`canvas.parentElement.className` contains `pointer-events-none`),
never by object identity. Identity silently breaks when the canvas is resized or recreated, and the
capture then holds the *world* layer: bubbles and dials vanish from the detector while the screen
plainly shows them. That single mistake cost most of a session.

### Measured geometry at 1620x1031 (dpr 1)

| Thing | Value |
|---|---|
| REEL!/CAST! bubble | 108x50, centred (810, 358) |
| Dial centre | (813, 407), outer radius ~91 |
| Pin (orange) | rgb 229,118,83, at **0 deg = 12 o'clock** (confirmed by angular scan) |
| Disc base | rgb 142,138,111 |
| Wedge | rgb 182,188,132, 45-65 deg wide |
| Wedge rotation | ~125-140 deg/s, counter-clockwise |

Classify by nearest reference colour `|rgb - wedge|` vs `|rgb - base|` — not by luminance, which
cannot separate them reliably.

Sampling radius matters: at r=63 the **pin occludes the wedge** (it covers about +/-5 deg) and cuts
the measured arc exactly when it should count as covering. Treat non-base, non-wedge pixels as
wildcards so the pin does not split the run. At r=45 the readings are noisy and contradict r=63;
prefer r=63 with wildcards.

### Input — settled

Synthetic `pointerdown`/`pointerup` at the dial centre **is received by the game**. Proof: one dial
resolved at **4.64s** instead of the natural **15.97s** timeout.

A dial also **accepts repeated presses**: a miss leaves it running to the 15.9s timeout, so you can
try again. Therefore "dial ended early" is the signal that a press was a *hit*; a full 15.9s dial
means every press missed (or no press reached it).

### The hit rule (implemented 2026-10-27)

The pin paints over the wedge at 12 oclock, exactly where the wedge has to be read, so pin pixels
are **unknown**, not disc base: read as base they split the arc in two at the crossing and the press
never fired. Sampling is tri-state - GRN = wedge, PIN (rgb 229,118,83, within +-10 deg of 0) =
wildcard, anything else = base - and wildcard-only **edges** are trimmed afterwards so the pin cannot
inflate the measured width.

*(The trigger below is v1, superseded by Timing v2 further down; the measurement notes stand.)*

The trigger keys on the arc **midpoint**, not on the pin being anywhere inside the arc:

    delta = 0 - mid                      signed distance from midpoint to pin
    pred  = delta + omega * leadMs/1000  where it will be when the event lands
    press when abs(pred) <= midDeg (6)   once per rotation; re-arms past 30 deg

At 125-140 deg/s, 25ms of lead is ~3.2 deg, so the press arrives with the green centred on the pin.
Sample radius moved to 0.69R (63px at R of ~91): the old 0.62R read the arc short and noisy.

Verify by **dial lifetime only**: a registered press ends the dial early (the one confirmed case was
4.64s against the natural 15.97s). A ~15.9s dial means the press missed or never arrived. The PRESS
log entries carry delta, pred, mid, width and omega so each attempt is auditable.

### Timing v2 - measured rotation, timer dispatch, containment (implemented 2026-10-27)

The v1 rule above fires only when `abs(pred) <= 6`. At 746 deg/s the pin travels 18.6 deg in the
25ms the event takes to land, and the 60fps loop can only *start* a press on a frame boundary, so
one frame of omega error or one late frame loses the crossing. Three changes replace it:

1. **omega is fitted, not differenced.** `fitOmega` takes the last <=12 *distinct* frames
   (`F.sample` pushes only when t moved >=4ms or mid moved >=0.2 deg, so re-rendered identical
   frames cannot fake a 0 rate), unwraps the mids, least-squares the slope over <=200ms, drops a
   single outlier frame, and clamps to +-1500 deg/s. No deadband: a 0 deg/s fit is a real answer.
2. **the press is dispatched by a timer.** `planPress` computes the crossing `toJudge`, then
   `dispatchAt = t + toJudge - (leadMs + biasMs)`; when that is within the horizon (40ms) it arms a
   `setTimeout`. The loop re-plans and cancels/re-arms **every frame**, so a plan is never older
   than one frame plus the horizon, and a reversal or a bad fit cannot leave a stale timer alive.
3. **the acceptance window is the arc, not the midpoint.** `trigger: 'contain'` (default) presses
   when the pin is inside the *measured* arc shrunk by `marginDeg`: `win = max(midDeg, width/2 -
   margin)`. `trigger: 'angle'` keeps the old midpoint +-midDeg behaviour.

    delta = 0 - mid                              signed offset of the midpoint from the pin
    pred  = delta + omega * leadMs/1000          offset at the moment the event lands
    toJudge = (-delta/omega) mod rotation period time until the midpoint reaches the pin
    press  = pin inside the arc at judgement     (contain)  |  abs(pred) <= midDeg  (angle)

Defaults: `pressWith:'pointer'` (proven path), `trigger:'contain'`, `midDeg:6`, `marginDeg:4`,
`leadMs:25`, `biasMs:0`, `schedHorizonMs:40`, `replanMs:8`, `pressGapMs:120`. `F.timing` exposes
the three helpers; `tests/timing.test.js` pins them (46 tests pass, `node --test`).

**Telemetry, so the next question is answerable with data.** Every press logs `how` (timer|frame),
`via`, `delta`, `pred`, `omega`, `fitRms`, `biasMs`, `late`. When the dial ends, `closeDial` scores
it: a press within `hitMs` (1.5s) of the end is a **hit**, otherwise a **miss**; no press at all is
**no-press**. Verdicts accumulate in `stats.hits/misses/noPress`, the last 400 in `F.outcomes`, and
`__fish.sweepReport()` groups them per `biasMs`. `opts.sweep = {min:-60,max:60,step:15}` cycles the
bias across presses, so one run measures which lead actually lands.

**What the offline replay can and cannot say.** `shots/diag/replay.js` runs the captured dials
(`dial_frames.json`, 66 dials, 780 frames) through the old frame rule and the new planner, scoring
the true pin offset at press + lead. The captures are only ~1.35s per dial at ~115ms spacing, so
they mostly exercise the late "press now" branch, and the fitted omega on 2-3 points is no better
than the old single-frame delta: **the replay validates the arithmetic, not the hit rate.**

    mode             presses  dials   |err| med  in-arc  inside6deg
    old frame rule      18    18/66       9.5      94%       44%
    new contain         27    25/66      19.7     100%       15%
    new angle           19    18/66      14.7     100%       37%

Containment presses on **more dials** and never lands outside the arc; the wider `|err|` is the
point - it is pressing somewhere inside the target instead of insisting on the midpoint. The three
timer presses that did fire dispatched at the predicted crossing but read ~18-25 deg late at
judgement, because the fitted omega there was 96-370 deg/s while the captured truth was moving
390-595 deg/s (an acceleration inside the 200ms window, on top of 115ms truth interpolation). That
is a sampling limit of the capture, not a bug in `planPress`: at 60fps the same window holds ~12
points.

---

## 2026-10-27 live run - trigger in, input not trustworthy

The mid-crossing trigger was implemented, injected and run for real: **4 dials, 20,295 frames, 0 presses**.

Instrumented sampling of one dial (429 valid frames) shows why:

- min abs(pred) across the whole dial was **19.3 deg** - nothing ever came within 6
- measured wedge width stayed 70-80 deg, so the arc WAS found and stable
- its midpoint **plateaus** for several frames and then **jumps ~125 deg** instead of sweeping
- omega reads 0 on most frames and ~300 deg/s on the jumps, because the loop samples faster than
  the UI layer re-renders and consecutive samples then see the same image

So the arithmetic is sound and the input is not. A 125 deg jump is not rotation: it is the
longest-run search latching onto a different green arc, which means a second green region exists on
or near the r=63 ring. Until the arc is chosen by **motion continuity** (the run closest to the
previous midpoint plus one frame of expected rotation) instead of by length, the crossing angle is
meaningless and no timing rule can fire.

Next, in order:

1. Dump the 72-sample ring as a string for 3 frames while a dial is live, and count the green runs.
   A second static run confirms the latch.
2. Select the run by continuity with geo._mid, not by longest length.
3. Re-measure min abs(pred) in observe mode; only when it reaches a few degrees does enabling
   presses mean anything.


## 2026-10-27 pin gate - geometry is fine, classification is not

The ring is now validated before any angle is trusted: PIN is searched across 0.58-0.88R within
+-9 deg of 12 oclock, and a frame with no orange there is dropped; candidate widths are limited to
30-110 deg (the measured wedge is 45-60).

Observed on one dial: 1,330 tracked frames, **0 pin rejections**, min abs(pred) **23.2 deg**, up to
**4 green runs**, widest candidate **100 deg**.

That is the useful split: the pin gate never rejected, so the sampled circle IS on the dial and the
centre/radius are right. The fault is the classifier - the saturation test marks more than the
light wedge, so the run list contains extra green arcs and the tracked midpoint never crosses the
pin.

Next: replace GRN with **nearest-reference-colour** classification against the measured base
(142,138,111) and wedge (182,188,132), requiring the wedge to win by a clear margin; dump pat from a
live dial to confirm the run count collapses to one (plus the pin).


## 2026-10-27 continuity attempt - still no convergence

Arc selection now collects **every** green run, trims wildcard edges, and picks the run that
continues the tracked midpoint (plus one frame of predicted rotation), rejecting anything further
than 90 deg from where it should be. The sample also returns pat (the 72-sample ring as a string)
and runs, for inspection.

Observed on one dial with presses off: **1,768 tracked frames, 0 jump rejections, min abs(pred) =
24.9 deg.** The ring carried up to **5 green runs** and candidate widths up to **160 deg**, while the
real wedge measures 45-65 deg. So the sampled circle is crossing vegetation or other green art, not
just the disc.

That is the lesson: continuity alone cannot fix this, because it follows whichever green region is
**most** continuous, and static background beats the rotating wedge. The ring must be validated as
the dial before any angle from it is trusted.

Next, in order:

1. Gate the frame on the pin. The pin is fixed at 0 deg and always painted, so if no PIN sample
   appears in the 12 oclock band the ring is not on the dial: drop the frame and re-lock.
2. Dump pat from a live dial (sample now returns it) and count the runs.
3. Only then re-measure min abs(pred), and only after that enable presses.

Blocker seen twice: after a stray bubble click the character ends up **standing at the pier holding
the rod**, not seated at a fishing spot, and then no bubble or dial ever appears. Re-seat before any
further run.


## 2026-10-27 classifier + merge - one arc, slow rotation

GRN is now nearest-reference: base (142,138,111) against wedge (182,188,132), the wedge having to
be within 1100 squared RGB and 1.8x closer than base. Effect on the same ring: runs fell 4 -> 2 and
min abs(pred) 23.2 -> 12.7 deg.

Merging is what finished it: runs separated only by pin wildcards (gap <= 4 samples) are joined,
because the pin paints over the wedge at 12 oclock and was splitting one arc in two. After that the
dial stopped thrashing - one lock, **1,516 valid frames, 0 pin rejections, 4 invalid frames** for a
whole dial. Width bounds widened to 200 deg for the merged case.

Live ring patterns now read as a single sector: 02 + 55 deg of 1 + zeros + 2, width 55-60 deg. A
165-175 deg merged arc was also seen, so either difficulty varies or that frame was mid-animation.

**Rotation is slow, not 130 deg/s.** The midpoint moved 298 -> 73 deg over 200 valid samples, about
**12-23 deg/s**. At that speed the pin sits inside a 55-60 deg arc for roughly 3-5 seconds per
revolution, so the press window is generous and missing it is a classification problem, not a
timing one.

Still open: min abs(delta) on the merged arc (one capture returned nulls for delta/pred/omega while
mid, width and pat were fine, so guard those reads with Number.isFinite and re-check). Blocked when
the character is not fishing: two 25s windows returned 0 dials.


## CATCH CONFIRMED - 2026-10-27

First verified catches. Log from one run of the pointer path:

- 5 presses, every one with abs(pred) <= 5.6 deg (0.1, 1.2, 1.3, 2.9, 5.6)
- after each press the dial ended in **101-2869 ms**, against a natural lifetime of ~15900 ms
- the catch card appeared: **Star Fish, Common, 1.4 kg, Impressive**

The two fixes that actually mattered, in order:

1. **Nearest-reference colour matching** (base 142,138,111 / wedge 182,188,132) instead of the
   saturation test. Saturation passed vegetation and put up to four arcs on the ring.
2. **The whole 12 oclock band is a wildcard.** The pin paints over the wedge, and at the sample
   radius its pixels did not read as PIN, so they classified as base and split the arc into two.
   That put an exact **25 deg floor** on the crossing error - the width of the pin band. Once the
   entire band was marked unknown, min abs(delta) went 25 -> **0** and min abs(pred) 16.9 -> **0.1**.

Merging runs across pin wildcards, the pin-presence gate, continuity selection and the 200 deg width
bound all stay; they are what keep the lock stable (1,516 valid frames on a dial, 0 pin rejections).

Coins remain a dead signal without Cozy (still 5,484). Judge by dial lifetime and the catch card.

Still rough:

- **The catch card is modal.** Nothing casts until it is dismissed, so a run stops after one fish.
  Auto-dismissing it is the next feature.
- Short locks (96-200 ms, ring 0.4-0.65) still occur around dial start/end and inflate the dial
  count; they never press.


## 2026-10-27 catch card auto-dismiss

The catch card is canvas-drawn (no DOM), modal, and blocks the next cast; a tap anywhere on it closes it.

F.findCatch scans one fixed centre rect (620,315,365,405) and counts paper pixels (r>225, g>200,
130<b<238). Measured palette: paper **249,238,208** (~28% of the rect once the fish art and the
rarity frame are excluded), frame pink 208,149,167, tags 207,197,184. A frame with >= **20%** paper
is a card, and step() taps its centre, at most once per 1.5 s. The dial cannot trip it: the dial
covers under 20% and none of its tones match.

Verified in a 90 s run: **5 cards dismissed, 5 casts, 14 dials, 11 presses**, every press within
abs(pred) <= 5.2 deg and dials ending in 82-975 ms. The loop now runs catch -> dismiss -> cast -> reel
-> dial -> press -> catch with no help.

Caveats: the 20% threshold has thin headroom under a very large fish image (one card measured 0.25),
so lower it if cards stop clearing; and rAF stops when the tab is not visible, which freezes the
whole loop.

## 2026-10-27 catch log (species / rarity / weight / value)

The card has no DOM node and no scene text, but every string it shows is drawn through
`CanvasRenderingContext2D.fillText` (Pixi bakes Text nodes that way). Patching `fillText` on
`CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` captures the card verbatim:

```
Blue Lobster | 3.86kg | Fine | $126 | then the date, one digit at a time: 1 0 / 2 7 / 2 6
```

Card order is **species, [rarity], weight, quality, value**. Rarity only appears on non-common
fish, so `F.parseCatch` resolves the slots by position around the weight token and the `$` token
instead of matching a list of tier names; single-character entries are dropped (that is the date)
and `!`/bubble strings are ignored. The parsed row is POSTed to `fishserve.js`, which appends
`time,species,rarity,quality,weight,value` to **catches.csv** and echoes a readable line.

Verified live: rows landed as `2026-10-27T01:26:12Z, Lobster, , Impressive, 3.36kg, $10`. The parser
also resolves synthetic `Sun Fish | Epic | 4.08t | Exquisite | $258` and
`Blue Lobster | Rare | 3.86kg | Pristine | $1,204` correctly. An earlier attempt to log the card
as a PNG was abandoned: the crop is taken during the card's fade-in, so the images come out washed
out and unreadable.

## 2026-10-27 live verified verdicts - what a press is actually worth

> **Withdrawn.** The 600 ms "card = win" rule below scored a piece of reel UI, not a catch: see
> *one fish is many presses* further down. Kept for the record.

Until now the bot scored a press by whether the dial ended within 1.5 s. That is not a hit signal:
the game ends the dial on a win *and* on a timeout-triggered miss, so 60 "hits" and 0 "misses" over
90 dials said nothing. A press is now scored by what follows it: a **catch card within 600 ms = win**,
no card = the fish got away. `__fish.bandReport()` groups those wins/losses by the measured speed of
the dial, because that is the only thing that separates an easy fish from a legendary one.

Live evidence, the same afternoon session, pointer presses at the dial centre:

| run | dials | presses | wins | losses | slow | mid | fast | blur |
|-----|-------|---------|------|--------|------|-----|------|------|
| A | 14 | 13 | 10 | 0 | 3/3 | 5/5 | 2/2 | - |
| B | 15 | 9 | 8 | 0 real | 4/4 | 4/4 | - | - |
| C | 108 | 65 | 63 | 0 | 18/18 | 34/34 | 10/10 | 1/1 |

Run C was a 5.6 minute unattended run on the console-started core (no panel): 108 locked rings, 45 of
them ghost fades, 65 presses and **63 card-confirmed catches with no loss in any band** - including
one blur-band dial above 500 deg/s, the speed legendary fish live at. Two presses never got a verdict
because the run was stopped inside their 600 ms window.

- Card latency after a winning press: **9-16 ms** (`cardMs`). The 600 ms window is generous.
- Measured speeds in these runs were **118-264 deg/s**, i.e. slow and mid only. Nothing above
  500 deg/s (`blur`) has been verified yet, and that is where legendary fish live: at 746 deg/s the
  whole tolerance around the pin is only ~62 ms, so the lead has to be right, not just fast.
- Run B's two "skipped" dials were **not fish at all**. Their traces show `delta` frozen and
  `omega 0` for 300-3600 ms: a locked lock-on that never rotated, i.e. the fade-out of a solved
  dial. They are now counted as `ghost` and are no longer scored as losses.

### Two real defects this exposed

1. **The catch card was invisible while a dial was locked.** The card branch only runs when
   `!F.geo`, so a card that arrived while the next dial had already been locked was never seen:
   the pending press timed out as a loss with no catch recorded (that is why `stats.cards` ran
   5 for 10 wins), and any tap aimed at the dial landed on the paper instead of the dial - a
   misclick the player sees as a lost fish. The loop now scans for the card while a press is
   awaiting its verdict, marks the win when it finds it, and **holds fire on the dial** for the
   2.2 s the card is up. Live: `catch card over dial` fired once in run B.
2. **A press could be scored twice or not at all.** `F.pendingWin` held one record; a second dial
   closing inside the 600 ms window overwrote it. It is still one slot, but the card scan now
   closes the window early instead of leaving it to the timer.

### Diagnosing a lost dial

Every dial keeps the last 48 frames (`t, delta, width, omega, plan reason`) and, for any dial that
did not win, `outcome.trace` plus `outcome.reasons` (how many frames the planner spent in
`wait` / `now-inside` / `disarmed` / `static`). A ghost shows the frozen trace above; a mistimed
press shows a normal rotation with the press near a window edge; a dial the bot never locked shows
up as no record at all.

## 2026-10-27 one fish is many presses - the reel is a level bar, and the counters had to move

The game's own minigame code (Next chunk `_next/static/chunks/3763-052bcc751d1d9507.js`) settles
what the capture never could:

```js
handleMinigameClick = () => {
  let e = 180 * this.rotatingTriangle.rotation / Math.PI % 360, t = (e + this.triangleThickness) % 360;
  this.isAngleInWedge(this.arrowAngle, e, t) ? this.successfulPress() : this.failedPress();
};
handleSpaceKey = e => { if (isFishingKeybind(e)) this.handleMinigameClick(); };   // the fixed pin
successfulPress() { updateFishLevel(+gain); if (fishLevel >= 100) this.win(); else spawnTriangle(); }
failedPress()     { updateFishLevel(-lastLevelGained); consecutiveSuccesses = 0; spawnTriangle(); }
```

- The click **position is irrelevant**: the game compares the wedge `[rotation, rotation + thickness]`
  against a fixed pin at 270 deg. `arrowAngle = 270`, `fishLevelTarget = 100`, level starts at 0.
- **One fish is 5-7 correct presses**, not one. A press that pays out no card is the normal case.
- Per-rarity gain / time limit / wedge thickness, from the same file:

| rarity | time limit (s) | gain per press | wedge (deg) |
|---|---|---|---|
| Common | 15 | 15-25 | 50-179 |
| Uncommon | 15 | 12-22 | 45-150 |
| Rare | 16 | 10-20 | 40-120 |
| Epic | 22 | 8-18 | 40-90 |
| Legendary | 30 | 6-15 | 30-70 |
| Secret | 40 | 2-10 | 30-50 |

- A **failed** press undoes the previous gain and zeroes the streak bonus
  (`startFromStreak 2, bonusPerStreak 2, maxBonus 16`), so a miss costs far more than a pass.

### What that invalidates

The 204x272 panel that followed every press - and that made "63 wins / 0 losses" in run C above -
is the reel UI itself, red-flashed by `failedPress()` for 50 ms. **That table is withdrawn**: the
oracle was measuring the minigame panel, not a catch. Only parsed card text counts now
(`__fish.accuracy().oracle`).

Per-press scoring is withdrawn for the same reason. A 600 ms / 3 s "no card = loss" rule scores five
healthy presses of one Flounder as five failures; the live log shows exactly that (six presses with
"press failed" immediately followed by `catch logged Flounder`).

### What replaced it: the fish attempt

`F.attempt` opens when a dial appears with none in progress and closes:

- **caught** - `parseCatch()` returned a species (the only oracle);
- **lost** - the cast prompt came back (with a 2.5 s grace, because a win's card is read up to ~3 s
  after the last press) or no dial and no press for 25 s (a stalled flow).

An A/B arm is now chosen **per fish**, not per dial: one fish is several dials of the same minigame,
so alternating by dial put both arms inside one attempt. Report shape:

```
__fish.accuracy()  -> { attempts, caught, lost, catchRate, presses, pressesPerCatch, byArm, byBand }
__fish.armReport() -> per arm: attempts, caught, lost, presses, dials, catchRate, pressesPerCatch
```

Live first run of the attempt metric (contain vs angle, midDeg 6, interleaved per fish):

| arm | attempts | caught | lost | presses | dials | presses/catch |
|-----|----------|--------|------|---------|-------|---------------|
| contain | 4 | 4 | 0 | 20 | 25 | 5.0 |
| angle | 3 | 2 | 1 | 13 | 21 | 6.5 |

7 attempts, 6 caught (Salmon, Oyster, Coelacanth, Clown Fish, Sardine x2), 1 lost, **5.5 presses per
catch**, ~1.3 attempts/minute. n=7 decides nothing: at this rate a 30-attempts-per-arm A/B is ~45
minutes of visible play.

### Two things that silently stop the run

1. **The tab must be visible.** `step()` returns early and `requestAnimationFrame` stops when
   `document.visibilityState !== 'visible'`; 56 s were lost that way in one session. For an unattended
   run, keep the tab in front (`__fish.status().hidden` shows it).
2. **A missed cast stalls everything.** Observed 60+ s with no dial and no press after a catch: the
   cast control is a small bubble and the caught-indicator is the same shape, so the detector
   sometimes taps an indicator that is not a button. `castRetryMs` (5 s) now falls back to the game's
   own fishing keybind, which casts only while its cast button is visible and is ignored while chat
   has focus. Live: `stats.castRetries` counts those recoveries (34 in the first ~6 minutes of the
   run above, i.e. the bite wait is longer than the retry gap, and the retry is harmless then).


## 2026-10-27 throughput - one press per triangle, and what "not losing" actually costs

Until now the loop held **one press per dial lock**: `pressesThisDial === 0` gated the re-arm. That
rule came from the belief that a press solved a fish, and it is wrong. `successfulPress()` spawns a
new triangle in the same widget, so a fish is 5-7 presses and every one of them cost the bot a full
dial close (4 bad frames), a re-lock scan (`dialCheckMs`) and often a lock on the fading ring.
Measured on the live build before the change: **0.56 presses per lock, 24 ghosts in 86 locks**, and
the three lost fish of that run were all slow dials (omega 111-175 deg/s) where one press took 3-13 s.

The rule now:

- re-arm when `|delta| > win + 12` (the wedge left the window), so one rotation is one press and the
  next triangle is pressed on its next rotation; `maxPressPerDial` (12) is only a runaway guard;
- a second press on the same lock also needs **evidence of a new spawn** (`newTriangle()`): a
  thickness jump >= 3 deg, a delta jump > 25 deg beyond the predicted rotation, or the ring blinking
  out for 2 frames. Without that gate a second press can land on the triangle the game just judged,
  and `failedPress()` subtracts the last gain and zeroes the streak;
- `relockGraceMs` (450) holds the dial geometry through the post-press blink instead of dropping it,
  which is where the ghost locks came from;
- a press clears `geo._hist` so the rate fit never straddles the spawn jump.

Live, first 10 minutes on the new build (contain vs angle, per fish):

| metric | before | after |
|--------|--------|-------|
| presses per dial lock | 0.56 | 2.1 (19 presses / 9 locks) |
| ghost locks | 24 / 86 | 0 / 9 |
| caught / attempts | 11 / 15 | 4 / 4 |
| `misses` (press the game did not act on) | 3 / 61 | 0 / 19 |
| PRESS `gate` counts | - | first 9, new-triangle 10 |

### The arithmetic of losing

A fish needs `ceil(100 / gain)` clean presses inside its rarity clock; `gain` is random per press
(Common 15-25 -> 4-7 presses, Legendary 6-15 -> 7-17, Secret 2-10 -> 10-50) and a wrong press takes
the last gain back. So the only question a loss asks is **presses needed x press cadence vs the
timer**. Simulated 30 000 fish per cell from the bundle's own tables at a 97% clean-press rate
(`shots/diag/cadence.js`):

| cadence | Common 15s | Uncommon 15s | Rare 16s | Epic 22s | Legendary 30s | Secret 40s |
|---------|-----------|--------------|----------|----------|---------------|------------|
| 0.9 s | 100% | 100% | 100% | 100% | 100% | 100% |
| 1.2 s | 100% | 99.97% | 99.99% | 100% | 100% | 100% |
| 1.5 s | 99.86% | 99.83% | 99.25% | 99.97% | 100% | 100% |
| 1.8 s | 98.94% | 98.39% | 95.57% | 99.77% | 99.98% | 99.99% |
| 2.2 s | 89.00% | 87.41% | 87.36% | 98.48% | 99.71% | 99.86% |
| 3.0 s | 86.34% | 66.70% | 18.78% | 85.00% | 96.66% | 96.57% |
| 4.0 s | 0% | 0% | 0% | 0.69% | 80.72% | 81.94% |

The live cadence is ~1.4 s per press per fish (5 presses per 5.5-11 s attempt), i.e. inside the band
where every rarity is >= 99%. That is the honest answer to "can it never lose": the clock only bites
when the cadence stretches, and the cadence stretches on slow dials (one press per rotation is then
bounded by `360/omega`) and on any dead time spent re-acquiring a dial. Frame rate is not the
limit: the live loop runs at 84 fps in this tab (dev machine, 144 Hz display), so a frame is ~4 deg
at 350 deg/s against a window that is tens of degrees wide.

### One open anomaly

`stats.castRetries` fires during a long wait, and the wait is normally short: cast -> first dial
measured at 590, 576, 595, 609, 560, 625, 589 ms (7 of 7). One 57 s gap remains unexplained
(`bubble anywhere` -> tap -> no dial for 57 s, then a bubble and a normal cast), so the retry is
still in place and still unproven; do not read it as a bite-wait artifact.

## 2026-10-28 thirty fish attempts on the multi-press build: 28 caught, 2 lost

The first sample big enough to quote, taken on the build with multi-press throughput + the
attempt-level oracle (a fish attempt opens at the first press and closes on a parsed catch, the cast
prompt re-appearing, or 25 s of idleness). Arms were selected **once per fish**, contain vs angle.

| metric | value |
|--------|-------|
| attempts | 30 |
| caught / lost | 28 / 2 |
| catch rate | 93.3% (Wilson 95% CI 78.7% - 98.2%) |
| presses | 159 (5.68 per catch) |
| presses per dial lock | 2.61 |
| ghost locks | 0 |
| `misses` (press the game ignored) | 0 |
| loop rate | 84 fps, `visibilityState` visible |

By speed band (band = fastest wedge the attempt saw):

| band | attempts | caught | lost | presses |
|------|----------|--------|------|---------|
| fast (300-500 deg/s) | 27 | 25 | 2 | 144 |
| blur (> 500 deg/s) | 3 | 3 | 0 | 15 |

By arm (one arm per fish, so each row is whole fish):

| arm | attempts | caught | lost | presses | dial locks | presses per catch |
|-----|----------|--------|------|---------|-----------|-------------------|
| contain | 15 | 14 | 1 | 77 | 27 | 5.50 |
| angle (midDeg 6) | 15 | 14 | 1 | 82 | 34 | 5.86 |

What this does and does not say:

- The two losses are **not proven escapes**. Both were scored `why: 'cast prompt'` in the fast band.
  Loss #21 was forensicked: 6 clean presses in 6.4 s, then two shape-accepted 304x420 / 320x436
  cards with ink 0.115-0.116 - inside the *real* catch-card envelope - that never produced parsed
  text. So the 93.3% is a **lower bound**: either the fish genuinely escaped, or `parseCatch()`
  silently missed a card the detector had already accepted.
- **The arms are indistinguishable** at this sample size (14/15 each; the difference is one fish and
  the CIs overlap completely). Containment is kept for its larger theoretical slack (the whole arc is
  the acceptance window), not because it has been shown to win.
- The blur row has n = 3, so it says "no loss observed above 500 deg/s", not "safe above 500 deg/s";
  the one-sided 95% lower bound on its catch rate is 36.8%.
- This **replaces** the withdrawn 63/65 table - that one counted the minigame panel as a catch card.
  It does not resurrect the old claim; 28/30 is what the honest oracle measured.

## 2026-10-28 catch log: a local ledger, an embedded catalogue, a rarity strip

The server-free userscript kept no history at all: `POST /catch` needs fishserve, so a player who
imported the userscript got a live counter and lost everything on a reload. Catch log v1 adds a
`localStorage` ledger written once per **parsed catch** - the only thing that has ever been allowed
to score a fish.

**The ledger.** Key `autofish:log:v1`, shape
`{v:1, createdAt, updatedAt, total, shiny, golden, species:{name:{n,best,bestAt,first,last,shiny,rarity,derived}}, rarity:{tier:count}, days:{'YYYY-MM-DD':{n,rarity}}, last:{species,rarity,derived,shiny,weight,weightKg,value,at}}`.
One write per catch, inside try/catch: a blocked or full store logs `ledger not saved (storage
blocked or full)` and the fishing loop is untouched. `days` is trimmed to the newest 60 so the
blob cannot grow without bound; species totals are never trimmed.

**Rarity without pixels.** The catch card prints a tier word for non-common fish. When it prints
none, the tier comes from a **135-species catalogue generated offline from the game bundle**
(`scripts/gen-catalogue.js`, rows `[name, tier, minWeight, maxWeight, baseGold]`) and is flagged
`derived: true`. A printed word always wins (`derived: false`); a species the catalogue does not
know stays `Unknown` - the bot never guesses a rarity from colour. Shiny and Golden are *name
prefixes* in the game's own display name (`Shiny Blobfish`), so the base species is recovered by
stripping the prefix and the tier follows the base species.

Catalogue facts (bundle `3763-*.js`): 135 real species. A naive regex finds 136 `name/rarityTier`
objects, but the 136th is the `{name:"Empty"}` placeholder on `currentFish`, so it is excluded.
Tiers: Common 23, Uncommon 22, Rare 19, Epic 25, Legendary 26, Secret 8, Halloween 6, Christmas 6.

**API.** `__fish.log()` (summary: totals, `byRarity` for all eight tiers, `top` five, `best`,
`today`, `last`), `__fish.logCsv()` (one row per species:
`species,rarity,derived,shiny,count,best_kg,first_seen,last_seen`), `__fish.logReset()`,
`__fish.status().ledger` (`{total, species, shiny}`), `__fish.report().catchLog`. Nothing else reads
the ledger, so it costs zero per frame.

**Panel.** Eight cells (COM/UNC/RAR/EPI/LEG/SEC/HAL/CHR) plus a last-catch line that reads
`Shiny Tuna · 22.1 kg · ~Uncommon · 01:09`; a `~` before the tier means derived. The strip is fed
from the ledger rather than the live counters, so it keeps showing history while the bot is idle,
and a failed ledger read is swallowed instead of blanking the HUD.

**Measured live** (page 2, the built `dist/autofish.user.js` injected, a seeded three-catch ledger):
the strip rendered `COM 1 / UNC 1 / RAR 1 / EPI 0 / LEG 0 / SEC 0 / HAL 0 / CHR 0` and the line
`Shiny Tuna · 22.1 kg · ~Uncommon · 01:09`; `__fish.log()` returned total 3, speciesCount 3,
shiny 1 and eight `byRarity` rows; `logCsv()` returned the header plus three rows. Injecting this
build also exposed a pre-existing bug: `__fish.status()` threw before the first `start()`
(`F.stats` is created by `start`), which blanked every panel meter while idle. `status()` now
defaults to an empty stats object.

**Tests.** `tests/catchlog.test.js` - 17 tests over the sentinel block with a stubbed
`localStorage`: catalogue integrity, `speciesInfo` (case-insensitive, shiny/golden/unknown),
`normTier`, `parseWeightKg` (kg/g/t/lb), `describeCatch` printed-vs-derived, `addToLog` best-weight
and day buckets, `logSummary` ranking, `logCsv` escaping, `trimLog`, JSON round trip, and corrupt /
foreign / blocked stores. Plus a `tests/panel.test.js` guard that the strip reads `__fish.log()`.
`node --test` = 85 pass / 0 fail.

## 2026-10-28 frame rate: the bot was the lag

Reported: "i noticed fps drops or bit laggy now in playing lofi.town". Measured on the live tab (UI
layer 1459x954, dpr 1, `document.visibilityState === 'visible'`), sampling `requestAnimationFrame`
gaps in 3 s windows:

| Condition | fps | p50 gap | p95 gap | worst |
|---|---|---|---|---|
| Bot stopped (game alone) | 141.3 | 7.0 ms | 7.2 ms | 14 ms |
| Old build running | **27.6** | 13.9 ms | **111.4 ms** | 139 ms |
| This build running, dial locked | 111-138 | 7.0 ms | 7.3-21 ms | 35 ms |

So the lag was ours, not the game's, and it was not subtle: the bot spent more than a whole frame of
a 144 Hz display on its own work every frame, and the p95 stalls were garbage collection.

**What cost the time.** Every number below was measured in the page against the live canvas:

| Work | Cost |
|---|---|
| `getImageData` of the bubble box (360x210) | 2.1 ms |
| `getImageData` of the dial box (194x194) | 1.68 ms |
| `getImageData` of the whole surface downscaled to 365x239 | 1.63 ms |

Three causes compounded it:

1. **`bubbleInBox` ran every frame**, and its column count called `PX()` per pixel. `PX` returns a
   fresh 4-element array, so a 360x210 box allocated 75,600 arrays per frame - roughly 6.3M
   arrays/s at the observed loop rate. That is the p95 stall.
2. `bubbleAnywhere` read and flood-filled the **whole** UI surface five times a second for a prompt
   that stays on screen for seconds.
3. The bubble box was read even while a dial was locked, when the cast prompt cannot be up.

**What changed.** The two per-pixel loops in `bubbleInBox` read channels straight out of the buffer
(`d[i]`, `d[i+3]`) and count columns in one pass; the whole-surface prompt scan is throttled to
3 Hz; and `F.findBubble` is time-gated to **25 Hz while idle and 11 Hz while a dial is locked**. A
dial on screen means the cast prompt is gone, so those reads were pure waste. Detection latency is
at most 40 ms against prompts that live for seconds. The dial sample - the part accuracy depends on
- still reads at the full loop rate.

**Two bugs I put in, and the guards that now catch them.** Shortening the inner bubble width/height
to `bw`/`bh` first shadowed the buffer's own `w`/`h`; the height one left `h` in the temporal dead
zone, which would have thrown on the first candidate bubble and stopped the run after four bad
frames. Both were caught by reading the rewritten function before shipping, and are now pinned by
`tests/perf.test.js` (four guards: the scan rates, no `PX()` or array literal in the box scan, and no
shadowing of the buffer stride).

**Measured after** (same tab, build injected, bot running with a dial locked): 111.4 fps, p50 7.0 ms,
p95 21 ms, `stats.errors` 0. Detection still works: `bubble anywhere` fired 1.0 s after a catch card
was dismissed, and the bot kept catching while the sample was taken.

## 2026-10-28 the dial search was the real lag: 83 ms a call, 67% of the main thread

The bubble-scan fix above was not enough. The user re-imported the userscript and reported the lag
again, so the measurement was repeated on the live tab with the imported build running.

| Condition | fps | p50 gap | p95 gap | longtasks |
|---|---|---|---|---|
| Bot running, imported build | **15.6** | 83.5 ms | 153.2 ms | 30 in 4 s (3.4 s of blocking) |
| Bot stopped, panel still mounted | 138.6 | 7.0 ms | 7.2 ms | 0 |

The panel is free; the core loop was the load. rAF attribution (a patched `requestAnimationFrame`
that recorded `new Error().stack` of the caller) put **837 of every 1000 ms** inside the
userscript's own `loop`, against 64 ms for the game's `_tick`. So it was still ours.

**Which function.** Every candidate was wrapped in a wall-clock timer with `F.geo = null` (the state
where no dial is on screen, which is most of a run):

| Function | Calls/s | Average | ms per second |
|---|---|---|---|
| `F.lockDial` | 8.0 | **83.34 ms** | **670** |
| `F.findCatch` | 38.3 | 4.11 ms | 157 |
| `F.findBubble` | 38.3 | 0.82 ms | 31 |

Two thirds of the main thread was one function, called eight times a second, looking for a dial that
was not there. `lockDial` searched 225 centres x 22 radii x 20 rim samples = **99,000 samples per
call**, each with its own `Math.cos`/`Math.sin` and a `PX()` that allocated a fresh 4-element array.
A micro-benchmark of those 99,000 samples in the page: 14.1 ms of trig, 10.5 ms of array allocation,
2.9 ms for the same reads by index. The allocation was as expensive as the arithmetic.

**What changed.**

1. **Precomputed tables.** Cosines and sines for 20-, 40- and 72-step rims and the 25 pin sample
   points are built once at load (`RIM_C20/RIM_S20`, `RIM_C40/RIM_S40`, `DIAL_C/DIAL_S`, `PIN_F/C/S`).
   The pin points are generated by the same literal loops as before, so they are the same points.
2. **A rim mask instead of samples.** `rimMask(r)` classifies the whole read buffer once into a
   `Uint8Array`, and `rimHits` only counts table positions. The search still tries the same centres,
   radii and thresholds; it just stops recomputing `isRim` 99,000 times.
3. **`F.sample` reads its three rings by index** (`isRim`/`isGreen`/`isPin` on `d[i]`), and
   `inkMix` no longer allocates an array per pixel (a 304x420 catch card was 127,000 arrays a call).
4. **The catch-card scan is throttled** to `cardCheckMs` (100 ms). A card sits on screen for seconds;
   scanning it 38 times a second was pure waste.

**Measured after** (same tab, same session, fixed build injected, bot running):

| | Before | After |
|---|---|---|
| `lockDial` average | 83.34 ms | **4.2-4.29 ms** (over 38 and 82 calls) |
| `lockDial` cost per second | 670 ms | ~3 ms |
| `findCatch` average | 4.11 ms | 0.58 ms (over 614 calls) |
| fps, no dial on screen | 32.2 | **140.6** (p50 7.0, p95 7.1) |

Correctness held: 1 fish attempt, 1 caught, 6 presses, 2 dials locked, 0 ghosts, 0 errors, 2 cards -
the dial is still found and played, only cheaper. `node --test` is 94 pass, and `tests/perf.test.js`
now pins the rim mask, the indexed rings, the tables and the card throttle so a future edit cannot
quietly reintroduce a per-pixel array or a per-sample `Math.cos`.

**Lesson.** Fixing the loader that shouts the loudest is not the same as finding the hot spot. The
first fix removed 6.3M array allocations a second and took the dial-locked frame rate from 27.6 to
111 - and left the *idle* frame rate at 32, because the expensive call only ever ran when no dial was
on screen. Measure the state you are actually in.

## 2026-10-28 four copies of the UI layer a second: one shared grab, and a watchdog for a dead loop

The dial fix above removed the arithmetic. It did not remove the **readbacks**: every detector still
pulled its own copy of the UI canvas through `getImageData`, and a readback is a GPU-to-CPU
sync, so it costs about 3 ms whatever its size. Wrapping the prototype and tallying by box, with the
bot hunting (no dial on screen) on the live tab:

| Read | Size | 3.4.0, hunting | 3.5.0, hunting | 3.5.0, dial locked |
|---|---|---|---|---|
| bubble box, `bubbleInBox` | 360x210 | 23.4 a second | **0** | 2.2 |
| card box, `cardInBox` | 365x405 | 9.6 a second | **0** | 0.2 |
| shape scan, `downscale` | 364x238 | 5.1 a second | 11.9 | 10.2 |
| dial check, `lockDial` | 240x240 | 8.0 a second | 8.0 | 2.7 |
| locked-dial wedge, `sample` | 228x228 | - (no dial) | - (no dial) | 76.9 |
| **total** | | **46.1 reads/s, 172 ms/s** | **19.8 reads/s, 58 ms/s** | 93 reads/s |

The two hunting columns are the same tab, the same spot, the same build otherwise: 20.1 s on 3.4.0 and
15 s on 3.5.0. Halving the readbacks is what the change below bought; the third column is honest about
the rest - with a dial locked the bot reads a 228x228 wedge every frame to play it, and that path is
untouched on purpose.

**What changed.**

1. **One grab a tick (`snapshot()`).** A quarter-scale read of the whole UI layer is taken at most
   once per `scanTickMs` (66 ms, ~15 Hz) and every detector reads *that*. It is now the only caller
   of `downscale()` in the file, which `tests/perf.test.js` asserts.
2. **A cheap gate before an expensive read.** `bubbleGate()` / `cardGate()` decide from the snapshot
   whether the full-resolution box read is worth spending: ten white pixels for the *CAST!* prompt, 8%
   cream pixels for a catch card. When the gate says no, the finder still falls through to the shape
   search - no detection is skipped, only the read is.
3. **Full resolution only on a hit.** `bubbleInBox()` and `cardInBox()` now run behind their gate;
   `bubbleAnywhere()` and `cardByShape()` read the shared snapshot instead of pulling their own copy;
   a found bubble's centre and a locked dial's wedge are still read at full resolution, because those
   are the cases where the pixels are actually needed.
4. **Reused scratch.** `blobs()` clears and reuses one `Uint8Array` instead of allocating one per call.

Fishing logic is untouched: the same throttles as defaults (`dialCheckMs` 120, `cardCheckMs` 100, the
90/40 ms bubble throttle, the 350/400 ms shape throttles), the same rim classification, the same press
rules. The Cozier / focus-session path was not touched at all.

**Behaviour held.** In a 13 s active window on 3.5.0: 3 dials read, 1 caught, 10 presses, 0 stalls;
over the first ~70 s of running: 5 dials, 3 catches, 16 presses - the same dials-per-minute and the same
win rate as the 3.4.0 numbers above.

**A loop that dies without an exception.** The review also caught the failure that no counter showed:
`__fish.status()` said `running: true, frames: 61909` while `lastTickAgoMs` was 645 331 (10.7
minutes) and a 3 s rAF sample recorded zero bot frames. An occluded window had suspended
`requestAnimationFrame`; `document.visibilityState` stayed `visible`, so the hidden-tab pause never fired,
and `loop()` only guards exceptions - so the bot sat there reporting RUNNING and charging session
time for ten minutes of nothing. Now:

- `step()` stamps `F.lastTickAt` (the only fact the watchdog needs);
- a 1 s `setInterval(checkStall, 1000)` compares it with `now()`; with `F.running` and no tick for
  more than `STALL_MS` (2000 ms) it sets `F.stalled`, logs `loop stalled {ms}` **once**, counts
  `stats.stalls`, then cancels any pending frame and re-arms `requestAnimationFrame(loop)` - the
  cancel is what stops a second loop from being started on top of a live one;
- while stalled the session clock is **not** credited (`session.js` skips the tick's `fishingMs` and
  keeps `lastTickAt` current, so the next live tick resumes from now, not from the stall);
- the panel shows **stalled** instead of RUNNING, paints a red line instead of the usual banner, and
  sets `data-stalled="1"`; `__fish.status().stalled` and `.lastTickAgoMs` expose the same facts;
- a hidden tab is excluded on purpose: that is the existing hidden-pause path, not a stall.

**Verified live** by stubbing `requestAnimationFrame` to a no-op: within 3.6 s `stalled: true`,
`loop stalled 2545ms` logged exactly once, `stalls: 1`, the panel read `stalled` with
`data-stalled` set, and the session clock froze at 57 961 ms across 2.2 s of silence. Restoring rAF gave
`loop resumed`, `stalled: false`, and the clock picked up 57 961 -> 58 957 -> 66 957 ms with fishing
continuing. `node --test` is 123 pass; `tests/watchdog.test.js` pins the stamp, the threshold, the
once-only log, the re-arm and the panel line, and `tests/session.test.js` proves the clock is not
charged for a stalled stretch.

**Lesson.** The expensive thing was not the pixels, it was the sync: four small reads a second cost more
than one bigger one. And the counter that lied was the one nobody watched - a loop with no tick
timestamp cannot tell *slow* from *dead*.

## 2026-10-28 why the bot stops casting: fishing is seat-based

The long-standing "it just stops after a while" stall is not a click-timing bug and not a pixel
miss. It is the seat.

**The bundle says so** (`shots/diag/c3763.js`, the character's sit path):

```js
this.isLocal && "stand" !== t.seat.type && (
  this.isRaycastHittingWater(t.seat.fishingReach ?? 50)
    ? (P.A.getState().setCurrentSeatType("fishing"),
       d.A.signal.emit("showAnimations", []),
       d.A.signal.emit("showCastButton"))
    : (P.A.getState().setCurrentSeatType("focus"), ...)
)
```

`showCastButton` has exactly two sources: that sit path (a seat whose 50 px raycast reaches water)
and the post-fish result (`onFishingResult`, `lose`, `showCastUI`). A **standing** character
therefore has no cast prompt at all — and `startFishing` is only reachable from the prompt
(`castUI.button` click, or Space while `castUI.button.sprite.visible`).

So the real cycle is: sit on a waterside chair once → the prompt appears → click it → the reel/dial
loop runs → after every fish the prompt comes back → the loop is self-sustaining. Anything that
stands the character up (a stray tap on the ground, a walk, the site's own unsit) kills the prompt
permanently, and the bot then logs `cast retry` every 5 s forever. That is the 60 s+ stall.

**The bot cannot sit itself.** Seats are world objects the player clicks; the fishing code has no
self-sit entry point, and synthesising pointer clicks on furniture is a much larger input surface
than tapping the prompt.

**What shipped because of this**

- The recovery ladder no longer walks. `castRecovery(n)` is now click → click + keybind → keybind
  only. The old 4th rung held a movement key to stand the character up; that is exactly the wrong
  move here (it removes the seat), and on 2026-10-28 it walked the character behind the fish shack
  where it was neither visible nor fishable — a self-inflicted stall.
- A seat watchdog: after `seatWatchdogMs` (45 s) with no dial, no press and no prompt the bot logs
  `needs a seat` once and reports `status().needsSeat === true`, instead of clicking at nothing.
  The flag clears the moment a prompt or a dial proves the character is seated again.
- `tests/perf.test.js` now forbids re-introducing any movement key, and `tests/timing.test.js`
  pins the three-rung, never-walk ladder (102 tests).

**Operating rule**: sit at the water, then Start. If the log says `needs a seat`, stand up and sit
again — the bot will not move your character for you.

**The panel says it too** (2026-10-28): while a session is running or paused and `status().needsSeat`
is set, the card's footer banner turns orange and reads *"clock paused — nothing to bite: sit on a
chair by the water"*. It outranks the log-offline banner because it is the reason nothing is
happening, and `host.dataset.needsSeat = '1'` exposes the same flag outside the closed shadow root.
Verified live by forcing the flag through `status()`: the footer rendered the orange notice on the
running card.

**The clock pauses with it** (2026-10-28, `session.js`): a tick carrying `seat: true` while running
enters `paused` with reason `seat` *before* any fishing time is credited, so an unseated character
burns neither `durationMs` nor `dailyCapMs`. That pause is the one case that does NOT emit
`pauseCore`: the core is the only thing watching for the cast prompt, and it clears `needsSeat`
when the player sits down again, which is what resumes the session (`seat: false` -> `running`
with `resumeCore`). A seat pause longer than 30 minutes (`SEAT_STOP_MS`) stops the session with
reason `no-seat` instead of leaving it paused forever, so a forgotten character never silently eats
a night: measured in node, one unseated minute left `fishingMs` at 60 000, twenty more left it
there, sitting down resumed at 60 000 and the next 30 s brought it to 90 000.

**Verified on the shipped userscript** (2026-10-28, after the user re-imported `dist/autofish.user.js` and
reloaded): one panel mounted, `opts.seatWatchdogMs` 45000 present, and with `status()` forced to report
`needsSeat` the panel went `paused`/`seat` while `fishingMs` stayed at 898 993 through 2.6 s of ticking,
then returned to `running` with the same clock when the flag came back false. The catch ledger survived
the reload (121 catches, 39 species) and the bot kept fishing afterwards (26 caught that session,
0 errors).

**The daily cap and the clock window ignore seat time too** (2026-10-28, same reducer). The character's
clock stops during a seat pause; the wall clock does not, so the pause branch re-checks the schedule:
a seat pause that outlives the window now ends the session with reason `window` (22:00 start, 23:01
tick -> cooldown), and a pause that runs into an already-spent daily budget ends it with
`daily-cap` instead of resuming straight into a stop. What it never does is charge the pause to the
budget: 19 unseated minutes with a 10-minute cap left `fishingMs` at 300 000 and the session paused,
then sitting down resumed at 300 000 with the last five minutes still available.

## 2026-10-29 the prompt that was never clicked, and a dial search that could not reach the dial

Reported: the wedge passes the pin, the bot presses, nothing lands — "failing the fishing game mode".
Investigated on the live tab (build injected into app.lofi.town, 1680x1031, dpr 1).

**What the tab actually showed.** One dial locked and one fish caught in ~20 minutes, 5 presses, and
**140 `cast retry` rows**. A REEL! prompt sat on screen for minutes at a stretch while every `bubble`
row from rung 14 on logged `tap:false, space:true`. The panel then paused with `no-catch`, and its
footer read *"clock paused — nothing to bite: sit on a chair by the water"* at a character that was
sitting on a chair with its rod out.

Two measurements made the cause concrete:

- `F.hint` was **(739, 369)** while the dial's real centre was **(840, 411)**. `lockDial` searches
  ±22 px around the hint, so it could not reach a dial 101 px away. The hint had been written by
  false bubble detections at (735,260)/(735,262) — name tags, not prompts.
- `F.sample({cx:840, cy:411, R:96})` on a live dial returned **valid, width 85, mid 33, ring 0.85** —
  i.e. **exactly 17 of 20 rim samples**, which was `lockDial`'s coarse acceptance threshold.

The dial itself is unchanged: base (142,138,111), wedge (182,188,132), pin (229,118,83) at 12
o'clock, centre (840,411), R 96. A trusted click on the prompt started the minigame, and so did the
bot's own synthetic tap — the game has **not** started rejecting synthetic input, so nothing here is
a pixel or input regression.

**Three defects, all in the core.**

1. **`castRecovery` was a one-way door.** From rung 3 it returned `{tap:false, space:true}`, and the
   rung was only reset by a successful dial lock — which needs the minigame that the tap would have
   started. Two failed taps therefore locked the bot into keybind-only for the rest of the run, and
   the game ignored the keybind (`consumed:false` on every retry). It now always taps; the keybind is
   added from rung 2 onward. A prompt is a button.
2. **`F.hint` was written only inside `if (rec.tap)`.** On any rung that no longer tapped it froze at
   whatever blob was last clicked. It is now set from the prompt on every detection — which is where
   the dial actually appears.
3. **`lockDial` accepted 17/20 rim samples and the live dial measures exactly 17/20.** Lowered to
   15/20, and `sample`'s ring gate from 0.8 to 0.75; the pin gate and the wedge requirement are what
   reject non-dials, not this count.

Two supporting changes: `lockDial` tries the **last locked circle first** (`F.lastGeo`), so a drifted
hint cannot hide a widget that has not moved, and the recovery ladder restarts after the prompt has
been gone for `castRungResetMs` (10 s) instead of counting attempts across the whole run.

**Verified:** 127 tests pass, including four new guards (the ladder never drops the click, the hint
is set before the tap gate, the remembered circle is tried first, the rim gate is 15).

**First attempt was blocked:** the verification window went occluded — `document.visibilityState ===
'hidden'` with `stats.frames === 0` — and a hidden page gets no `requestAnimationFrame`, so nothing
could be measured. A run that cannot get frames is the same trap the 2026-10-28 stall watchdog was
added for; bring the window forward before judging any build.

**Verified live afterwards** (2026-10-29, neo tab brought visible, fixed core injected into
app.lofi.town at **1117x785**, dpr 1 — note: not the 1680x1031 the boxes were measured at):

| Measure | Fixed core | Previous build (same tab, earlier) |
|---|---|---|
| Catches / attempts | **9 / 9** | 22 / 23 |
| Lost fish | **0** | 1 |
| Dial locks | 19 | 44 |
| Presses that landed (`hits`) | 19 | 42 |
| Total presses | 46 | 115 |
| **Presses per catch** | **5.1** | 5.2 |
| Presses per landed hit | 2.4 | 2.7 |
| `bubble` rows logging `tap:true` | **18 / 18** | rung >= 3 logged `tap:false` |
| Misses / skipped dials / errors / stalls | 0 / 0 / 0 / 0 | 0 / 1 / 0 / 0 |

- Every dial locked at the same circle, **(557, 288) R 84**, and `width` (wedge arc) swung 80-140°
  between triangles: the widget is live and the classifier follows it. R is 84 here versus 96 at
  1680x1031, so the lathe does scale a little with the viewport; `lockDial`'s 78-120 range covers both.
- Rungs seen were **1 and 2 only**, and both rows carry `tap:true, space:true`. The old one-way door
  showed up from rung 3 onward, which is exactly where the fix changes behaviour.
- The ledger agrees with the counters: 10 rows in `catches.csv`, 02:36:23 -> 02:39:50 (one catch per
  15-30 s while the fish were biting), including an Epic Betta ($36), an Uncommon Tripod Fish ($19)
  and a Tetra ($21). The core counter read 9 attempts won against those 10 rows - one fish landed
  while no attempt was open, so it was logged without being scored.
- The first ~28 s after `start()` showed **no prompt at all** (the character was mid-cast) and 5 cast
  retries. The first real prompt corrected `F.hint` from the hardcoded default (861, 372) to
  (558, 287), and every dial was lockable from then on — the hint-on-detection change doing its job.
  A fresh start at a new window size still depends on that one prompt to teach the hint.
- The fishing came in two windows (7 catches to 02:38:57, then 3 more after a gap) and ended each
  time with **no dial defect**: the game stopped emitting cast prompts and the core's own watchdog
  named it (`needs a seat: no cast prompt: sit on a waterside chair`). No fish was lost in either
  window, and the core is still armed for the next prompt.

**The tab had been running a stale build.** Before the injection, `window.__fish` reported version
`3.6.1`, carried perf wrappers on `sample`/`findBubble`/`lockDial`, and `timing.castRecovery(3)`
returned `{tap:false}` — i.e. the pre-fix ladder. Any live diagnosis against that tab was measuring
the old code, not the fix; the numbers above are from a core that answers `castRecovery(3).tap === true`.

## 2026-10-29 review round: the dial no longer needs a prompt to be found

A full read of the source turned up one reliability gap and four silent-data bugs. All are fixed;
157 tests pass and `dist/` is rebuilt.

**The dial search had no fallback.** `F.start` seeded `F.hint` at a literal (861,372) measured at one
viewport, and `lockDial` searched ±22 px around it. Measured live: at 1117×785 the first prompt
corrected the hint 28 s after start, and in another session the hint sat at (739,369) while the dial
was at (840,411) — unreachable. The circle is now persisted (`autofish:dial:v1`, with the canvas size
it was measured at and scaled on a proportional resize), tried first on the next run, and there is a
whole-surface recovery: one quarter-scale pass finds the green wedge, its bbox centre puts the dial
centre somewhere on a 0-100 px annulus around it, and one boxed full-resolution read tests that
annulus with the same rim mask and the same `finishLock` validation. It runs only after 2.5 s with
no dial and is throttled to one pass a second; `opts.dialFallbackMs = 0` disables it.

The first version of that recovery could not have found a real dial, and the live probe caught it.
The wedge is a **sector**, not a thin arc: its bbox reaches ~1.8R per side (~215 px at R=120), while
the guessed filter capped a blob at 90 px tall — and the quarter-scale flood needed 18 px, more
than a small dial's arc survives. The window is now `wedgeBoxOk(W, H)` (24-340 px per side, 6 px at
quarter scale) with the dimensions from the probe, and the rim/pin proof in `finishLock` is what
rejects non-dials. Verified on a real canvas at real scale, with the game tab's frames still
suspended: a dial painted at (840,411) R=96 with the measured tones was found by `dialAnywhere()`
with **no hint** at (839,412) R=96, width 165°, and a remembered circle locked in 2 ms from a hint
740 px wrong. That is the failure mode from the review, removed by measurement rather than by hope.

**One unparsed card corrupted the next catch.** `parseCatch` read everything since `F.txtAt`, and the
cursor only moved on a successful parse, so a card that failed (`noprice`, `nowords`) left its text in
the buffer: the next card's species, weight and value could all come from the old one. The cursor now
advances when a card is dismissed unparsed. The reader was also extracted (`textSince`, `parseCard`)
and now decides a pre-weight word by whether it is a tier: `Whale Shark | Epic | …` keeps Epic as the
rarity, `Lobster | Impressive | 3.36kg` keeps Impressive as the quality. `MONEY` accepts decimals.

**The per-press metric was one this file already withdrew.** `closeDial` scored `hit` when the dial
ended within 1.5 s of the last press, which only the finishing press can do. Presses are now scored
by the observable the re-arm gate already used: `pressOutcome` returns accepted when the game spawns
a new triangle (thickness jump, delta jump beyond the rotation, or two blink frames), rejected when
the same triangle survives 250 ms. `sweepReport` reports accepted/rejected/acceptRate per bias, and
`accuracy.pressAcceptRate` is the number to read. The dial verdict stays in `outcomes` for diagnosis.

**`blobs()` had reintroduced the allocation the perf pass removed.** `spx()` built a 4-element array
per pixel and the flood fill built another per visited pixel — ~108k arrays per whole-surface scan at
1680×1031. The pass is now `floodComponents(w, h, d, match, minPx, seen)`, pure and tested on a
hand-built image, with index reads and one shared scratch neighbour array.

**The cast-retry ladder was called for effect and ignored.** The stall path has no bubble
coordinates, so it now sends only the keybind and says so; the ladder lives in the bubble branch,
where a prompt exists. The test that "covered" the old call certified a no-op and now guards the
honest behaviour.

**The server-free install lost its daily cap on every reload.** The panel guessed
`http://127.0.0.1:8731` when inlined, fetched `/sessions`, and started today at 0 when that failed;
it also bannered "session log offline" on every stop. `BASE` is now null unless the panel was served
over http, the day's minutes live in `autofish:today:v1` (same local day only), a finished session
adds to it whether or not a server exists, and a second Start in the same page re-reads it.

**Canvas pixels are now converted at the DOM boundary.** `tap()` and `zones()` mapped backing-store
coordinates straight into `elementFromPoint`/PointerEvent and the panel's exclusion rect, which is
only right at dpr 1. `cssPoint()` converts through the canvas's CSS box; at the measured dpr it is
the identity, so it cannot move a press that already worked.

The review's P3 items are untouched: the dead predicates, the `geoReasons` off-by-one frame, version
and doc drift beyond the lines above, the legacy root loader and `run.sh`'s lost executable bit.

## 2026-10-29 live run: first lock and press acceptance measured

The rebuilt core was injected into the real game tab (1117×785, two canvases, ~135 fps) for one
4.6-minute session: **6 caught, 0 lost, 33 presses (32 scored), 0 rejected**, 16 dial locks, 0
errors, 0 stalls.

- **First dial lock: 18.2 s after Start**, at (557,286) R=84, width 125°. That number is the game's
  cast→bite sequence, not the search: Start, CAST! found only by the whole-surface fallback at
  +0.03 s and tapped, three cast retries, REEL tapped at +17.7 s, dial locked at +18.0 s — **0.53 s
  after the reel tap**. The seed hint (play-area centre) happened to be within 2 px of the real dial
  at this window, so neither dial memory nor the recovery pass was needed.
- **Dial memory written:** `autofish:dial:v1` = `{cx:557, cy:286, R:84, cw:1117, ch:785}`.
- **Press acceptance 32/32 scored = 1.0**, 0 rejected, 5.2 presses per catch. Every scored press was
  actioned by the game (a new triangle spawned), matching the 5.1 presses/catch of the earlier field
  run. The one unscored press was in its 250 ms window when the session was stopped.
- The fixed CAST box (690,215,360×210) **does not contain this window's prompt** (measured at
  558,234): every one of the 11 bubble detections came from `bubble anywhere`, and every one tapped
  at rung 1. The fallback is carrying the prompt path at this size; the box is still a 1620×1031
  measurement. **Fixed**: see "The prompt box follows the live surface" below.
- 33 `cast retry` rows in 4.6 min (one per 5 s while idle, all `consumed:false` until the prompt
  returned). By design (`castRetryMs: 5000`), but it is the noisiest part of a live log.
- The tab had been running a core that reported `3.6.1` from outside this checkout; this repo's
  build reports `autofish 3.0`. The installed userscript and this source are not the same build, and
  the version strings cannot be compared — worth reconciling before the next field run.

## 2026-10-29: the prompt box follows the live surface

The CAST!/REEL! box was measured at 1620×1031 and then read as a literal rectangle, so at the
1117×785 field window the prompt at (558,234) sat 132 px left of it and every prompt was found by
the whole-surface pass instead. The box is now `promptBox(cw, ch)`, derived from the live canvas:
the measured x/y/w/h scale with the surface, with a 260×150 floor because the bubble itself does
not shrink with the window, and every result is clamped inside the canvas. Both the free gate on
the shared snapshot and the full-resolution box read take their rectangle from it.

Checked against the one measured prompt: at 1117×785 the reference point maps to (558, 273) and
the prompt was found at (558, 234) — horizontal exactly right, 39 px high but inside — while the
box is (476,164,260×160), about 6% of the surface. `bubbleAnywhere()` remains the fallback for a
camera that has moved away from the box.

**Field verification, installed userscript, 1117×785, visible window.** The same window that had
produced 11/11 `bubble anywhere` detections now produced **14 bubbles, 14 from the boxed scan and 0
from the fallback**, at (558, 232-248). Over 182 s: 8 attempts, 8 caught, **0 lost, 0 misses**, 15
dial locks all at (557,287) R=83, 34 presses with **34 accepted / 0 rejected** (acceptance 1.0),
4.9 presses per catch, ~104 fps. The eight rows in `catches.csv` carry the right species and rarity,
so the card-text fix held too. The derived prompt y (273) is 25-41 px below where the prompt actually
painted at this size, which is why the 150 px floor and the whole-surface fallback stay.

**The version label was lying.** The engine hardcoded `F.version = 'autofish 3.0'` while the
userscript header climbed to 3.6.1, so a correctly updated install still reported an old version
from `status()` and the panel. The build now stamps `F.version` from `package.json` (3.7.1 at the
time of writing) and a test fails if the two drift. Tampermonkey's own dialog confirmed the update:
`INSTALLED VERSION v3.7.0` → script `v3.7.1`, and the reloaded page reports `autofish 3.7.1`.

**Installing that fix alone was a regression.** The build in the browser was 3.6.1 from the
parallel `repo-ingest` branch, which carries work this branch never had: the local budget store, a
per-profile catch ledger, the regenerated 181-species catalogue, the hidden-stop stepper and chain
restarts, and the `__fish.perf()` probe. 3.7.1 replaced all of it, which is why the panel looked old
and thin. `d544589` is merged into this line now; the duplicate day store added here was dropped in
favour of the budget store (`autofish:today:v1` and its test are gone), and the merged build is
3.8.0 with 177 tests.

**3.8.1 brings the last branch's uncommitted work in.** `repo-ingest` still had 3.6.1 changes that had
never been committed: an inlined rim count for the coarse dial scan (31-33 ms → 8-11 ms on Gecko,
same answer) and an on-screen perf box in the panel. Both are merged. The incoming patch used
`hit >= 17`, which is the gate measured to miss a real dial; the merged scan keeps **15/20**. Both
branches now point at the same commit, 178 tests.

**Re-measured on 3.8.0 after the merge** (installed userscript, 1117×785, 140 s, ~94 fps):
**10 bubble detections, 10 from the boxed scan, 0 from `bubble anywhere`**, prompt at (558,232);
7 dials all locked at (557,287) R=83 with the first 7.6 s after Start; **21 presses, 21 accepted,
0 rejected** (acceptance 1.0); 4 caught of 4 attempts, **0 lost, 0 misses**; 4 `catch logged` rows.
The detector fixes and the merged feature batch run together, so the merge did not regress either
side.

## Measured facts

All live, at a 1522×954 viewport, dpr 1. These correct several things in `SPIKE.md`.

| Fact | Value |
|---|---|
| Game canvas | 1522×954, world only — `app.render()` shows grass, water, boat, **never the bubbles or the dial** |
| UI canvas | a **second** 1522×954 canvas, the topmost element at the dial's position |
| Reading the UI canvas | must happen inside a `requestAnimationFrame` callback — its buffer is discarded after compositing, so a read from an ordinary task returns empty |
| Scene-graph interactivity | **dead** — every node reports `eventMode: 'passive'` and an empty `_events` map, yet synthetic pointer events on the canvas still reach the game |
| CAST!/REEL! bubble | white ~108×50, centred ≈(864, 319) |
| Dial | centred ≈(863, 371) = bubble centre + ~53px down; outer radius 83–90 |
| Dial lifetime | ~15.7s unpressed, then it vanishes on its own |
| Rim | light grey: saturation ≤ 22, luminance 158–246, alpha > 60 |
| Pointer | orange, fixed at 12 o'clock, at the rim not inside it |
| Wedge | the **saturated** region; ~45–115° as measured, luminance only ~35 above the base |
| Rotation | fast and not constant — ω observed from −220°/s to +746°/s, so direction and speed must be measured per crossing, never assumed |

## The bug that cost the most time

Wedge detection started on **luminance**. Base and wedge are only ~35 luminance apart and
anti-aliasing blends them, so the detected "wedge" width wobbled between 45° and 115° and the pin
almost never read as covered — 0 presses in 15.7s of dial. Switching to saturation/hue
(`g >= r` and `g > b + 12`, which rejects both the flat base and the red-dominant pointer) is what
finally produced clean detections. Do not go back to luminance.

## Failure modes to not repeat

1. **Never click anything except a validated bubble.** An earlier detector fired 42 clicks at world
   coordinates; clicks are absorbed by the minigame but the character wandered off the chair.
2. **Never treat a single bad frame as "dial gone".** Require 3 consecutive failures — the dial
   scales in over the first ~200ms and dropped the lock on frame two.
3. **Do not trust `app.render()` for UI.** It renders the world and silently omits the minigame.
4. **Do not read the UI canvas outside rAF.** It comes back empty, which looks identical to
   "no dial", and cost hours of false negatives.
5. **A drag handle that captures the pointer kills the buttons inside it.** The panel header is both
   the drag handle and the home of the collapse button; `host.setPointerCapture(pointerId)` retargets
   the later `pointerup` to the host, so the browser computes the `click` against the host and the
   button's own handler never runs. The button looks alive and does nothing (reported live
   2026-10-28, "I can't collapse the window"). `startDrag` now bails out when the pointerdown target
   is a `button` (panel.js), before the capture. Same shape of bug would hit any future header
   control, so the guard is on the drag handler, not on the one button.

## Next step

**First, the Space question.** [spacetest.js](spacetest.js) is the experiment: one key target per dial
(`window` → `document` → `body` → `canvas` → pointer control), pressing only at a ≥25° margin.
A dial always dies at ~15.7s on its own, so a press the game receives must end it early; the
pointer control proves whether the timing path itself works. Read `__spacetest.status().dials`,
stop with `__spacetest.stop()`.

Then:

1. Put a dial on screen and run `__fish.calibrate()`. It prints the exact RGB values and their
   angular extent at 0.4/0.5/0.62/0.74/0.86R.
2. Set `GRN` in `autofish.js` to the printed wedge colour, then confirm `covers` becomes true for
   a third of every rotation instead of 3 frames in 900.
3. Then answer the Space question with one clean test: play a dial to completion with presses and
   check whether the dial ends **earlier than 15.7s** or a coin total changes. Early end or coins
   up ⇒ Space works. Neither ⇒ dispatch Space to `document` and the canvas before concluding it is
   ignored, and fall back to `pressWith: 'pointer'`.

## Risk

Automation is almost certainly against lofi.town's rules and ban risk sits with the account. This
does client-side input only: no packet tampering, no memory editing, no fingerprint evasion, no
hidden-tab operation. It refuses to run while the tab is not visible precisely because pressing
into a frozen game is pure risk.
## 2026-10-29 a logged fish that looked lost, and a budget that reset itself

Four reports from a two-account, two-browser setup. Three were reproducible from the source alone.

**The rarity strip read all zeros while catches were being logged.** The Zen account's last-catch
line was `Tubenose Poacher · 0.49kg · 01:28 am` - no tier, which is exactly what `renderLog()`
prints whenever the tier is `Unknown`. The card printed no rarity (common fish do not), and
`Tubenose Poacher` was not in the 135-species catalogue, so `describeCatch()` returned `Unknown`.
The bundle had moved its seasonal fish into a second table, built through a helper that the
literal-object scan could not see. The ledger *was* writing the catch; the strip has eight cells and
`Unknown` had none, so a working log looked like a broken one. The last-catch line updating while all eight cells sat at 0
is the tell: both are written by the same `addToLog()` call.

The fix is small on purpose: a ninth `UNK` cell that only takes space when it has fish, an honest
`rarity unknown` in the last-catch line, and an `unknown` map in the ledger so the missing species
become a worklist instead of a silent pile. The catalogue was regenerated from the live bundle in
the same change: the seasonal fish are built through a helper (`n("Tubenose Poacher","Uncommon",.1,1)`)
and their gold comes from the bundle's own per-tier map, so the generator now reads both shapes.
181 species (135 base + 46 seasonal); Tubenose Poacher resolves to Uncommon (0.1-1 kg, 20 gold).

**"Sometimes it stops" is the 120-second hidden threshold.** A hidden page pauses at 5 s and *stops*
the session at 120 s (`HIDDEN_STOP_MS`), then cooldown, then idle. Sessions never chain, so a run
survives being away for under two minutes and dies if you are away longer. `Hidden stop` is now a
2-60 minute stepper, and `Chain runs` (off by default) restarts after the cooldown while the window
is open, the cap is unspent and the page is visible.

**The daily cap was server-only.** `loadToday()` set today's minutes to 0 on any fetch failure, and
`savePrefs()` never stored `todayMs` or `cooldownUntil`, so without fishserve a reload zeroed the
cap *and* bypassed the cooldown; with it, the two browsers each had their own view. The budget now
lives in `autofish:budget:v1`, flushed every 10 s and on every stop, merged with the server by
`max()` on mount, and rolled over at midnight. `stopSession()` folds the session into `todayMs`, so
a second session counts against what the first one spent instead of forgetting it.

**The ledger was keyed by origin, not account.** Two accounts in one browser shared one strip. The
key is now `autofish:log:v1:<profile>`, the pre-profile key migrates to `default` on first load, and
the panel has a profile picker plus `__fish.logProfile()`.

Verification: `node --test` = 137 pass / 0 fail, including new guards for the fold, chaining, the
hidden threshold, the unknown-species path, the seasonal catalogue rows and the budget merge.
`dist/autofish.user.js` rebuilt (182,477 bytes).

**Not fixed here: the Zen lag.** It needs a measurement from that machine, so the build ships
`__fish.perf()` (frame p50/p95 plus per-detector ms/s and share of wall time) rather than a guessed
throttle. A covered
window is `hidden` on both Chromium and Gecko; the README records the one occlusion setting that
helps and the cases that cannot be helped.

## 2026-10-29 the same dial search in a second browser: 38.8 ms, still a third of the thread

The Neo tab (Chromium, same Windows host) was running a build from before `perf()` existed - no
`__fish.perf`, 156 catches on the clock - so it could not be reloaded for a measurement. Attribution
came from wrapping the four detectors in place for 20 s and restoring them before the call returned;
that wrapper is now [scripts/perf-window.js](scripts/perf-window.js), the console path for any build
that predates the probe.

| Detector | Calls/s | ms/call | ms/s | Share |
|---|---|---|---|---|
| `findBubble` | 93.1 | 0.18 | 17 | 0.02 |
| `findCatch` | 93.1 | 0.26 | 24 | 0.02 |
| `lockDial` | 8.0 | **38.8** | **310** | **0.31** |

95.6 fps, p50 7.0 ms, p95 34.9 ms, worst 97.4 ms, `stats.errors` 0. `findBubble`'s 93 calls/s is the
rAF rate, so this loop runs one pass per frame, not on a timer.

The answer to "tune the scan throttles" is in the two cheap rows: 0.02 each, 41 ms a second between
them. There is nothing there to tune, and throttling them would trade correctness for noise. The dial
search is still 31% of the main thread on a machine that is twice as fast at it as the earlier tab
(38.8 ms against 83.3 ms) - every one of those 8 calls a second lands as a 35-97 ms frame, which is
what "feels laggy" looks like in a gap series. The fixed build's 4.2 ms is the only number that
changes it.

Not measured: the fixed build in Neo. Its dial path is the one already measured at 4.2 ms, and
reloading away a live 156-catch session to prove it would cost the run. The after-number on the
machine that reports the lag still needs one paste of the script above in that tab.

## 2026-10-29 the build now says which build it is

Two browsers, one userscript, and the same `@version 3.5.0` across a dozen landed changes: the Neo
tab was running code from before `perf()` existed and there was no way to tell from the panel.
`__fish.version` was a hand-typed `'autofish 3.0'` that had tracked nothing for several releases, so
the one field that could have answered the question was actively misleading.

The build now stamps `package.json`'s version into the core (`stamp()` asserts the placeholder
occurs exactly once, so a rename cannot silently ship `dev`), the panel head prints `v3.6.0` next to
the title, and `F.report()` carries the same string. `v3.6.0` is the first release number that covers
the dial-search fix, the shared snapshot, the local budget and the profile-keyed ledger - so the
number in a header now distinguishes a stale tab from a fixed one without a console inspection.

## 2026-10-29 the rest of `lockDial` on Zen: 33 ms -> 9 ms by removing the helper call

The Zen tab (Gecko) was on 3.6.0 and `__fish.perf()` put `lockDial` at **37.58 ms a call, 6.5 times
a second, 24.6% of the main thread** - the biggest line in the report, ahead of `sample` (11.2%),
`snapshot` (9.3%), `findCatch` (5.8%) and `findBubble` (4.9%). fps was 64.9, p50 12, p95 52, worst 70.

What the split actually was, measured in that page:

| Probe | Result |
|---|---|
| 240x240 readback alone, inside rAF, canvas animating | **8 ms** |
| the same read from an idle tick, canvas paused | 8.6 ms |
| read at 240, 120, 64 and 32 px | 8.6 / 7.4 / 7.6 / 7.1 ms - **flat, not area** |
| `rimMask` over the 240x240 buffer | 0.38 ms |
| the 99,000-sample search, inlined | 0.75 ms |
| the 99,000-sample search, through `rimHits` | ~22 ms of a 33 ms call |
| `lockDial` whole, inside rAF | 31-33 ms |

So the search arithmetic was never the cost on Gecko: 4,950 calls to `rimHits`, each counting 20
samples, cost more than the samples themselves. Deferring the read past the frame changed nothing
(30-33 ms either way), and shrinking the read changed nothing (flat cost), which ruled out both the
obvious ideas before any code was written.

**What changed.** The coarse scan in `F.lockDial` is inlined over the mask - same centres (15x15,
step 3), same radii (78..120, step 2), same 20 rim directions, same `hit >= 17` and same first-max
tie-break - so the geometry and the answer are unchanged. The 17-call refinement still uses
`rimHits`. `tests/perf.test.js` now pins the inline count and the 40-sample refinement instead of the
old per-circle helper call.

**Measured, same frame, same hint, both returning null:**

| | Calls | `lockDial` |
|---|---|---|
| 3.6.0, helper per circle | 4 | 31-33 ms |
| 3.6.1, inlined | 4 | **8-11 ms** |

That is the micro-benchmark on the live tab, not a reading of the loop. `node --test` is 140 pass.

### The end-to-end reading, and why the panel now carries it

A reading needs a console, and the Zen tab takes no synthetic keystrokes, so 3.6.1 also puts the
report on the panel: `fps / p50 / p95 / worst` above each detector's share of wall time in ms per
second, refreshed on the panel tick, with the full `__fish.perf()` JSON one click away. Both browsers
were then reinstalled from the build and reloaded (`__fish.version` and the panel head both read
`3.6.1`).

Zen (Gecko), 3.6.1, running and in front, ~20 s window:

| | 3.6.0, before the inline | 3.6.1, after |
|---|---|---|
| fps | 64.9 | 55.6 (66.9-72.7 in a second window) |
| p50 / p95 / worst | 12 / 52 / 70 ms | 15 / 46 / 78 ms |
| `lockDial` | 37.58 ms/call x 6.5/s = **24.6%** | **259.9 ms/s = 26.0%** |
| `snapshot` | 9.3% | 105.4 ms/s = 10.5% |
| `findBubble` | 4.9% | 54.5 ms/s = 5.5% (contains its snapshot) |
| `findCatch` | 5.8% | 76.4 ms/s = 7.6% |

The share did **not** fall. The expanded report, same session (`frames` 6864, `uptimeMs` 115141):

```
"lockDial": { "callsPerSec": 6.3, "msPerCall": 43.74, "msPerSec": 274.7, "share": 0.275 }
"snapshot": { "callsPerSec": 25.1, "msPerCall": 4.21, "msPerSec": 105.8, "share": 0.106 }
"findBubble": { "callsPerSec": 59.5, "msPerCall": 0.77, "msPerSec": 46, "share": 0.046 }
```

So the call rate did not rise (6.3/s against 6.5/s) and the per-call cost did not fall: **43.74 ms
against 37.58 ms on 3.6.0**. The 24.6% -> 7% projection is withdrawn; the end-to-end number after
the fix is 27.5%, i.e. slightly worse than the thing it was meant to fix.

That is the useful part of this reading: **the cost is not in the search.** By the in-page probe the
whole scan is `rimMask` 0.38 ms + inlined search 0.75 ms, about 1.1 ms of a 43.74 ms call, and the
240x240 readback was measured flat at 7-9 ms. Roughly 34 ms a call is therefore unaccounted for by
the parts that were measured, which is why the probe and the live loop disagree.

### Answered: the coarse scan owns the call, and it runs 20x slower in place

3.8.2 times the five phases inside `lockDial` itself (`perf().lockPhases`: memo / grab / mask /
scan / refine), so the parts are measured by the same clock that reports the total. Live Chromium,
3.8.2, 1117x785, 180 s, 8 catches attempted and 4 caught (`pressAcceptRate` 1.0, 0 lost), 104.5 fps,
frame p50 7 ms:

| phase | ms/call | share of `lockDial` |
|---|---|---|
| memo (remembered circle) | 2.49 | 7.1% (8 hits in 1,242 tries) |
| grab (240x240 readback) | 1.97 | 5.6% |
| mask (`rimMask`) | 0.17 | 0.5% |
| **coarse scan** | **30.28** | **86.5%** |
| refine (`finishLock`) | 0.10 | 0.3% (only runs when a dial is found) |

Total `lockDial` 35.02 ms a call at 6.9 calls/s, i.e. 241 ms/s = 24.1% of wall clock. So the missing
34 ms was the scan all along, and the earlier "0.75 ms" figure described the loop running somewhere
else, not the live call.

**The scan is slow because it is unoptimised in place, not because it does more work.** The same
loop, same 4,950 circles and 99,000 samples, over a 240x240 mask:

- as its own small function: **1.4 ms**; padded with 100 / 400 / 1,200 extra statements to rule out
  function size: 2.2-4.0 ms, so size is not the cause;
- as `F.lockDial` in the live tab: **32-36 ms**, single calls and in a burst of ten alike, and 100 ms
  at `span` 40 (about 4x the circles), so it scales with the work but at ~20x the cost per sample.
- a 20 s CPU profile agrees it is not attributable time: `getImageData` 27.1%, `lockDial` self-time
  8.9% (about 13 ms a call) against the 35 ms the wall clock reports - the loop is running far below
  its optimised cost and the profiler does not put the difference in JavaScript.

The next step was therefore **structural, not a rate cap**: lift the scan out of `lockDial` into its
own small function (the way `finishLock` already is) and re-measure the same phases. Capping the call
rate stays rejected - the 120 s shadow count above found dials the gate would have missed.

#### 3.8.3-3.8.5: the scan extracted, and still 30 ms (negative result)

`coarseScan` is its own function now; `lockDial` only grabs, masks, calls it and refines. Behaviour
and the 15/20 gate are unchanged, 179 tests. Live 3.8.3, same window, 180 s: scan **30.26 ms** a
call, `lockDial` 35.09 at 6.6/s = 23.1% - identical to 3.8.2's 30.28. **The extraction did not fix
anything.** What it did do is rule the loop out as the problem, one experiment at a time:

- the loop's own cost: the *same source*, eval'd fresh in the same page, is **2.26 ms**;
- the shipped instance with a *synthetic* 240x240 mask (3.8.4 exposed it for one build): **29 ms**,
  so the input is not the difference either - and 120 back-to-back calls never warm it up
  (30.3, 31.7, 32.3, 28.0 ms across four chunks of 20/20/40/40);
- function size: a bench function padded to 1,200 statements stays at 2.2-4.0 ms;
- closure-scope size: a function closing over 10 / 200 / 600 / 1,200 / 2,000 locals: 1.7-2.3 ms;
- a large injected `<script>`: 60 helpers plus tens of KB of padding in one IIFE, 1.7 ms at every size.

So the same code, page and buffer size differed by 13-20x, and the difference travelled with the
*instance* that lives in the installed userscript rather than with its inputs.

#### 3.8.6: compiled standalone, and it is fixed

The scan is now compiled at startup with `new Function("return (" + coarseScan.toString() + ")")()` -
same source, fresh small scope, no closure at all (the direction tables became parameters for this
reason). If a CSP refuses eval the call throws, the literal function is used and `perf().scanCompiled`
reports `false`. Same window, same 180 s protocol, 3.8.6 live with `scanCompiled: true`:

| | 3.8.5 | 3.8.6 |
|---|---|---|
| coarse scan | 30.26 ms/call | **0.95 ms/call** |
| `lockDial` | 35.09 ms/call = 23.1% | **5.91 ms/call = 4.2%** |
| fps | 104.5 | **134.9** |
| frame p95 | 35.5 ms | **9.6-10.8 ms** |

So the hypothesis held: the function was being kept out of optimised code by its compilation
context, and 0.95 ms is at the same 2.3 ms-or-better scale as the fresh eval, in a page doing more
frames per second. Fishing is unaffected - 1 caught, 8 presses, `pressAcceptRate` 1.0, 0 lost - and
no detector threshold, gate or scan rate was touched to get there.

**Long-run confirmation** (3.8.6, same window, one continuous session, bot running, sampled every
60 s, `scanCompiled: true` throughout):

| minute | caught / attempts | presses | acceptance | lost | fps | p95 | scan | `lockDial` |
|---|---|---|---|---|---|---|---|---|
| 1 | 5 / 5 | 25 | 1.0 | 0 | 139.0 | 9.3 | 0.98 | 6.20 |
| 2 | 7 / 7 | 36 | 1.0 | 0 | 133.0 | 11.3 | 0.99 | 6.25 |
| 3 | 9 / 9 | 46 | 1.0 | 0 | 132.0 | 10.9 | 0.99 | 6.24 |
| 4 | 9 / 10 | 52 | 1.0 | 1 | 135.5 | 10.1 | 0.99 | 6.21 |
| 5 | 10 / 11 | 57 | 1.0 | 1 | 139.0 | 9.2 | 0.99 | 6.15 |
| 6 | **12 / 13** | 67 | 1.0 | 1 | 132.8 | 11.0 | 1.00 | 6.21 |

12 caught of 13 attempts (92%), 5.6 presses a catch, `pressAcceptRate` 1.0 the whole way, 1 lost.
fps stayed 132-139 with p95 9-11 ms, and the scan never left 0.98-1.00 ms across 3,388 `lockDial`
calls (`lockDial` 4.1% of wall clock). Dial detection is therefore not just still working but
unchanged in rate - the memo hits 28 of 3,388 calls (0.8%), the same as the 0.6% measured before the
change, so the scan is finding the same dials it did at 30 ms.

#### 3.8.7: the remembered circle stops paying a readback it almost never uses

With the scan fixed the phase split inverted: memo 2.84 ms (43.8%), grab 2.21 ms (34.1%), scan
1.04 ms (16.0%). The memo is the `sample()` readback of the last locked circle, and `step()` asks
for a dial 4-6 times a second when there is nothing on screen - so it paid a full readback on 99.2%
of calls to answer 38 times in 4,611. A miss is also wasted work, because the search below repeats
the same read.

It is now tried at most once per `MEMO_EVERY_MS` (500 ms), and the report counts the skips
(`lockPhases.memo.skipped`). Controlled A/B in one page state, same synthetic remembered circle,
40 calls each:

| | `lockDial` | memo | scan |
|---|---|---|---|
| every call tries the memo (3.8.6) | 5.94 ms | 2.64 | 0.93 |
| gated at 500 ms (3.8.7) | **3.71 ms** | 0.00 | 1.02 |
| gated again | 3.82 ms | 0.06 | 1.04 |

About 2.2 ms off every dial check, and the phase split now reads grab-first as it should.

**Not yet validated in a live fishing session.** After the install reload the character came back
standing (`needsSeat: true`, 45 cast retries, none consumed), so no dial appeared and no reel was
run - the only numbers above are the controlled A/B. The risk is bounded by construction: a memo hit
returns the circle the search would have found anyway, and the case the memo actually protects - a
wrong hint - is still recovered within one gate interval. It still needs one seated session to say
so with a measurement rather than an argument.

Also note the memo: 8 hits in 1,242 calls (0.6%). The remembered circle almost never answers,
because the dial only exists while reeling, so it costs a full `sample()` on 93% of calls for a 7%
chance of skipping the scan. It is cheap enough to keep, but it is not the fast path it looks like.

Neo (Chromium) could not be read: its tab sat behind a full-screen video, and a covered tab is
throttled to about 1 fps by the compositor, so its `perf()` only describes the occlusion (14.8 fps,
p95 1002 ms, every detector near 0.0 ms/s). A covered tab is not a valid frame budget.

**Not the fix, checked and rejected.** Gating the scan on time since the last press looked like the
cheaper answer (a dial follows a press). A 120 s shadow count of the real calls: 791 scans, 4 dials
found, and one of those found **more than 20 s after the last press** - so the premise is false in
live play and the gate would have missed a dial. Left the check rate at `dialCheckMs` 150.

#### Re-confirmed after the 3.8.7 rollback (2026-10-30)

3.8.7 rate-limited the remembered-circle readback and was reverted the same day: it had only ever been
measured in a controlled A/B on one page state, and after its install reload the character was standing,
so no dial appeared and the release shipped unproven. The repo and the browser are back on 3.8.6. This
run answers the question that revert left open - does the released 3.8.6 still fish, and does it still
hit - in a real seated session rather than a synthetic one.

Chromium, 1117x785, 3.8.6 (`scanCompiled: true`), sampler inside the page every 60 s, 7 minutes:

| minute | caught / attempts | presses | acceptance | lost | fps | p95 | scan | `lockDial` |
|---|---|---|---|---|---|---|---|---|
| 1 | 2 / 2 | 11 | 1.0 | 0 | 137.2 | 9.3 | 0.89 | 5.84 |
| 2 | 1 / 1 | 5 | 1.0 | 0 | 136.1 | 9.9 | 0.89 | 5.82 |
| 3 | 1 / 1 | 12 | 1.0 | 0 | 123.1 | 9.6 | 0.89 | 5.73 |
| 4 | 1 / 2 | 5 | 1.0 | 1 | 138.9 | 8.6 | 0.88 | 5.68 |
| 5 | 0 / 0 | 0 | 1.0 | 0 | 135.4 | 10.6 | 0.89 | 5.66 |
| 6 | 3 / 3 | 16 | 1.0 | 0 | 136.9 | 9.7 | 0.89 | 5.68 |
| 7 | 0 / 0 | 0 | 1.0 | 0 | 139.2 | 9.2 | 0.89 | 5.69 |

8 caught of 9 attempts (89%), 49 presses (6.1 a catch), `pressAcceptRate` 1.0 with 89 accepted and 0
rejected presses, 1 lost. fps 123-139 with p95 8.6-10.6 ms, one 279 ms worst frame in the third minute.
`lockDial` 5.66-5.85 ms and the scan 0.88-0.90 ms across the run, memo hits 33 of 4,899 calls (0.7%).

Against the 3.8.6 signature run in the section above (12/13 = 92%, 67 presses, 5.6 a catch, acceptance
1.0, scan 0.99-1.00, `lockDial` 6.15-6.25) this is the same version behaving the same way: one fewer
catch in one fewer attempt, four more presses, and the scan marginally cheaper. Nothing regressed by
going back, so 3.8.6 stays the shipped release.

Two details worth keeping:

- **The seat flag can trip mid-run without ending it.** Minutes 5 and 7 sampled `needsSeat: true` while
  `running` stayed true - a 45 s gap with no prompt, dial or press tripped the watchdog, and the next
  cast cleared it (cast retries rose from 42 to 104 over the run, so the retry ladder was working the
  whole time rather than the game having gone quiet). The panel pauses the clock for those gaps; the
  fishing itself resumed.
- **The memo is the least useful readback in the call.** 33 hits in 4,899 calls (0.7%) for 2.66-2.77 ms
  of a 5.68 ms `lockDial`, i.e. the search is the cheap part and the remembered circle is what is left.
  That is the case 3.8.7 tried to make with a gate; it stays unlanded until a gate is measured seated.

#### 3.8.7 landed on evidence: the gate measured while fishing (2026-10-30)

The gate shipped once on a controlled A/B alone and was reverted the same day, because its install
reload left the character standing and no dial ever appeared. It is now re-landed (revert of the
revert) and measured in a session that was actually landing fish.

**Fishing is unchanged.** Session totals, 3.8.7, Chromium at 1117x785, `scanCompiled: true`,
`memo.skipped` reporting:

| | 3.8.6 (the validated release) | 3.8.7 (this session) |
|---|---|---|
| caught / attempts | 8 / 9 (89%) | **14 / 15 (93%)** |
| presses a catch | 6.1 | **5.6** |
| `pressAcceptRate` | 1.0, 0 rejected | **1.0, 0 rejected** |
| lost | 1 | 1 |
| fps | 123-139 | 111 |

Presses-per-catch matching 5.6 is the number that matters: a gate that delayed the remembered circle
past a reeling dial would show up as extra presses or rejected presses, and neither appeared (184
accepted, 0 rejected by the end of the session).

**The gate's own cost, as a 192 s delta window** on the same page (cumulative counters differenced so
the throttled stretch below is excluded), 5.95 `lockDial` calls a second:

| phase | 3.8.7, ms a call | 3.8.6, ms a call |
|---|---|---|
| memo | **1.06** | 2.66-2.77 |
| grab | 4.13 | 1.83 |
| mask | 0.46 | 0.44 |
| scan | 1.54 | 0.89 |
| refine | 0.32 | 0.28 |
| `lockDial` | 7.51 | 5.66-5.85 |

The gate skipped **76.3% of calls** (873 of 1,144). A memo attempt still costs 4.48 ms in this state, so
each skipped call avoids 4.48 ms: **3.42 ms a call, ~20 ms/s of main thread**. Ungated, the same window
would have spent 4.48 ms on every call and `lockDial` would have been 10.93 ms rather than 7.51.

**Do not read the absolute 7.51 against 3.8.6's 5.7 as a regression.** `grab` - a phase the gate cannot
touch - doubled from 1.83 to 4.13 ms, and `scan` from 0.89 to 1.54, because the browser window was not
focused: the page ran at 40 fps with 60-75 ms p95 frames, and a GPU readback queued behind the
compositor costs more there. `Emulation.setFocusEmulationEnabled` restored it to 111 fps for the
measured window, but the readback never returned to the 1.83 ms of the earlier run, so the fair claim
is the within-session one above: the gate's 3.5 ms a call, measured directly, not the absolute total.

**Decision:** keep. Catches, presses a catch and acceptance all match the validated 3.8.6 build while
the readback the gate targets fell by 73%, so 3.8.7 stays the shipped release.

#### 3.8.8: the memo now needs a dial on screen, and it earns nothing (2026-10-30)

3.8.7 stopped the memo from reading on every call, but it still spent one readback every 500 ms
between catches - to prove that a remembered circle is not a dial any more. 3.8.8 adds the other half
of the condition: an attempt also needs a dial to have been locked inside `MEMO_RECENT_MS` (2000 ms).
The skip reason is counted separately as `lockPhases.memo.cold`, so the two gates are visible apart.

Measured as one 399.6 s delta window (cumulative counters differenced, the method that survived the
unfocused-window episode last round), 136.8 fps, p95 9.5 ms, 6.68 `lockDial` calls a second:

| | 3.8.6 | 3.8.7 | **3.8.8** |
|---|---|---|---|
| memo attempts | every call | every 500 ms | **8 of 2,668 calls** |
| memo, ms a call | 2.66-2.77 | 1.06 | **0.008** |
| grab | 1.83 | 4.13 | 3.15 |
| scan | 0.89 | 1.54 | 1.21 |
| mask | 0.44 | 0.46 | 0.31 |
| refine | 0.28 | 0.32 | 0.16 |
| `lockDial` | 5.66-5.85 | 7.51 | 4.84 |
| caught / attempts | 8 / 9 | 14 / 15 | **11 / 11** |
| presses a catch | 6.1 | 5.6 | **5.1** |
| acceptance | 1.0 | 1.0 | **1.0, 78 accepted / 0 rejected** |
| lost | 1 | 1 | **0** |

The memo answered 3 of its 8 attempts. Across 2,668 calls it cost 22.2 ms in total: it is now a
rounding error rather than a phase. Everything else in the call fell with it, so this is not the
"faster but fewer fish" case the keep rule was written to catch - 11 attempts, 11 catches, no losses,
no rejected presses.

`grab` still differs between sessions (1.83 / 4.13 / 3.15 ms), which is why the absolute `lockDial`
column is read within a session rather than across them; the number that is directly comparable is
the memo's own, and it went from 2.7 ms to 0.008 ms a call over three releases.

**Decision:** keep. 3.8.8 is the shipped release.

One caveat for whoever reads this next: with a 2 s window the memo is effectively retired during
normal fishing, so it now only helps immediately after a dial is found. That is where it was ever
useful - but if a future game update makes the dial jump between presses, this is the first thing to
loosen, and `memo.cold` will show it.
