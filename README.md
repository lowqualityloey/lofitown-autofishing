# lofi.town AutoFish

A one-file AutoFish for [lofi.town](https://app.lofi.town/) - no server, no build step, and no console paste to install. Install it in Tampermonkey and press **Start**.

![AutoFish running in lofi.town with Flow mode and Local capture](docs/images/in-game.jpg)

## Status

**Actively maintained.** Current release **3.9.73** ([public release](https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/tag/v3.9.73)) · **full test suite passing** on 2026-11-28 · [MIT](LICENSE)

Requires a desktop Chrome, Edge or Firefox browser with [Tampermonkey](https://www.tampermonkey.net/), the game open, and a character you can seat.

## Why this one

- **One file, no server to fish.** The userscript contains the bot, panel, session clock, ledger and settings. `fishserve` is optional and only adds overnight capture.
- **It installs from a fixed, public URL.** The recommended userscript install needs no build step, no bookmarklet and no GitHub account; Tampermonkey checks the release URL and keeps your settings.
- **It pauses instead of pretending.** A hidden tab or a standing character pauses the session; after the hidden-tab limit (2 minutes by default) the session ends. The banner names the reason and the next step, and after three minutes with no prompt or dial on a visible page it says to reload the game tab and sit by the water. The diagnostics panel reports what the bot can see.
- **The evidence stays local.** Catch history, profiles and daily time budgets live in your browser. The optional server receives snapshots, not gameplay control.

The obvious alternatives are doing the loop manually or using another lofi.town automation bot. AutoFish is for a desktop browser you can leave visible: it adds a panel and local ledger, keeps the bot in one userscript, and needs no server or build step. Use manual fishing or another tool if you need mobile or headless operation, cannot leave the window uncovered, or do not want to take the automation risk.

**Fit:** this is a JavaScript browser userscript, not a library or SDK, for desktop Chrome, Edge or Firefox with Tampermonkey. The code is MIT-licensed. It does not support mobile or headless operation.

## Install and first catch

**You need:** a desktop browser, Tampermonkey, the game open at <https://app.lofi.town/>, and a character you can seat. Phones are not supported.

1. Install Tampermonkey and pin it to the toolbar.
2. Open the stable release URL and let Tampermonkey install it:

   ```text
   https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/latest/download/autofish.user.js
   ```

3. Reload the game with **F5**. The AutoFish panel appears in a free corner, usually top-left.
4. Click a chair, bench or stool at the water's edge and wait for the game's own **CAST!** prompt. The bot cannot seat you.
5. Press **Start** on the panel. The badge changes to **RUNNING** and `presses` starts climbing.

There is no shell command for the basic install; step 2 is the URL. After installation, verify it with the panel header (`v3.9.73`) or this browser-console command:

```js
__fish.version
// 3.9.73
```

### Nothing happened?

| What you see | What it means |
| :--- | :--- |
| No panel | The script is not running. Check the Tampermonkey icon shows **1** for lofi.town, then reload. |
| **IDLE** after Start | The page is hidden, or the character is not seated. Bring the tab forward and sit by the water. |
| Footer: *clock paused - nothing to bite* | The character is standing. Sit down; the session resumes. |
| Counters climb, no catches | Usually a missed reel prompt. Press Stop, sit again, then Start. |
| Amber capture line | The optional fishserve stopped, crashed or moved. Fishing still works; restart it or click the line to enter the current origin. |
| Banner: *paused 14:32 · the tab was hidden · bring the tab back* | The banner names why the run paused and the next step: you paused it, the tab was hidden, the character was standing, a focus session, no bite for 10 minutes, the cast never landed, a nearby player blocked the spot, a profile was open, or a fishing result never arrived. |
| Banner: *detector blind for 3 min — reload the game tab, then sit on a chair by the water* | No CAST!/REEL! prompt or dial has been seen for three minutes on a visible page. Reload the game tab once, then sit by the water; the next prompt or dial clears the warning. |
| Badge says RUNNING but the timer is not moving | The watchdog revives a stopped core on its own. If it keeps happening, reload the game tab. After three revives in ten minutes the run stops instead of looping, and the session row records the guard diagnostics. |

## What is AutoFish?

The bot reads the game's rendered frames to find the **CAST!** and **REEL!** prompts, then presses the spinning reel dial at the moment the wedge crosses the pin. It uses a predicted crossing, re-arms after a proven new triangle, and falls back to a full-surface search if its remembered dial is wrong. Detection runs inside a wrapper around the renderer, because the prompts are painted into the game's canvas.

The panel keeps everyday controls on its surface (`Start / Pause`, `Stop`, elapsed/remaining timer, catches, presses, today's time) plus **Catch history** with clickable `LEG` / `SEC` / `shiny·golden` trophy card previews (saved for 24h in IndexedDB) and 1-click **`↓ CSV`** export. The panel header also checks GitHub Releases every 6 hours and turns green when an update is available (click to update in Tampermonkey). **Session & guards** holds **Mode (`Flow` / `Timed`)**, **Stop when hidden**, **Cozier popup**, **Pause in focus sessions**, **Resume after reload** (also enabling bounded <=2/h recovery from `waiting-for-result` game locks), **Rare catch chime** (Web Audio alert for Legendary, Secret, Shiny, and Golden catches), **Local capture**, and **Profile**. (Console power users can still toggle `fastFirstPress` via `__fish.tune({ fastFirstPress: true })`.)

**Diagnostics** shows fps, frame times, accuracy, and detector cost. Drag the header to move it; the **-** control collapses it to a small pill.

![The AutoFish panel showing Flow mode, Local capture, and live diagnostics](docs/images/panel.jpg)

The local ledger tracks per-species counts and best weights, rarity totals, 60 day buckets, and per-profile daily budgets. It never requires the server. Historical field runs give a sense of the floor: the 3.9.27 run recorded 145 attempts, 144 catches (99.3%), 777/777 accepted presses, 258 dial hits and 0 misses; the 3.9.15 baseline was 126/133 (94.7%). These are measurements of those builds, not a guarantee for 3.9.73. The full records and caveats are in [AUTOFISH.md](AUTOFISH.md).

## Limits and requirements

- **The tab must stay visible.** The game freezes its own timers when the page is hidden. Switching tabs or minimising cannot be helped. A covered window can sometimes be kept alive by turning off occlusion tracking:
  - **Firefox / Zen:** set `widget.windows.window_occlusion_tracking.enabled` to `false` in `about:config`.
  - **Chrome / Edge:** launch with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`, or set the `WindowOcclusionEnabled` policy to `0`.
- **You seat the character.** The bot cannot click a world object to sit for you.
- **The game can still win.** Legendary and secret fish need several presses inside a tight timer; a missed click costs the previous gain and zeroes the streak bonus.
- **One tab, one copy.** Loading the script twice mounts two panels.
- **Overnight capture needs the optional server.** Fishing works without it; the night simply is not recorded.
- **Automation can violate the game's terms.** This is not affiliated with lofi.town. Your account, your risk.
- **Desktop is the supported setup.** Phones are not supported or tested.

## Optional: local capture (no server needed to fish)

**Skip this section if you just want to fish** — leave **Local capture** `off`. Your **Catch history**, rarity counts, and daily totals already save locally in your browser.

Only turn **Local capture** on if you run the optional local Node server (`fishserve.js`) to stream raw `catches.csv` rows and 5-minute `data/runs/` snapshots (since the page ring only keeps the last 250 attempts):

```bash
node fishserve.js
```

Open **Session & guards**, turn on **Local capture**, and enter the fishserve origin (`http://127.0.0.1:8731` by default; or click **Cancel** anytime to fish without a server). If Chromium asks to allow **local network access** for `app.lofi.town`, click **Allow**. Catches stream to `catches.csv` (`time,species,rarity,quality,weight,value,profile,shiny,golden`) and the first run snapshot posts immediately and repeats every five minutes (old `data/runs/` snapshots prune automatically past 14 days or 1,000 files, keeping the last 24h untouched). Click the green **capture armed** line anytime to open the live dashboard (`http://127.0.0.1:8731/dashboard`), or click an amber line to correct the address.

In the morning:

```bash
node scripts/overnight-report.js
```

It reports catch rate, width bands, losses, gaps, doctor verdicts and whether the night was recorded to the end. `--all`, `--hours N` and `--since ISO` change the window. The full contract is in [the capture spec](docs/specs/2026-11-18-overnight-capture.md); the live check is in [the capture review](docs/reviews/2026-11-18-capture-address-live.md). On WSL, fishserve can run as a systemd user unit; the service commands and reboot caveat are in [docs/STATE.md](docs/STATE.md).

## Development

Zero runtime dependencies — `dist/autofish.user.js` remains a single self-contained Tampermonkey script. Node.js is used for tests, building the bundle, dev-only JSDoc type-checking (`typescript@7.0.2`), and the optional capture server.

```bash
npm ci                      # installs dev-only typescript for static type-checking
npm run typecheck           # tsc --noEmit across JS modules (// @ts-check + types.d.ts)
node --test                 # full suite; never "node --test tests/"
node build-userscript.js    # assemble src/ modules + core/panel/session/layout into dist/
npm run serve               # start optional local capture server (node fishserve.js)
node scripts/release.js --check
```

The committed `dist/autofish.user.js` is checked against `package.json`; rebuild it before committing browser changes. Shared domain logic lives under `src/` (`diagnostics.js`, `ledger.js`, `vision.js`, `timing.js`, `loop.js`) and is assembled alongside `autofish.js`, `session.js`, `layout.js`, and `panel.js`. The design record, measurements and every fix are in [AUTOFISH.md](AUTOFISH.md). Current position, specs and verification history are in [docs/STATE.md](docs/STATE.md).

## Documentation and licence

- [AUTOFISH.md](AUTOFISH.md) - design record, measurements and known regressions.
- [docs/README.md](docs/README.md) - index of specs, reviews, tasks, and release notes.
- [docs/STATE.md](docs/STATE.md) - current position, decisions and next actions.
- [docs/specs/](docs/specs/) - approved feature contracts.
- [docs/reviews/](docs/reviews/) - live verification records.
- [scripts/release.js](scripts/release.js) - the release check and mirror publish path.

MIT - see [LICENSE](LICENSE). Not affiliated with lofi.town.
