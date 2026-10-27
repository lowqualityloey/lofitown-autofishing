# lofi.town AutoFish

A local userscript that plays the lofi.town fishing loop: it finds the **CAST!** prompt, reels when
the game asks, presses the spinning dial at the moment the wedge crosses the pin, and keeps a local
catch ledger. One file, no server, no account.

```
Tampermonkey -> paste dist/autofish.user.js -> save -> open app.lofi.town -> sit by the water -> Start
```

## What it does

- **Finds the prompts in pixels.** The fishing prompts and the reel dial are drawn on the game's UI
  canvas, not in the scene graph, so they are located by reading that layer inside
  `requestAnimationFrame` and matching shapes.
- **Presses the dial on a timer.** The wedge's rotation rate is fitted by least squares over the last
  ~200 ms of frames, the crossing is predicted, and a `setTimeout` dispatches one pointer click at
  the dial centre at that moment. Frames re-plan and cancel the timer; the press lands inside the
  measured arc, so a fast or slow spin both work. One press per triangle, re-armed when the game
  spawns the next one.
- **Scores fish, not clicks.** A win is only counted when the catch card's text parses to a species.
  One fish is many presses (the game shows a level bar), so the unit is the *fish attempt*: it opens
  on the first press and closes on a catch or when the cast prompt comes back.
- **Panel.** Session length, cooldown, daily cap, optional clock window, live counters, a rarity
  strip and the last catch. Runs the session reducer; pause is not a stop.
- **Ledger.** `localStorage` key `autofish:log:v1`: per species count and best weight, per rarity and
  per day totals, shiny/golden variants, plus `__fish.log()`, `__fish.logCsv()` and
  `__fish.logReset()`. Rarity comes from the printed card when it prints one, otherwise from an
  embedded catalogue of 135 species flagged `derived: true`.
- **Honest pauses.** A hidden tab pauses the clock. So does standing up: fishing in lofi.town only
  starts from a seat, so an unseated character cannot bite; the session pauses instead of spending
  its budget, resumes when a prompt comes back, and gives up after 30 minutes.

## Install

**The one-file way (recommended).** Install [Tampermonkey](https://www.tampermonkey.net/), open its
dashboard, create a new script, paste [dist/autofish.user.js](dist/autofish.user.js), save. Then open
<https://app.lofi.town/>, sit on a chair by the water, and press **Start** on the panel. The core, the
panel and the session reducer are all inside that one file.

**The server way (optional).** Needed only if you want session records on disk and the
`/sessions`/`/diag` endpoints.

```bash
./run.sh          # picks a free port, prints the install URL and the bookmarklet
```

Open the printed URL and drag the bookmarklet to your bookmarks bar, or run it in the console on
`app.lofi.town`. The panel appears bottom-left. A stale server on the same port is the usual cause of
"it is running old code" - compare `curl -s localhost:8731/autofish.js | wc -c` with
`wc -c autofish.js`.

## Panel

- Drag by the header; **−** collapses it to a 48 px pill, click the pill to restore.
- Steppers: session length (5 min - 12 h), cooldown (1 min - 2 h), daily cap (30 min - 24 h),
  optional clock window.
- Footer carries the one thing you need to know: `nothing to bite` (sit down), `log offline`
  (fishserve is not running; the session still works), or the stop reason.

## How well does it fish?

Measured on the multi-press build: **28 caught / 30 fish attempts** (Wilson 95% CI 78.7-98.2%),
159 presses, 5.68 presses per catch, 0 ghosts, 0 missed presses, 84 fps. Both losses were scored
"cast prompt"; at least one showed a shape-accepted card that never produced parsed text, so treat
93.3% as a lower bound. Per-band at that sample: fast (300-500 deg/s) 25/27, blur (>500 deg/s) 3/3.

## Limits and failure modes

- **The tab must stay visible.** The game freezes its own timers and the bot stops stepping when the
  page is hidden. Keep it on screen and the machine awake.
- **The character must sit itself.** The bot will not move or seat your character; seats are world
  objects. If it is unseated the panel says so and the clock pauses.
- **The game can still win.** Secret and legendary fish need many presses inside a tight clock; a
  missed click costs the previous gain and the streak.
- **One tab, one copy.** Loading the userscript twice mounts two panels and two reducers; reload to
  get back to one.
- It is automation of an online game. That can break a game's terms - your call, your risk.

## Development

```bash
node --test            # 110 tests (never "node --test tests/")
node build-userscript.js   # rebuild dist/ after editing autofish.js, panel.js, session.js, layout.js
```

Dependency-free CommonJS plus browser globals; no bundler, no linter. A test fails if
`dist/autofish.user.js` is stale, so always rebuild before committing. The userscript is verified
byte-identical to the sources it inlines.

| Path | What lives there |
| :--- | :--- |
| `autofish.js` | the whole bot: dial detection, planner, press dispatcher, ledger, telemetry |
| `panel.js` | the in-game panel (closed shadow root), panel-only behaviour |
| `session.js` | pure session reducer: phases, caps, window, pause reasons |
| `layout.js` | panel placement math against the game's live exclusion rects |
| `fishserve.js` | optional local server: static assets, `POST /catch`, session records, `/diag` |
| `build-userscript.js` | inlines the four browser files into `dist/autofish.user.js` |
| `scripts/gen-catalogue.js` | regenerates the embedded species catalogue from a saved game bundle |
| `tests/` | `node:test` suites, including source guards that fail on regressions |
| `AUTOFISH.md` | the living lab notebook: every measured fact, fix and withdrawal |
| `docs/` | state tracker, specs, task records, reviews |

## Documentation

- [AUTOFISH.md](AUTOFISH.md) - the design record and every live measurement, in order.
- [docs/STATE.md](docs/STATE.md) - current position, decisions, next actions.
- [docs/specs/](docs/specs/) - approved specs (in-game panel, catch log).
- [docs/tasks/](docs/tasks/) - task records with acceptance criteria.
- [docs/reviews/](docs/reviews/) - verification reviews.

## Licence

MIT - see [LICENSE](LICENSE). Not affiliated with lofi.town.
