# lofi.town AutoFish

A single-file userscript that plays the lofi.town fishing loop for you: it finds the **CAST!** prompt, reels when the game asks, and presses the spinning dial at the moment the wedge crosses the pin.

![AutoFish running in lofi.town](docs/images/in-game.jpg)

No server, no build step, no account. One file in Tampermonkey and a **Start** button.

---

## Install (about two minutes)

**What you need:** Chrome, Edge or Firefox on a desktop, and the game open at <https://app.lofi.town/>. A phone will not work - there is nowhere to install a userscript.

### 1. Add Tampermonkey

Install the [Tampermonkey](https://www.tampermonkey.net/) extension from your browser's extension store, then pin it to the toolbar so you can see it.

### 2. Add the script

Open [dist/autofish.user.js](dist/autofish.user.js), click **Raw** (top right of the file view), and Tampermonkey opens its install page - press **Install**.

No Raw button? Open the Tampermonkey dashboard, click **+** (new script), delete the template, paste the whole file, then press **Ctrl+S**. The panel, the bot and the session clock are all inside that one file.

### 3. Open the game and reload

Go to <https://app.lofi.town/> and press **F5** so the script runs on a fresh page. Within a few seconds the AutoFish panel appears in the top-left corner.

![The AutoFish panel](docs/images/panel.jpg)

### 4. Sit on a chair by the water - do this before Start

lofi.town only offers the cast prompt to a **seated** character, so click a chair, bench or stool at the water's edge and wait for the game's own **CAST!** prompt to appear once.


The bot never moves or seats your character: seats are world objects it cannot click meaningfully. If you are not seated it says so on the panel and pauses the clock instead of burning your session.

### 5. Press Start

Press **Start** on the panel. The badge flips to **RUNNING**, `presses` starts climbing, and the rarity strip fills in as fish are caught.

### Nothing happened?

| What you see | What it means |
| :--- | :--- |
| No panel at all | The script is not running on this page. Check the Tampermonkey icon shows a **1** for lofi.town, then reload with F5. |
| Panel says **IDLE** after Start | The game page is hidden, paused, or the character is not seated. Bring the tab to the front. |
| Footer: *clock paused - nothing to bite* | The character is standing. Sit by the water; the session resumes on its own. |
| Two panels stacked | The script got loaded twice (a second copy, or an old console injection). Reload the page. |
| Counters climb, no catches | The rod is out but nothing bites: usually a missed reel prompt. Press Stop, sit again, Start. |

---

## The panel

- **Session / Cooldown / Daily cap / Clock window** - how long it fishes, how long it rests after, how much game time it may spend per day, and an optional time-of-day window.
- **Hidden stop / Chain runs / Profile** - how long the page may stay hidden before the session ends, whether the next session starts itself after its rest, and which catch history this account uses.
- **left / catches / presses / today** - session time remaining, catches this session, dial presses, game time spent today against the cap.
- **Rarity strip** - catches per rarity from the local ledger (`COM UNC RAR EPI LEG SEC HAL CHR`), plus `UNK` when the card printed no tier and the species is not in the built-in catalogue.
- **Last catch** - species, weight, rarity (a leading `~` means the rarity came from the built-in catalogue because the card printed none), and the local time.
- Drag by the header to move it; **-** collapses it to a 48 px pill, click the pill to restore it.

## What it actually does

- **Finds prompts in pixels.** The prompts and the reel dial are drawn on the game's UI canvas, so they are located by reading that layer inside `requestAnimationFrame` and matching shapes.
- **Presses the dial on a timer.** Rotation is fitted by least squares over the last ~200 ms, the crossing is predicted, and a `setTimeout` clicks the dial centre at that moment. Frames re-plan and cancel the timer, so fast and slow spins both land inside the arc.
- **Remembers the dial.** The reel widget's circle is saved per canvas size and tried before any search. If the hint is wrong, one whole-surface pass finds the green wedge and recovers the lock - a fresh run no longer needs a prompt to find its first dial.
- **Scores fish, not clicks.** One fish is many presses (the game shows a level bar), so the unit is the *fish attempt*: it opens at the first dial lock and closes at a parsed catch or when the cast prompt returns. A win is only counted when the catch card's text parses to a species.
- **Keeps a ledger.** `localStorage` key `autofish:log:v1:<profile>`: per-species count and best weight, per rarity and per day totals, shiny/golden variants, and the names of any species the catalogue did not recognise. One profile per account, so two accounts in one browser never share a history.
- **Pauses honestly.** A hidden tab pauses the clock, and so does standing up; the session resumes when a prompt comes back and gives up after 30 minutes unseated.

## How well does it fish?

Measured on the current build: **28 caught / 30 fish attempts** (Wilson 95% CI 78.7-98.2%), 159 presses, 5.68 presses per catch, 0 ghosts, 84 fps. Both losses were scored "cast prompt", and at least one showed a shape-accepted card that never produced parsed text - so read 93.3% as a floor, not a promise.

Per-press timing is scored by whether the game spawned a new triangle (a press it acted on), not by whether the dial closed - only the finishing press can do that. Read `__fish.status().accuracy.pressAcceptRate`; it is newer than the sample above.

## Limits

- **The tab must stay visible.** The game freezes its own timers when hidden, and the bot stops stepping. A covered window counts as hidden in both Chrome and Firefox; see [Keeping it running](#keeping-it-running-background-tabs) for the one case that can be fixed. A real overnight run also needs the machine awake.
- **You seat the character.** Nothing else can.
- **The game can still win.** Legendary and secret fish need many presses inside a tight clock; a missed click costs the previous gain and the streak.
- **One tab, one copy.** Loading the script twice mounts two panels.
- It automates an online game, which can break that game's terms. Your call, your risk. Not affiliated with lofi.town.

## Keeping it running (background tabs)

The game draws on `requestAnimationFrame` and keeps its fishing clock in page time, so a page the
browser treats as **hidden** stops fishing whatever the bot does. That is a browser rule, not a
setting in AutoFish:

| What you do | What the page sees | Can it be helped? |
| :--- | :--- | :--- |
| Switch to another tab | `hidden` | No. |
| Minimise the window | `hidden` | No. |
| Cover the window with another app | `hidden` | Yes: turn off window-occlusion tracking. |

Turning occlusion tracking off keeps a **covered** window rendering:

- **Zen / Firefox** - `about:config` -> `widget.windows.window_occlusion_tracking.enabled` -> `false`.
- **Chrome / Edge** - launch with
  `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`, or set
  the `WindowOcclusionEnabled` policy to `0` (Edge: `SOFTWARE\Policies\Microsoft\Edge`).

The simplest reliable setup is a window that stays on screen: move the game tab into its own window
and leave it uncovered. The panel pauses the clock when the page hides; **Hidden stop** sets how
long it may stay hidden before the session ends (2-60 min, default 2). Switching tabs or minimising
the window is not recoverable - no page gets frames while it is hidden.

## Nerd corner

In the browser console on app.lofi.town:

```js
__fish.version     // which build this tab is running (stamped from package.json)
__fish.status()    // running, dials, presses, per-band and per-arm accuracy
__fish.log()       // the catch ledger summary
__fish.logCsv()    // the same ledger as CSV
__fish.logProfile()        // the catch history in use
__fish.logProfiles()       // every profile this browser has
__fish.perf()      // fps, p50/p95 gap, and per-detector ms/call, ms/s and share
__fish.opts        // press timing, windows, retry ladders (live-editable)
```

`__fish.perf()` is the measurement any tuning has to come from: `rates.<detector>.share` is the
fraction of wall time that detector spent on the main thread (`findBubble` includes its `snapshot`).
It only records while the bot is running, so read it mid-session. The same version is printed in the panel header (`v3.6.0`, or `dev` for the unbundled bookmarklet path), so a stale install is visible without opening the console.

On a build older than `perf()` the console has no probe. Paste [scripts/perf-window.js](scripts/perf-window.js) instead: it wraps the four detectors for 20 s, prints the same table (and puts the originals back), so a stalled tab does not have to be reloaded to be measured.

## Optional: the server path

Only needed if you want session records on disk and the `/sessions` and `/diag` endpoints.

```bash
./run.sh    # picks a free port, prints the install URL and the bookmarklet
```

Open the printed URL, then drag the bookmarklet to the bookmarks bar (or run it in the console on the game page). A stale server on the same port is the usual cause of "it is running old code" - compare `curl -s localhost:8731/autofish.js | wc -c` with `wc -c autofish.js`.

## Development

```bash
node --test                # 179 tests; note: never "node --test tests/"
node build-userscript.js   # rebuild dist/ after editing any browser file
```

Dependency-free CommonJS plus browser globals; no bundler, no linter. A test fails when `dist/autofish.user.js` is stale, so rebuild before committing.

| Path | What lives there |
| :--- | :--- |
| `autofish.js` | the whole bot: dial detection, planner, press dispatcher, ledger, telemetry |
| `panel.js` | the in-game panel (closed shadow root) |
| `session.js` | pure session reducer: phases, caps, window, pause reasons |
| `layout.js` | panel placement math against the game's live exclusion rects |
| `fishserve.js` | optional local server: static assets, `POST /catch`, session records |
| `build-userscript.js` | inlines the four browser files into `dist/autofish.user.js` |
| `scripts/gen-catalogue.js` | regenerates the embedded species catalogue from a saved game bundle |
| `tests/` | `node:test` suites, including source guards that fail on regressions |
| `AUTOFISH.md` | the lab notebook: every measured fact, fix and withdrawal |
| `docs/` | state tracker, specs, task records, reviews |

## Documentation

- [AUTOFISH.md](AUTOFISH.md) - design record and every live measurement, in order.
- [docs/STATE.md](docs/STATE.md) - current position, decisions, next actions.
- [docs/specs/](docs/specs/) - approved specs. [docs/tasks/](docs/tasks/) - task records.
- [docs/reviews/](docs/reviews/) - verification reviews.

## Licence

MIT - see [LICENSE](LICENSE).
