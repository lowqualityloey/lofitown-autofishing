# AutoFish — the event card that froze the run, 2026-10-27

Symptom, reported by the user twice: fishing stops dead while a catch card is on screen. First a
Whale Shark (epic, pink frame), then a Nessie (event card, green frame, ribbon, 2.7 t). The panel
kept counting down, the page kept drawing ~57 fps, and the counters stopped: catches 202, presses
509, dials 818, no new log line after `card by shape@614,520`.

## What the pixels said

Measured with `__fish.captureUI()` and an in-page decode of the UI layer (the card was still up):

- the card body is fully opaque — (249,238,208) paper, (207,197,184) plate, (250,198,144) ribbon,
  (140,189,166) frame, every sample alpha 255;
- at quarter scale the card is ~84x100 cells, and 11,665 of 78,540 cells are opaque;
- **but the connected opaque blob was 700x576 at 46% fill**, not card-sized.

The cause is the event card's illustration: the Nessie artwork is drawn far outside the frame. The
blob detector joined card and artwork into one component, the bounding box grew to the artwork, the
fill fraction fell under the 55% threshold, and `findCatch()` returned null on a card that was
plainly on screen. A card blocks the next cast, so the loop then had nothing to do: it was not
crashed, it was blind, which is why every counter froze while frames kept climbing.

## The fix

`autofish.js` card shape pass, rewritten from "largest connected opaque blob" to "largest solid
opaque rectangle":

1. one quarter-scale read, then an integral image of opaque pixels (alpha > 250);
2. the best solid seed of the smallest card size (180x250 CSS px) — seed fill must be >= 94%;
3. grow the seed while the whole rectangle stays >= 88% opaque, bounded by the largest card
   (760x820) and by 70% of the layer (an opaque layer is not a card);
4. require ink inside the final rectangle (a card always prints text) and keep the box within
   card bounds;
5. **tap the seed's centre**, not the grown box's centre — the seed is inside the frame by
   construction, while the grown box can lean into spilt artwork.

`cardAnywhere()` (the second cream-coloured pass that the shape pass subsumed) was deleted, so
`findCatch()` is now `cardInBox() || cardByShape()`: the cheap fixed-box test first, the robust
scan second. One fewer duplicate path to keep correct.

## Verified live

BrowserOS neo, `https://app.lofi.town/`, viewport 1234x1023, the same Nessie card still on screen:

| Check | Result |
|---|---|
| New `findCatch()` sees the card it used to miss | pass — `{via:'shape', cx:658, cy:414, w:356, h:472, frac:0.88}` |
| A real click at the reported point dismisses it | pass — card gone, later probes return null |
| The loop keeps fishing afterwards | pass — 25 s: bubbles 7→10, dials 17→28, dials closed 28/28, presses 11→18, errors 0 |
| Cards are recognised and tapped away during the run | pass — `card by shape@614,450`, `@586,422`, `@590,454`, each followed by dismissal |
| Catches keep being parsed and logged | pass — Eel 2.78kg, Herring 0.71kg, Bass 5.47kg |

Unit tests: `node --test` → 34 pass, 0 fail.

## Not verified

- The Nessie card itself under the **new** code: it was dismissed with a real click first, so the
  new pass has only been seen on the cards that followed it. The pixel evidence (the 46%-fill blob)
  is what ties the failure to the code that was replaced.
- The other event/exotic card layouts. The solid-rect test is layout-agnostic on purpose, but a card
  smaller than 180x250 or a layer that is itself fully opaque are the two ways it can still miss.
