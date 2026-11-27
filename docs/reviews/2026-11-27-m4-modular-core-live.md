# M4 Modular Core — Live Verification in BrowserOS Neo (2026-11-27)

Environment: BrowserOS Neo on `https://app.lofi.town/?ref=home_hero`, profile `nepchur2`, with the rebuilt M4 userscript (`0c71e6e`, `docs` sync `7802bf4`) installed via local Tampermonkey from `http://127.0.0.1:8731/autofish.user.js` (`fishserve.service` restarted on `127.0.0.1:8731` at `15:15:54 NZDT`). Served build: `412,423` UTF-8 bytes (`sha256: f7505c7c5b093c91aae8d5d1581524b28657118ebb2e35b2aef1c12bb9a36bec`), panel version `3.9.64`.

DevTools console check in the live tab:

```js
[__fish.version, !!window.AutoFishDiagnostics, !!window.AutoFishLedger, !!window.AutoFishVision, !!window.AutoFishTiming, !!window.AutoFishLoop]
// -> ['3.9.64', true, true, true, true, true]
```

Offline pre-checks on `0c71e6e` / `7802bf4`: `npm run typecheck` exit `0`, `node build-userscript.js` clean, `node --test` `436/436` pass, `check-doctor.sh` exit `0`.

## Observed

Window covered: `02:15:01Z` – `02:18:22Z` (`15:15:01` – `15:18:22 NZDT`), recorded in `catches.csv` and `data/runs/export-2026-11-27T02-18-22-471Z.json`.

| Check | Result |
| :--- | :--- |
| All 5 `src/` UMD modules active in-page | Pass — console confirmed `['3.9.64', true, true, true, true, true]` (`AutoFishDiagnostics`, `AutoFishLedger`, `AutoFishVision`, `AutoFishTiming`, `AutoFishLoop`). |
| Live catches (`n: 1..10`) | Pass — **`10/10` (`100%`) caught** (`Rainbow Darter`, `Swamp Barb`, `2x Walleye`, `Axolotl`, `Yellow Perch`, `Snapping Turtle`, `Bull Frog`, `Mud Crab`, `Golden Shiner`). |
| Dial continuity under `src/loop.js` | Pass — **`d: 1` single dial lock on all `10/10` attempts** (including a `55°` narrow `Walleye`, `3` Rare catches, and `+458°/s` / `-277°/s` spins). |
| Press acceptance & timing prediction | Pass — **`53/53` (`100%`) accepted** (`0` rejected) across `n: 1..10`; live press probes `51/51` inside predicted window (`42` settled, `9` assumed, `meanWindowDeg: 45.6°`); prediction residual **`p50: 1.1° / 7.6 ms`**, **`p95: 3.7° / 26.2 ms`** (`400` samples). |
| Frame pacing & WebGL readback | Pass — **`143.1 fps`** (`p50: 7 ms`, `p95: 7.9 ms`, `worst: 18.6 ms`), `longtasks.inLast10s: 0`, `snapshot: { gl: 4233, canvas2d: 0 }`, `readback: { gl: 9382, canvas2d: 0, allocMBPerSec: 0.01, bufferMB: 0.67 }`. |
| Doctor verdict | Pass — `{ verdict: 'waiting-bite', severity: 'ok', action: 'none' }` at export (`250`-attempt rolling store `249/250` caught / `99.6%`, `1289/1289` presses accepted). |

## Not Observed

| Check | Why |
| :--- | :--- |
| Zen / Gecko frame timing | Tested in Chromium-based BrowserOS Neo; `__fish.perf()` on Gecko remains open. |
| Full overnight / local-midnight rollover soak | Focused 3.5-minute M4 smoke verification only; run `node scripts/overnight-report.js` after an overnight soak to inspect full-night `## Coverage`. |
| Public GitHub release auto-update | `main` (`0c71e6e` + `7802bf4`) has not been pushed or released yet; installed directly from local `127.0.0.1:8731/autofish.user.js`. |
