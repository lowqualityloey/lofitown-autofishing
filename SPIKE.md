# SPIKE — lofi.town auto-fishing feasibility

Status: **spike complete, verdict conditional.** The mechanism is proven; an automated catch is not.
Date: 2026-10-27
Tab: page 9, `https://app.lofi.town/?ref=home_hero`

Everything below was measured live through BrowserOS neo. `spike.js` holds the working primitives.

---

## 1. Render stack

| Fact | Value |
|---|---|
| Engine | **PixiJS v8**, live `app`/`stage`/`renderer` reachable via `window.__PIXI_DEVTOOLS__` |
| Canvas | **two** stacked 1522×954 canvases, CSS 1:1, `devicePixelRatio` 1 |
| Game canvas | `app.render()` draws the **world only** — never the CAST!/REEL! bubbles or the dial |
| UI canvas | the second canvas holds the bubbles and the minigame; readable **only inside a rAF callback** (buffer discarded after compositing) |
| WebGL | `alpha: true`, `antialias: false`, **`preserveDrawingBuffer: false`** |
| Stage | 2 root children; CAST/REEL bubble is a `Graphics` node, `eventMode: static`, `cursor: pointer`, bounds 114×63 |

## 2. Readback — WORKS (the make-or-break item)

`preserveDrawingBuffer: false` normally blanks reads outside the render call. Bypassed:

```js
app.render();
ctx.drawImage(app.renderer.canvas, 0, 0);   // valid immediately after
ctx.getImageData(...)                        // 1,592,460 / 1,592,460 pixels returned colour
```

A crop drawn **without** a preceding `app.render()` came back solid black — that trap cost one round.

## 3. Input — synthetic events DO drive the game

| Path | Result |
|---|---|
| Trusted CDP click (`act click_at`) | Works, maps 1:1 to CSS pixels (requested 600,20 → clientX/Y 600,20, `isTrusted` true) |
| Synthetic `PointerEvent` on `document.elementFromPoint(x,y)` | **Works** — pressing a bubble makes it vanish and starts the cast; confirmed repeatedly |
| Node hit areas (`n._events.pointerdown`) | **Unreliable** — nodes report `eventMode: 'passive'` with empty `_events`, so the scene graph cannot be used to find clickable things. Pixi still hit-tests the canvas, so canvas-level pointer events work regardless |
| Dispatched `KeyboardEvent` (Space) | **Unproven** — see AUTOFISH.md |

This settles the decisive question: the dial can be driven at frame rate from inside the page.

## 4. Frame budget — no problem

| Run | Frames | Duration | Rate |
|---|---|---|---|
| Render + 520×520 region sample | 1067 | 11.0s | ~97 fps |
| Same with a 3,000-node scene walk every 250ms | 2225 | 26.0s | ~85 fps |

Plenty of headroom against the 16.7ms budget.

## 5. Dial geometry — measured on the UI canvas (superseded v1 guesses)

A live dial locks at centre **(863, 371)** — the bubble centre plus ~53px down — with outer radius **83–90**. It lives on the **UI canvas**, not the game canvas, and must be read inside a rAF callback.

| Feature | Value |
|---|---|
| Lifetime | ~**15.7s** unpressed, then it vanishes on its own |
| Rim | light grey, saturation ≤ 22, luminance 158–246, alpha > 60 |
| Pointer | **orange, fixed at 12 o'clock**, sitting on the rim |
| Wedge | the **saturated** region, ~45–115° as measured; only ~35 luminance above the disc base |
| Rotation | fast and variable — ω observed from **−220°/s to +746°/s** |

**Corrections to the earlier read:**

- The dial is not centred on the bubble (earlier note said (867,333)); it sits ~53px lower.
- The wedge is not two 180° halves. It is a ~60–115° moving sector on a static base.
- **Luminance cannot separate base from wedge** — that produced a width that wobbled 45–115° and a pin that read as covered on 3 frames in 900. Saturation/hue (`g >= r` and `g > b + 12`) separates them cleanly and rejects the red-dominant pointer.

With ~60–115° of coverage and rotation of several hundred degrees per second, the press window is roughly 100–300ms: comfortably wide for a frame-rate loop, but not wide enough for anything driven over a tool-call round trip.

## 6. Detector failures (worth not repeating)

1. **Bounding box of all grey pixels** — fused with the boat funnel, centre drifted to (924, 522). Fired 42 clicks at world coordinates for 11s. No character movement resulted (clicks during the dial appear to be absorbed by the minigame), but this is exactly the class of bug that must not ship.
2. **Single grey ring at r = 86** — sampled the rim's dark outline, matched 1 of 8 points on a real dial.
3. **Requiring a non-grey centre** — the hub is pale grey, so this rejected every real dial and produced zero presses.

None of these are fundamental; all three are fixable by testing radii 62–84 and accepting two-tone interior variance.

## 7. Operational constraints (confirmed, not theoretical)

- A **hidden tab freezes the game completely**: `ticker.lastTime` does not advance over 450ms, frames are byte-identical. Chrome reports a *covered* window as hidden, so neo must be genuinely uncovered. `window.focus()`, `hover_at` and trusted clicks do not raise it.
- The neo MCP session died once mid-run (HTTP 404 `Session not found` on every call) and needed a reconnect.
- Bite latency is variable: observed at **4.8s** once, and **>19s** twice. A per-call loop loses these windows; the loop has to live in the page.
- CAST and REEL are the **same node geometry** and the label is not exposed as text, so state must come from timing or pixel diffing, not from the node.

## 8. Verdict

**Mechanism: GO.** Readback, synthetic input, frame rate, coordinate mapping and the dial's design all check out.

**End-to-end: NOT PROVEN.** The go/no-go bar in the approved plan was ~3 of 5 casts landing. Reality: zero automated catches, because the detector rejected the dial every time it was open. I am not going to call that a pass.

What that means: the hard, uncertain, "is this even possible in a browser" part is answered yes. The remaining work is ordinary engineering on one function (dial localisation) plus a state machine, not a feasibility question.

### Next step (small)
1. Reseat at the pier, hands off ~3 minutes.
2. One in-page run with the corrected detector (radii 62–84, two-tone interior, no hub assumption) that logs every frame's geometry and every press.
3. Confirm one catch card, then run 3 casts and count results.

If step 3 lands fish, the spike is a full GO and the real build proceeds on the same primitives in `spike.js`.

## 9. Cost/limits note

Client-side input only: no request tampering, no memory injection, no multi-accounting, no fingerprint or proxy evasion, no hidden-tab operation. Automation is almost certainly against lofi.town's rules and ban risk sits with the account. The 42 stray clicks are a concrete example of why every press must be gated behind high-confidence dial detection and confined to the dial centre.
