# lofi.town AutoFish

A one-file AutoFish for [lofi.town](https://app.lofi.town/) - no server, no build step, and no console paste to install. Install it in Tampermonkey and press **Start**.

![AutoFish running in lofi.town](docs/images/in-game.jpg)

## Status

**Actively maintained.** Current release **3.9.62** ([public release](https://github.com/lowqualityloey/lofitown-autofishing-dist/releases/tag/v3.9.62)) · **full test suite passing** on 2026-11-24 · [MIT](LICENSE)

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

There is no shell command for the basic install; step 2 is the URL. After installation, verify it with the panel header (`v3.9.62`) or this browser-console command:

```js
__fish.version
// 3.9.62
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

The panel keeps the everyday controls on its surface: **Start / Pause**, **Stop**, session time, catches, presses and today's cap. **Session & guards** holds the session length, cooldown, daily cap, clock window, profile, CSV upload and optional overnight capture.

**Fast first press (opt-in).** By default the first press on a dial narrower than 60° or spinning at 300°/s or faster waits for a stable spin fit. Turn on **Fast first press** in **Session & guards** to tap the first pass anyway. It removes the visible first-turn delay, but skips the stability check and makes misses on high-tier fish more likely; it is off by default. **Diagnostics** shows fps, frame times and detector cost. Drag the header to move it; the **-** control collapses it to a small pill.

![The AutoFish panel](docs/images/panel.jpg)

The local ledger tracks per-species counts and best weights, rarity totals, 60 day buckets, and per-profile daily budgets. It never requires the server. Historical field runs give a sense of the floor: the 3.9.27 run recorded 145 attempts, 144 catches (99.3%), 777/777 accepted presses, 258 dial hits and 0 misses; the 3.9.15 baseline was 126/133 (94.7%). These are measurements of those builds, not a guarantee for 3.9.62. The full records and caveats are in [AUTOFISH.md](AUTOFISH.md).

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

## Optional: overnight capture

The page keeps only the last 250 attempts, so a long run needs a local sampler. Fishserve stores snapshots; the morning report reads them. It never controls the bot.

```bash
node fishserve.js
```

Open **Session & guards**, click **Overnight capture**, and enter the fishserve origin, usually `http://127.0.0.1:8731`. The first snapshot posts immediately and the sampler repeats every five minutes. The line is the truth: green means it is writing, amber means the post failed or the address moved. Click the amber line to correct the address.

In the morning:

```bash
node scripts/overnight-report.js
```

It reports catch rate, width bands, losses, gaps, doctor verdicts and whether the night was recorded to the end. `--all`, `--hours N` and `--since ISO` change the window. The full contract is in [the capture spec](docs/specs/2026-11-18-overnight-capture.md); the live check is in [the capture review](docs/reviews/2026-11-18-capture-address-live.md). On WSL, fishserve can run as a systemd user unit; the service commands and reboot caveat are in [docs/STATE.md](docs/STATE.md).

## Development

No runtime dependencies. Node.js is only needed for development and the optional server.

```bash
node --test                 # full suite; never "node --test tests/"
node build-userscript.js    # rebuild dist/ after editing browser code
node scripts/release.js --check
```

The committed `dist/autofish.user.js` is checked against `package.json`; rebuild it before committing browser changes. The design record, measurements and every fix are in [AUTOFISH.md](AUTOFISH.md). Current position, specs and verification history are in [docs/STATE.md](docs/STATE.md).

## Documentation and licence

- [AUTOFISH.md](AUTOFISH.md) - design record, measurements and known regressions.
- [docs/STATE.md](docs/STATE.md) - current position, decisions and next actions.
- [docs/specs/](docs/specs/) - approved feature contracts.
- [docs/reviews/](docs/reviews/) - live verification records.
- [scripts/release.js](scripts/release.js) - the release check and mirror publish path.

MIT - see [LICENSE](LICENSE). Not affiliated with lofi.town.
