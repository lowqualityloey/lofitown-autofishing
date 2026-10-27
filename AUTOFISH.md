# AUTOFISH — lofi.town fishing bot

Status: **WORKING - presses land, fish are caught, and catch cards are auto-dismissed so it fishes continuously.**
"2026-10-27 findings" before trusting it for real fishing.

Note: **coins are not a valid success signal** — the counter does not move without the Cozy
subscription, so it stays at 5,484 whether or not anything is caught. Judge a press by whether the
dial ends early (see below), never by the coin total.

Run with BrowserOS neo on the lofi.town tab, with the neo window genuinely uncovered
(a covered window reports `hidden` and freezes the game).

## Run

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

The trigger keys on the arc **midpoint**, not on the pin being anywhere inside the arc:

    delta = 0 - mid                      signed distance from midpoint to pin
    pred  = delta + omega * leadMs/1000  where it will be when the event lands
    press when abs(pred) <= midDeg (6)   once per rotation; re-arms past 30 deg

At 125-140 deg/s, 25ms of lead is ~3.2 deg, so the press arrives with the green centred on the pin.
Sample radius moved to 0.69R (63px at R of ~91): the old 0.62R read the arc short and noisy.

Verify by **dial lifetime only**: a registered press ends the dial early (the one confirmed case was
4.64s against the natural 15.97s). A ~15.9s dial means the press missed or never arrived. The PRESS
log entries carry delta, pred, mid, width and omega so each attempt is auditable.

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
