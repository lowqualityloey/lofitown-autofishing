# AUTOFISH — lofi.town fishing bot

Status: **WORKING - presses land, fish are caught, and catch cards are auto-dismissed so it fishes continuously.**
"2026-10-27 findings" before trusting it for real fishing.

Note: **coins are not a valid success signal** — the counter does not move without the Cozy
subscription, so it stays at 5,484 whether or not anything is caught. Judge a press by whether the
dial ends early (see below), never by the coin total.

Run with BrowserOS neo on the lofi.town tab, with the neo window genuinely uncovered
(a covered window reports `hidden` and freezes the game).

## Run

The normal way, one command:

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
  60 min, 30 min, 4 h.
- **Clock window** — optional "only fish between HH:MM and HH:MM"; times move in 15-minute steps and
  the stop time wins over the duration.
- **Start / Stop** — one button. Every Stop starts the cooldown; a pause does not.
- **Meters** — time left, catches this session, presses this session, and today's total against the
  daily cap.

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
