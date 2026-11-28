// @ts-check
/**
 * lofi.town autofish v3 — continuous cast -> reel -> dial loop.
 *
 * Inject this whole file in the page, then:
 *   __fish.start()                    run (Space presses the dial)
 *   __fish.start({ press: false })    observe only, never press the dial
 *   __fish.start({ pressWith: 'pointer' })  press the dial with a pointer click instead
 *   __fish.status() / __fish.report() / __fish.stop()
 *
 * WHY THIS IS SHAPED THE WAY IT IS (everything below was measured live, see AUTOFISH.md):
 *
 *  - The game used to draw the world and the UI on two canvases. It has since merged both into the
 *    Pixi/WebGL renderer canvas: the old "UI layer" canvas is completely empty, and the prompt and
 *    the dial are painted into the renderer. Which canvas holds pixels is discovered at runtime
 *    (surfaces()/adoptSurface()), never assumed.
 *  - A WebGL buffer is cleared before each render, so a sample taken from requestAnimationFrame
 *    reads blank even when the screen is full. Detection therefore runs from a wrapper around the
 *    renderer's `render()`, immediately after the game has drawn (installPostRender()). rAF keeps
 *    the frame clock and the stall watchdog, and samples only when no Pixi renderer is reachable.
 *  - Scene-graph hit areas are unreliable — every node reports eventMode 'passive' with an
 *    empty _events map — yet synthetic pointer events dispatched on the canvas do reach the
 *    game. So the bubbles are located in pixels, not in the scene graph.
 *  - CAST! and REEL! are the same white bubble in the same place with different text, so
 *    the loop does not need to tell them apart: press any bubble that appears.
 *
 * Measured geometry at a 1620x1031 viewport (dpr 1):
 *   bubble     white 108x50, centred (810, 358)
 *   dial       centred (813, 407), outer radius ~91
 *   rim        light grey, saturation <= 22, luminance 158..246, alpha > 60
 *   pin        orange rgb(229,118,83), fixed at 0 deg = 12 oclock
 *   disc       base rgb(142,138,111) / wedge rgb(182,188,132), wedge 45-65 degrees
 *   rotation   ~125-140 deg/s
 *
 * Timing: the press is dispatched by a timer aimed at the moment the pin crosses the wedge,
 * not by the frame that happens to see it - at 746 deg/s the whole +/-6 deg window is 16 ms,
 * i.e. exactly one frame. Spin rate is a least-squares fit over the last ~200 ms of distinct
 * frames (unwrapped, no deadband, no 600 deg/s clamp). The acceptance window is the measured
 * arc minus a margin unless opts.trigger === 'angle'. Presses go through the pointer path,
 * the one proven to reach the game; 'space' stays available for A/B tests.
 */
(() => {
  if (window.__fish && window.__fish.stop) { try { window.__fish.stop(); } catch (e) {} }

  /**
   * build-userscript.js replaces 'dev' with package.json's version, so the header, __fish.version
   * and the panel cannot disagree. Served unbundled (the bookmarklet path) it stays 'dev', which is
   * the honest answer: that copy has no build step to stamp it.
   * @type {FishCore}
   */
  const F = { version: 'dev' };
  const now = () => performance.now();
  const { doctor, wilson, runSummary, pressAcceptSummary, predictionSummary, pressVerdictReport, resultMissingDue, createResultMissing } = /** @type {any} */ (window.AutoFishDiagnostics);
  const {
    SPECIES, TIER_ORDER, LOG_KEY, LOG_PREFIX, tidyName, normTier, parseWeightKg, splitVariant,
    speciesInfo, describeCatch, logDay, emptyLog, addToLog, trimLog, logSummary, unknownWorklist,
    csvCell, logCsv, DIAL_KEY, DIAL_R_MIN, DIAL_R_MAX, dialGeoFit, sameDial, createDialMemory, createLedger,
  } = /** @type {any} */ (window.AutoFishLedger);
  const {
    cssPoint, flipRows, glRowY, promptBox, seatPromptBox, floodComponents, glyphMetrics,
    textSince, parseCard,
  } = /** @type {any} */ (window.AutoFishVision);
  const {
    wrap180, deltaOmega, fitOmega, planPress, sweepBias, omegaBand, widthBand, cardShapeOk,
    isCardSettled, padCardBox, newTriangle, pressOutcome, castRecovery, perfRates, fitStable,
    firstPressGate, firstPressBudget, firstPressCanMature, markFirstPressForced, rearmReady,
    dialFallbackWait, dialGhost, dialStalled, ghostBlocked, spinAlive, lossDiagnostics,
  } = /** @type {any} */ (window.AutoFishTiming);
  const {
    cancelPend: loopCancelPend, stepFrame,
  } = /** @type {any} */ (window.AutoFishLoop);
  const { loadDialMemory, saveDialMemory } = createDialMemory(window, () => uiCanvas);
  const ledgerStore = createLedger(window);
  const { loadLedger, saveLedger, logProfiles, logKey } = ledgerStore;
  let logProfile = 'default';
  const _resultMissing = createResultMissing(F, function (msg, extra) { L(msg, extra); });
  const clearResultMissing = _resultMissing.clear;
  const markResultMissing = _resultMissing.mark;

  /* ---- performance probe -------------------------------------------------
   * Zen/Gecko pays far more for a canvas readback than Chromium does, and the only honest way to
   * tune that is to measure it on the machine that hurts. __fish.perf() reports frame gaps and the
   * average cost of each detector, so a change can be justified by numbers rather than a guess.
   */
  /** @type {FishPerf} */
  const perf = { gaps: [], n: 0, last: 0, startedAt: 0, stoppedAt: 0, snap: 0, snapN: 0, bubble: 0, bubbleN: 0, lock: 0, lockN: 0, sample: 0, sampleN: 0, card: 0, cardN: 0, readN: 0, readGL: 0, read2d: 0, readMB: 0, allocMB: 0, snapGL: 0, snap2d: 0, ltN: 0, ltMax: 0, ltRing: [], lockMemo: 0, lockMemoN: 0, lockMemoSkipped: 0, lockMemoCold: 0, lockGrab: 0, lockMask: 0, lockScan: 0, lockRefine: 0 };
  /* lockDial is one timer around five different kinds of work - a remembered circle, a GPU readback,
   * a rim mask, a 4,950-circle scan and the 40-sample refinement - and the sum of the parts that had
   * been measured separately (readback 7-9 ms, mask 0.38 ms, coarse scan 0.75 ms) did not reach the
   * 35-44 ms a call the live probe reported. These five phases split the call itself so the missing
   * time names itself instead of being inferred. */
  /** How often the remembered circle may cost a readback. 500 ms still answers a stale hint well
   *  inside a reel (the dial persists across presses) at a third of the old read count. */
  /**
   * Long tasks, counted from outside the loop.
   *
   * The bot can see its own detector cost but not a stall it did not cause - and a 250 ms block
   * inside render() looks exactly like a 250 ms block from anywhere else. PerformanceObserver is
   * the cheapest honest witness: no readback, no timer, no allocation per entry beyond the ring.
   * 3.9.11's once-a-second stall was invisible for a day because nothing counted this.
   */
  /** @type {PerformanceObserver | null} */
  let ltObs = null;
  function watchLongTasks() {
    if (ltObs || typeof PerformanceObserver === 'undefined') return;
    try {
      ltObs = new PerformanceObserver(function (list) {
        const at = now();
        const entries = list.getEntries();
        for (const e of entries) {
          perf.ltN++;
          if (e.duration > perf.ltMax) perf.ltMax = e.duration;
          perf.ltRing.push({ t: at, ms: e.duration });
          if (perf.ltRing.length > 24) perf.ltRing.shift();
        }
      });
      ltObs.observe({ entryTypes: ['longtask'] });
    } catch (e) { ltObs = null; }
  }

  const MEMO_EVERY_MS = 500;
  /** The remembered circle can only help while a dial is actually on screen: it caches the last
   *  circle, and between dials there is nothing at that spot to verify. So an attempt also needs a
   *  dial to have been locked inside this window - a readback that can only fail is pure cost. */
  const MEMO_RECENT_MS = 2000;
  function resetPerf() {
    perf.gaps.length = 0; perf.n = 0; perf.last = 0; perf.startedAt = now(); perf.stoppedAt = 0;
    perf.snap = 0; perf.snapN = 0; perf.bubble = 0; perf.bubbleN = 0;
    perf.lock = 0; perf.lockN = 0; perf.sample = 0; perf.sampleN = 0;
    perf.card = 0; perf.cardN = 0;
    perf.readN = 0; perf.readGL = 0; perf.read2d = 0; perf.readMB = 0; perf.allocMB = 0;
    perf.snapGL = 0; perf.snap2d = 0;
    perf.ltN = 0; perf.ltMax = 0; perf.ltRing.length = 0;
    perf.lockMemo = 0; perf.lockMemoN = 0; perf.lockMemoSkipped = 0; perf.lockMemoCold = 0; perf.lockGrab = 0; perf.lockMask = 0; perf.lockScan = 0; perf.lockRefine = 0;
  }

  /* ---- timing core -----------------------------------------------------
   * Pure functions, no DOM and no state. tests/timing.test.js extracts this block by its
   * sentinels and runs it under node, so the maths is tested once and shipped once.
   */
  /* Timing math lives in src/timing.js (AutoFishTiming). */

  /* refreshLossDiagnostic lives in src/loop.js (AutoFishLoop). */

  /* ---- doctor ----------------------------------------------------------
   * One verdict about why fishing is or is not happening, from state the bot already collects:
   * no DOM, no timers, no reads. tests/doctor.test.js feeds it the states this project has actually
   * been in, so the classes that each cost a live debugging session are named instead of inferred.
   */

  /* ---- run statistics --------------------------------------------------
   * The numbers a long session has to produce: a catch rate with an interval, the press acceptance,
   * and the per-band split. Pure, so tests can check them against intervals this repo has already
   * published instead of trusting the arithmetic that quotes them.
   */

  /* ---- coordinate frame ------------------------------------------------
   * Everything the detectors see is in the UI canvas's backing-store pixels. Everything the DOM
   * does - elementFromPoint, PointerEvent, the panel's exclusion rect - is in CSS pixels. Those
   * are the same only while the canvas is 1:1 with its CSS box, which is true at the dpr the game
   * was measured at and is not something to keep assuming silently.
   */
  /* cssPoint lives in src/vision.js (AutoFishVision). */

  /* ---- dial memory ------------------------------------------------------
   * The reel widget sits in one place for a whole session, so its circle is worth remembering: a
   * fresh start has no prompt to learn it from, and the old seed was a literal point measured at
   * one viewport. It is stored with the canvas size it was measured at, because the widget's place
   * in the UI layer scales with the canvas, not with the window's CSS size.
   */

  /* ---- catch log --------------------------------------------------------
   * A durable, server-free record of every parsed catch. The data helpers in the block below are
   * pure (no DOM, no storage), so tests/catchlog.test.js pulls them out under node; the browser
   * storage calls sit underneath.
   *
   * Why a catalogue: the catch card prints a rarity word only for non-common fish, so commons
   * arrive blank. The game ships its own fish table (name, tier, weight range, gold), extracted
   * by scripts/gen-catalogue.js - a lookup, never a pixel guess.
   */

  /* ------------------------------------------------------------- log ----- */
  F.events = [];
  function L(msg, extra) {
    F.events.push(Object.assign({ t: Math.round(now()), msg }, extra || {}));
    if (F.events.length > 600) F.events.shift();
  }

  /* -------------------------------------------------------- surfaces ----- */
  /** @type {HTMLCanvasElement | null} */
  let uiCanvas = null;
  /** @type {HTMLCanvasElement | null} */
  let gameCanvas = null;
  /** @type {HTMLCanvasElement | null} */
  let inkBuf = null;
  /** @type {CanvasRenderingContext2D | null} */
  let inkCtx = null;
  let uiBlank = 0, uiAdopted = false, uiCheckAt = 0;
  function surfaces() {
    const cans = [...document.querySelectorAll('canvas')];
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    const renderer = app && app.renderer && app.renderer.canvas;
    // The overlay is the pointer-events-none canvas; the renderer is the world. Prefer the DOM
    // marker so a resize cannot leave us reading the world as if it were the prompt layer.
    const overlay = cans.find((c) => c !== renderer && c.parentElement &&
      String(c.parentElement.className || '').indexOf('pointer-events-none') !== -1);
    gameCanvas = renderer || cans.find((c) => c !== overlay) || cans[0];
    uiCanvas = overlay || cans.find((c) => c !== gameCanvas) || cans[1] || cans[0];
  }

  /**
   * Does this canvas draw anything, and how full is it? A 16x16 downscale answers both.
   *
   * Density is what separates the two layers: the world canvas is essentially full (measured live
   * 2026-11-02: 967,959 of 968,059 pixels painted) while the UI overlay is sparse (6,498, mostly
   * the prompt bubble). "Has ink" alone cannot tell them apart, and that is how the bot ended up
   * reading the world layer and reporting zero bubbles while a REEL! prompt was on screen.
   */
  function inkStats(c) {
    if (!c || !c.width || !c.isConnected) return { ink: false, density: 0 };
    if (!inkBuf) {
      inkBuf = document.createElement('canvas');
      inkBuf.width = 16; inkBuf.height = 16;
      inkCtx = inkBuf.getContext('2d', { willReadFrequently: true });
    }
    if (!inkCtx) return { ink: false, density: 0 };
    inkCtx.clearRect(0, 0, 16, 16);
    try { inkCtx.drawImage(c, 0, 0, 16, 16); } catch (e) { return { ink: false, density: 0 }; }
    const d = inkCtx.getImageData(0, 0, 16, 16).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { ink: n > 0, density: n / 256 };
  }
  function hasInk(c) { return inkStats(c).ink; }

  /**
   * The game used to paint the world on the renderer canvas and the prompts on a second 2D layer.
   * A game update can merge both into the renderer and leave an empty second canvas on top; the bot
   * then reads a fully transparent surface and sees no bubble at all. Measured live 2026-11-02: the
   * renderer canvas had 965,753 painted pixels, the second canvas had 0, and the status read
   * 0 bubbles while a CAST prompt was on screen. Adopt the candidate that actually has pixels, and
   * give the old layer back if the game ever starts drawing on it again.
   */
  let probingSurface = false;
  function adoptSurface() {
    // A blank current surface is not evidence that the layer moved: the sparse overlay is
    // legitimately blank between prompts. Ask the other canvas for a prompt, twice at the same
    // spot, before handing the read surface to the renderer. This is the same evidence rule used
    // by probeOtherSurface; the old blank-count swap was the reason a fullscreen resize could
    // leave the bot reading the world and mistaking cream ground for a catch card.
    if (probingSurface) return false;
    probingSurface = true;
    /** @type {any} */
    let found = null;
    try { found = probeOtherSurface(true); } finally { probingSurface = false; }
    return !!found;
  }

  /** The UI canvas read blank for several scans: if the other candidate has ink, the UI moved. */
  /**
   * Look for a prompt on the canvas the bot is NOT reading, and keep it if that is where the UI is.
   *
   * The game has shipped the prompt layer both merged into the renderer (2026-11-02: renderer 965k
   * painted, second canvas empty) and split onto its own sparse canvas (later the same day: world
   * 968k, overlay 6.5k). A surface pick can be right at load and wrong an hour later, so a miss is
   * not evidence of "no prompt" until the other canvas has been asked too.
   *
   * allowDense is only for adoptSurface(), after the current surface has already read blank for
   * four scans. The ordinary fallback still rejects a dense world canvas.
   */
  function probeOtherSurface(allowDense) {
    const cans = [...document.querySelectorAll('canvas')];
    const alt = cans.find((c) => c !== uiCanvas && c.isConnected && c.width);
    if (!alt) return null;
    const cur = uiCanvas;
    uiCanvas = alt; snapAt = 0;
    /** @type {any} */
    let found = null;
    try { if (snapshot() && bubbleGate()) found = bubbleInBox(); } catch (e) { found = null; }
    uiCanvas = cur; snapAt = 0;
    if (!found) { F.altHit = null; return null; }
    // Two hits at the same spot before believing it. One white blob on the wrong surface is not a
    // prompt, and flipping on a single hit made the surface flap every few seconds (measured live
    // 2026-11-02: 11 'ui layer moved' in a 219-event buffer).
    const prev = F.altHit;
    const same = prev && Math.abs(prev.x - found.cx) <= 12 && Math.abs(prev.y - found.cy) <= 12 &&
      now() - prev.at < 2000;
    F.altHit = { x: found.cx, y: found.cy, at: now() };
    if (!same) return null;
    // Never adopt a dense layer through the ordinary fallback: the world canvas is always full, and
    // adopting it is what made the bot blind for fifteen minutes. The blank-current-surface path
    // may pass allowDense, but only after the prompt was found twice at the same spot.
    if (!allowDense && inkStats(alt).density >= 0.5) { F.altHit = null; return null; }
    gameCanvas = cur;
    uiCanvas = alt;
    uiAdopted = true;
    uiCheckAt = now();
    snapAt = 0;
    F.altHit = null;
    L('ui layer moved', { surface: 'the other canvas', cx: found.cx, cy: found.cy });
    return found;
  }

  function checkSurface() {
    if (uiAdopted && now() - uiCheckAt > 5000) {
      uiCheckAt = now();
      // Only hand it back to something overlay-shaped. The renderer canvas is the world and is
      // always full, so a bare "has ink" test flipped the bot onto it five seconds after every
      // adoption and left it blind for the rest of the session.
      const other = inkStats(gameCanvas);
      if (other.ink && other.density < 0.5) {
        const old = uiCanvas;
        uiCanvas = gameCanvas;
        gameCanvas = old;
        uiAdopted = false;
        snapAt = 0;
        L('ui layer moved', { surface: 'second canvas' });
        return true;
      }
    }
    if (uiBlank > 3) { uiBlank = 0; return adoptSurface(); }
    return false;
  }

  /** A window resize or fullscreen transition can replace the surface underneath us. Re-resolve it
   * instead of carrying a cached world canvas into the next scan. */
  function resetSurface() {
    surfaces();
    uiAdopted = false; uiCheckAt = 0; uiBlank = 0; F.altHit = null; snapAt = 0;
    F.lastBubble = null; F.lastBubbleAt = 0; F.lastCardRect = null;
    F.cardCheckAt = 0; F.cardScan = 0; F.lastCard = 0; F.cardWait = null; F.trophyWaitAt = 0;
    F.geo = null; F.bad = 0; F.pressesThisDial = 0; F.lastLockAt = 0;
    const cw = (uiCanvas && uiCanvas.width) || window.innerWidth;
    const ch = (uiCanvas && uiCanvas.height) || window.innerHeight;
    F.hint = { x: Math.round(cw / 2), y: Math.round(ch * 0.42) };
    L('surface resized', { w: cw, h: ch });
  }
  /** @type {(() => void) | null} */
  let surfaceWatch = null;
  function watchSurfaces() {
    if (surfaceWatch) return;
    surfaceWatch = function () { if (F.running) resetSurface(); };
    window.addEventListener('resize', surfaceWatch);
    document.addEventListener('fullscreenchange', surfaceWatch);
  }
  function unwatchSurfaces() {
    if (!surfaceWatch) return;
    window.removeEventListener('resize', surfaceWatch);
    document.removeEventListener('fullscreenchange', surfaceWatch);
    surfaceWatch = null;
  }

  function dataHasInk(d) {
    // every seventh pixel: a prompt is thousands of pixels, an empty layer is none
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) return true;
    return false;
  }

  /** The UI canvas's CSS box, so a canvas pixel can become a CSS pixel at the DOM boundary. */
  function uiFrame() {
    if (!uiCanvas || !uiCanvas.width || !uiCanvas.getBoundingClientRect) return null;
    const r = uiCanvas.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height, cw: uiCanvas.width, ch: uiCanvas.height };
  }

  /* --------------------------------------------------------- readback ----- */
  /* flipRows and glRowY live in src/vision.js (AutoFishVision). */

  /** @type {HTMLCanvasElement | null} */
  let glCanvasRef = null;
  /** @type {any} */
  let glCtx = null;
  /** @type {Uint8Array | null} */
  let glBuf = null;
  /** @type {Uint8Array | null} */
  let glRow = null;
  let glFails = 0;

  /**
   * The WebGL context that owns this canvas, or null for a 2D layer. Cached per canvas: a 2D
   * surface must not pay a failed getContext probe on every read.
   */
  function webglFor(c) {
    if (c === glCanvasRef) return glCtx;
    glCanvasRef = c; glCtx = null; glFails = 0;
    if (!c) return null;
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    let g = app && app.renderer && app.renderer.gl;
    if (!g || g.canvas !== c) {
      // A context already created under another type answers null here. That is the 2D answer.
      try { g = c.getContext('webgl2'); } catch (e) { g = null; }
      if (!g) { try { g = c.getContext('webgl'); } catch (e) { g = null; } }
    }
    glCtx = g && g.canvas === c && typeof g.readPixels === 'function' ? g : null;
    return glCtx;
  }

  /** @type {HTMLCanvasElement | null} */
  let ubuf = null;
  /** @type {CanvasRenderingContext2D | null} */
  let uctx = null;
  /** The allocating 2D read: the only reader for a plain 2D surface and the GL path's fallback. */
  function readUI2d(x, y, w, h) {
    if (!ubuf) {
      ubuf = document.createElement('canvas');
      ubuf.width = 520; ubuf.height = 520;
      uctx = ubuf.getContext('2d', { willReadFrequently: true });
    }
    if (!uctx || !uiCanvas) return null;
    if (ubuf.width < w || ubuf.height < h) {
      ubuf.width = Math.max(ubuf.width, w);
      ubuf.height = Math.max(ubuf.height, h);
    }
    uctx.clearRect(0, 0, w, h);
    try { uctx.drawImage(uiCanvas, x, y, w, h, 0, 0, w, h); } catch (e) { return null; }
    perf.readN++; perf.read2d++;
    perf.readMB += (w * h * 4) / 1048576;
    perf.allocMB += (w * h * 4) / 1048576;
    return { d: uctx.getImageData(0, 0, w, h).data, w, h, x, y };
  }

  /**
   * The allocation-free read. Measured live 2026-11-02 in BrowserOS neo: 121 getImageData calls
   * in 5 s allocated 40.4 MB, the JS heap climbed ~12 MB/s, and a major collection froze the
   * page for ~250 ms about once a second. readPixels writes into a buffer we own, so a steady
   * session reuses the same memory and allocates nothing per read. The buffer is cleared first:
   * a read that fails silently must look empty, not replay the previous frame as a ghost prompt.
   */
  function readUIgl(gl, x, y, w, h) {
    if ((gl.isContextLost && gl.isContextLost()) || !uiCanvas) return null;
    const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > bw || y + h > bh) return null;
    const n = w * h * 4;
    if (!glBuf || glBuf.length < n) {
      glBuf = new Uint8Array(n);
      perf.allocMB += n / 1048576;
    }
    if (!glRow || glRow.length < w * 4) glRow = new Uint8Array(w * 4);
    const d = glBuf;
    let prev = null, ok = false;
    try {
      prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      if (prev) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      d.fill(0, 0, n);
      gl.readPixels(x, glRowY(bh, y, h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      ok = gl.getError() === gl.NO_ERROR;
    } catch (e) { ok = false; }
    finally { if (prev) { try { gl.bindFramebuffer(gl.FRAMEBUFFER, prev); } catch (e) {} } }
    if (!ok) return null;
    flipRows(d, w, h, glRow);
    perf.readN++; perf.readGL++;
    perf.readMB += n / 1048576;
    return { d, w, h, x, y };
  }

  /** Read the UI layer. Must be called from inside the render hook (or rAF without Pixi). */
  function readUI(x, y, w, h) {
    if (!uiCanvas || !uiCanvas.width || !uiCanvas.isConnected) surfaces();
    // The SPA can drop its canvases for a moment (route change, soft reload). Reporting "nothing
    // drawn" is correct there; touching a missing canvas would throw on every frame and the
    // panel would read a burst of errors as a broken session and stop it.
    if (!uiCanvas || !uiCanvas.width) return null;
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(uiCanvas.width - x, Math.round(w));
    h = Math.min(uiCanvas.height - y, Math.round(h));
    if (w <= 0 || h <= 0) return null;
    const gl = webglFor(uiCanvas);
    if (gl) {
      const r = readUIgl(gl, x, y, w, h);
      if (r) return r;
      // Three failed reads say the surface cannot be read through its context; stop paying for
      // both paths on every detector call and let the 2D fallback carry the session.
      if (++glFails >= 3) { glCtx = null; L('readback fallback', { surface: '2d' }); }
    }
    return readUI2d(x, y, w, h);
  }

  const PX = (r, x, y) => {
    const i = ((y - r.y) * r.w + (x - r.x)) * 4;
    return [r.d[i], r.d[i + 1], r.d[i + 2], r.d[i + 3]];
  };
  const LU = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const SA = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  const RIM = (c) => c[3] > 60 && SA(c) <= 22 && LU(c) >= 158 && LU(c) <= 246;
  const WHT = (c) => c[3] > 120 && c[0] >= 225 && c[1] >= 225 && c[2] >= 225;
  /**
   * Colour matching by nearest reference, not by saturation. The saturation test passed any
   * greenish pixel, which put several arcs on the ring: the run list then held up to four of
   * them and the tracked midpoint never crossed the pin. These two tones were measured off a
   * live dial, and the wedge has to win by a clear margin or the pixel counts as base.
   */
  const BASE_RGB = [142, 138, 111];
  const WEDGE_RGB = [182, 188, 132];
  const d2 = (c, r) => {
    const dr = c[0] - r[0], dg = c[1] - r[1], db = c[2] - r[2];
    return dr * dr + dg * dg + db * db;
  };
  const GRN = (c) => {
    if (c[3] <= 60) return false;
    const w = d2(c, WEDGE_RGB);
    return w < 1100 && w * 1.8 < d2(c, BASE_RGB);
  };
  // The pin paints over the wedge at 12 oclock, exactly where the wedge must be read,
  // so pin pixels are UNKNOWN rather than disc base: read as base they split the arc
  // in two precisely at the crossing.
  const PIN = (c) => c[3] > 60 && c[0] > 185 && c[1] > 85 && c[1] < 165
                    && c[2] < 135 && c[0] - c[1] > 55;

  /* --------------------------------------------------------- bubbles ----- */
  /* promptBox and seatPromptBox live in src/vision.js (AutoFishVision). */
  function bubbleInBox() {
    const scanRect = (r) => {
      if (!r) return null;
      // Column counts straight off the buffer. The old loop built a fresh 4-element array for every
      // pixel - 75,600 allocations per frame, i.e. ~6M/s at the loop rate. That GC pressure is what
      // made the page stutter, so this pass reads channels by index only.
      const d = r.d, w = r.w, h = r.h;
      const cols = new Array(w).fill(0);
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i += 4) {
          if (d[i + 3] > 120 && d[i] >= 225 && d[i + 1] >= 225 && d[i + 2] >= 225) cols[x]++;
        }
      }
      let s = -1;
      /** @type {any} */
      let best = null;
      for (let x = 0; x <= r.w; x++) {
        const on = x < r.w && cols[x] > 3;
        if (on && s < 0) s = x;
        if (!on && s >= 0) {
          const bw = x - s;                     // bubble width, not the buffer stride
          if (bw > 45 && bw < 150) {
            let y0 = 1e9, y1 = -1, n = 0;
            for (let y = 0; y < h; y++) {
              for (let xx = s, i = (y * w + s) * 4; xx < x; xx++, i += 4) {   // w = buffer width
                if (d[i + 3] > 120 && d[i] >= 225 && d[i + 1] >= 225 && d[i + 2] >= 225) { n++; if (y < y0) y0 = y; if (y > y1) y1 = y; }
              }
            }
            const bh = y1 - y0;                 // bubble height; h stays the buffer height
            // 25 was wide enough for a player's name tag, which is the same white-with-dark-text
            // shape one size smaller. Tapping one opened that player's profile mid-session (reported
            // live 2026-11-02). The prompt is ~108x50 at the reference size and scales with the
            // canvas, so 28 px at the bottom keeps it and drops a tag.
            const fill = n / Math.max(1, bw * bh);
            if (bh >= 28 && bh < 95 && fill >= 0.45 && (!best || n > best.n)) {
              best = { cx: Math.round((s + x - 1) / 2 + r.x), cy: Math.round((y0 + y1) / 2 + r.y), w: bw, h: bh, n, via: 'box' };
              var gm = glyphMetrics(d, w, s, x, y0, y1);
              best.glyph = gm.ok; best.gdark = +gm.dark.toFixed(3); best.gsoft = +gm.soft.toFixed(3);
            }
          }
          s = -1;
        }
      }
      return best;
    };
    const box = promptBox(uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    const r = readUI(box.x, box.y, box.w, box.h);
    const best = scanRect(r);
    if (best) return best;
    const sbox = seatPromptBox(F.lastGeo, uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    if (!sbox || (sbox.x === box.x && sbox.y === box.y && sbox.w === box.w && sbox.h === box.h)) return null;
    return scanRect(readUI(sbox.x, sbox.y, sbox.w, sbox.h));
  }

  /**
   * Is anything prompt-bright inside the prompt box? Pure CPU on the shared snapshot, no readback.
   * The box scan below costs a ~360x210 GPU readback, and the box is empty for most of a session,
   * so the snapshot says "maybe" first and only then is the full-resolution read spent.
   */
  const BUBBLE_GATE_PX = 10;
  function bubbleGate() {
    const hasWhite = (box) => {
      const x0 = Math.max(0, Math.floor(box.x / SDOWN));
      const y0 = Math.max(0, Math.floor(box.y / SDOWN));
      const x1 = Math.min(sw, Math.ceil((box.x + box.w) / SDOWN));
      const y1 = Math.min(sh, Math.ceil((box.y + box.h) / SDOWN));
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0, i = (y * sw + x0) * 4; x < x1; x++, i += 4) {
          if (sdata[i + 3] > 120 && sdata[i] >= 225 && sdata[i + 1] >= 225 && sdata[i + 2] >= 225) {
            if (++n >= BUBBLE_GATE_PX) return true;
          }
        }
      }
      return false;
    };
    const box = promptBox(uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    if (hasWhite(box)) return true;
    const sbox = seatPromptBox(F.lastGeo, uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    return !!(sbox && hasWhite(sbox));
  }

  /* -------------------------------------------------- adaptive search ---- */
  /**
   * The prompts hang off the play area, not the window: the bubble floats above the player and
   * slides with the camera, so even a box that follows the viewport can miss when the camera has
   * moved. When the box misses, look for the same shapes anywhere on the UI layer, using a single
   * 1/4-scale read of the whole surface. Both searches stop at "not found" and return null, so a
   * resized window degrades to doing nothing rather than tapping blind.
   */
  const SDOWN = 4;
  /** @type {HTMLCanvasElement | null} */
  let sbuf = null;
  /** @type {CanvasRenderingContext2D | null} */
  let sctx = null;
  /** @type {any} */
  let sdata = null;
  let sw = 0, sh = 0;
  /** @type {any} */
  let sgl = null;
  /** @type {any} */
  let sglTex = null;
  /** @type {any} */
  let sglFbo = null;
  /** @type {HTMLCanvasElement | null} */
  let sglCanvas = null;
  /** @type {Uint8Array | null} */
  let sbytes = null;
  let sglOff = false, sglChecked = false, sglFails = 0;

  /**
   * The quarter-scale copy WITHOUT a fresh array every tick.
   *
   * getImageData always allocates, and a 242 KB array (1179x821 canvas at 1/4) lands in V8's
   * large-object space: at the 66 ms scan tick that is ~2 MB/s, 1.4 GB across an 11-minute session,
   * and the worst frame on the live run that prompted this was 287 ms - a major collection, not a
   * slow detector. Uploading the 2D copy into our own framebuffer and reading it back with
   * readPixels writes into a buffer we own, so a steady session allocates nothing after warm-up.
   * Verified live in BrowserOS neo at 1179x821: identical bytes to getImageData on 6762 sampled
   * pixels, no row flip needed, 1.30 ms a call against 1.65 ms, and 1.3 ms of it is the sync.
   * A one-off pixel comparison still guards it, so a browser that uploads the copy differently
   * falls back to getImageData instead of feeding the detectors mirrored pixels.
   */
  /**
   * (Re)create the framebuffer's storage and attach it.
   *
   * The order matters, and getting it wrong is silent: a texture attached BEFORE it has storage
   * leaves the framebuffer INCOMPLETE (36054), the completeness check fails, and the whole path
   * falls back to getImageData for the life of the page. That is exactly what 3.9.10 shipped -
   * the "allocation-free snapshot" never ran, while its own probe printed 36054 and was read as
   * success. Allocate the storage first, then attach.
   */
  function sglAttach(w, h) {
    sgl.bindTexture(sgl.TEXTURE_2D, sglTex);
    sgl.texImage2D(sgl.TEXTURE_2D, 0, sgl.RGBA, w, h, 0, sgl.RGBA, sgl.UNSIGNED_BYTE, null);
    sgl.bindFramebuffer(sgl.FRAMEBUFFER, sglFbo);
    sgl.framebufferTexture2D(sgl.FRAMEBUFFER, sgl.COLOR_ATTACHMENT0, sgl.TEXTURE_2D, sglTex, 0);
    sgl.viewport(0, 0, w, h);
    return sgl.checkFramebufferStatus(sgl.FRAMEBUFFER) === sgl.FRAMEBUFFER_COMPLETE;
  }

  function downscaleGl(w, h) {
    if (sglOff) return null;
    try {
      if (!sgl) {
        sglCanvas = document.createElement('canvas');
        sgl = sglCanvas.getContext('webgl2', { antialias: false, depth: false, stencil: false })
           || sglCanvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
        if (!sgl) { sglOff = true; L('downscale readback', { via: '2d', why: 'no webgl' }); return null; }
        sglTex = sgl.createTexture();
        sglFbo = sgl.createFramebuffer();
        sgl.bindTexture(sgl.TEXTURE_2D, sglTex);
        sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_MIN_FILTER, sgl.NEAREST);
        sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_MAG_FILTER, sgl.NEAREST);
        sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_WRAP_S, sgl.CLAMP_TO_EDGE);
        sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_WRAP_T, sgl.CLAMP_TO_EDGE);
      }
      if (sgl.isContextLost && sgl.isContextLost()) {
        sgl = null; sglCanvas = null; sglTex = null; sglFbo = null; sbytes = null; sglChecked = false;
        if (++sglFails >= 3) { sglOff = true; L('downscale readback', { via: '2d', why: 'context lost' }); }
        return null;
      }
      if (!sglCanvas || sglCanvas.width !== w || sglCanvas.height !== h) {
        if (!sglCanvas) return null;
        sglCanvas.width = w; sglCanvas.height = h;
        sbytes = null;
        if (!sglAttach(w, h)) {
          sgl = null; sglCanvas = null; sglTex = null; sglFbo = null; sglChecked = false;
          if (++sglFails >= 3) { sglOff = true; L('downscale readback', { via: '2d', why: 'fbo' }); }
          return null;
        }
      }
      const n = w * h * 4;
      if (!sbytes || sbytes.length !== n) sbytes = new Uint8Array(n);
      sgl.bindTexture(sgl.TEXTURE_2D, sglTex);
      sgl.texImage2D(sgl.TEXTURE_2D, 0, sgl.RGBA, sgl.RGBA, sgl.UNSIGNED_BYTE, sbuf);
      sgl.bindFramebuffer(sgl.FRAMEBUFFER, sglFbo);
      sgl.readPixels(0, 0, w, h, sgl.RGBA, sgl.UNSIGNED_BYTE, sbytes);
      if (sgl.getError() !== sgl.NO_ERROR) return null;
      if (!sglChecked && sctx) {
        sglChecked = true;
        const ref = sctx.getImageData(0, 0, w, h).data;
        let bad = 0, seen = 0;
        for (let i = 0; i < ref.length; i += 4 * 17) { seen++; if (Math.abs(ref[i] - sbytes[i]) > 8) bad++; }
        if (bad > seen * 0.02) {
          sglOff = true;
          L('downscale readback', { via: '2d', why: 'mismatch', bad, seen });
          return null;
        }
        L('downscale readback', { via: 'gl', w, h });
      }
      return sbytes;
    } catch (e) {
      sglOff = true;
      L('downscale readback', { via: '2d', why: String((e && e.message) || e) });
      return null;
    }
  }

  function downscale() {
    if (!uiCanvas || !uiCanvas.isConnected) surfaces();
    if (!uiCanvas || !uiCanvas.width) return false;
    const w = Math.max(1, Math.floor(uiCanvas.width / SDOWN));
    const h = Math.max(1, Math.floor(uiCanvas.height / SDOWN));
    if (!sbuf) {
      sbuf = document.createElement('canvas');
      sctx = sbuf.getContext('2d', { willReadFrequently: true });
    }
    if (sbuf.width !== w || sbuf.height !== h) { sbuf.width = w; sbuf.height = h; }
    if (!sctx) return false;
    sctx.clearRect(0, 0, w, h);
    try { sctx.drawImage(uiCanvas, 0, 0, w * SDOWN, h * SDOWN, 0, 0, w, h); } catch (e) { return false; }
    const glBytes = downscaleGl(w, h);
    if (glBytes) {
      sdata = glBytes;                          // reused buffer: nothing allocated per tick
      perf.snapGL++;
    } else {
      sdata = sctx.getImageData(0, 0, w, h).data;
      perf.snap2d++;
      perf.allocMB += (w * h * 4) / 1048576;    // getImageData always hands back a fresh copy
    }
    sw = w; sh = h;
    if (dataHasInk(sdata)) uiBlank = 0; else uiBlank++;
    checkSurface();
    return true;
  }

  /**
   * ONE shared quarter-scale look at the layer, refreshed at most once per scan tick.
   * Every detector used to pull its own copy - the prompt fallback and the card shape scan both
   * called downscale() on the same tick, i.e. two blocking readbacks for one frame of information -
   * and the two box scans added a full-resolution readback on top. They all read this buffer now,
   * and a full-resolution read is spent only to refine something the snapshot already found.
   */
  let snapAt = 0;
  function snapshot() {
    const t0 = now();
    try { return snapshotInner(); }
    finally { perf.snap += now() - t0; perf.snapN++; }
  }
  function snapshotInner() {
    const t = now();
    if (sdata && t - snapAt < ((F.opts && F.opts.scanTickMs) || 66)) return true;
    if (!downscale()) return false;
    snapAt = t;
    return true;
  }

  /**
   * Flat white on the downscaled surface, read by index. `spx()` used to build a 4-element array
   * per pixel tested - ~108k of them per whole-surface scan at 1680x1031 - which is exactly the
   * allocation pattern that cost the page 141 -> 27.6 fps in bubbleInBox.
   */
  const WHT_S = (d, i) => d[i + 3] > 120 && d[i] >= 225 && d[i + 1] >= 225 && d[i + 2] >= 225;

  /* floodComponents lives in src/vision.js (AutoFishVision). */

  /** @type {Uint8Array | null} */
  let seenBuf = null;
  function blobs(match, minPx) {
    const total = sw * sh;
    if (!seenBuf || seenBuf.length !== total) seenBuf = new Uint8Array(total);
    return floodComponents(sw, sh, sdata, match, minPx, seenBuf);
  }

  /** Dark glyphs on a white field — what separates a prompt from any other white blob. */
  function inkMix(r) {
    // Index reads only. A card is 304x420, so the array-per-pixel version allocated 127,000 arrays
    // per call and this runs on every whole-surface card scan.
    const d = r.d, n = r.w * r.h;
    let dark = 0, white = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (d[i + 3] > 120) {
        if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 150) dark++;
        if (d[i] >= 225 && d[i + 1] >= 225 && d[i + 2] >= 225) white++;
      }
    }
    return n ? { dark: dark / n, white: white / n } : { dark: 0, white: 0 };
  }

  let promptAt = 0;
  function bubbleAnywhere() {
    const t = now();
    if (t - promptAt < 350) return null;          // full-surface readback: 3 Hz is plenty for a prompt
    promptAt = t;
    if (F.geo) return null;                       // a dial on screen means the prompt is already gone
    if (!snapshot()) return null;                 // shared quarter read, no second copy of the layer
    /** @type {any} */
    let best = null;
    const comps = blobs(WHT_S, 30);
    for (let i = 0; i < comps.length; i++) {
      const b = comps[i];
      const W = (b.x1 - b.x0 + 1) * SDOWN, H = (b.y1 - b.y0 + 1) * SDOWN;
      if (W < 45 || W > 190 || H < 24 || H > 110) continue;
      const ar = W / H;
      if (ar < 1.05 || ar > 4.6) continue;
      if ((b.count * SDOWN * SDOWN) / (W * H) < 0.42) continue;
      const x = b.x0 * SDOWN, y = b.y0 * SDOWN;
      const r = readUI(x, y, W, H);
      if (!r) continue;
      const ink = inkMix(r);
      if (ink.white < 0.45 || ink.dark < 0.02 || ink.dark > 0.5) continue;
      const cand = { cx: Math.round(x + W / 2), cy: Math.round(y + H / 2), w: W, h: H, n: b.count * SDOWN * SDOWN, via: 'anywhere' };
      const gm = glyphMetrics(r.d, r.w, 0, r.w, 0, r.h);
      cand.glyph = gm.ok; cand.gdark = +gm.dark.toFixed(3); cand.gsoft = +gm.soft.toFixed(3);
      if (!best || cand.n > best.n) best = cand;
    }
    if (best) L('bubble anywhere', { cx: best.cx, cy: best.cy, w: best.w, h: best.h });
    return best;
  }

  /**
   * Reading the UI layer is a GPU readback, and it is not free: a 360x210 read measured ~2.1 ms
   * against the live game, which is most of a 144 Hz frame. The prompts it looks for (CAST!,
   * REEL!) stay on screen for seconds, so there is nothing to gain from scanning 84 times a
   * second - 25 Hz while idle and 11 Hz while a dial is locked (a dial on screen means the cast
   * prompt is gone) detects a prompt tens of milliseconds after it appears.
   *
   * The order is the point: the shared snapshot answers "is there anything there" for free, and
   * only a yes buys the full-resolution read that refines the centre.
   */
  /* glyphMetrics lives in src/vision.js (AutoFishVision). */

  /* ---- nearby-player guard -------------------------------------------------
   * A nearby player's name tag is the same white-with-dark-text shape one size
   * smaller than CAST!/REEL!. Tapping one opens that player's profile and the
   * run stalls behind the modal (reported live on BrowserOS-neo: bot beside
   * another player, tap opened the profile, no prompt, no dial).
   * Rule: a boxed sighting must repeat at the same spot before it may tap, and
   * since 3.9.33 it must also carry prompt glyphs (tall dark runs, not tag text);
   * an `anywhere` blob never confirms (the Space rung still casts); three
   * taps on one spot that never produce a dial suppress that spot for 30 s.
   * One record does both jobs: sightings continue through a block, so the
   * tap count cannot go stale while taps are held.
   */
  var BUBBLE_CONFIRM_PX = 12;
  var BUBBLE_CONFIRM_MS = 2000;
  var PLAYER_TAPS = 3;
  var PLAYER_BLOCK_MS = 30000;
  /** A player profile open over the game swallows inputs and hides prompts. DOM-visible
   * (the dialog's buttons), so no readback. Our own panel lives in closed shadow DOM,
   * which this scan cannot see, so no self-exclusion is needed. */
  F.profileOpen = function () {
    try {
      if (typeof document === 'undefined' || !document.querySelectorAll) return false;
      var bs = document.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) {
        var tx = (bs[i].textContent || '').trim();
        if (tx === 'Send DM' || tx === 'Burrows') return true;
      }
    } catch (e) {}
    return false;
  };

  /** Try to dismiss an open player profile. Unverified live: if the game does not bind
   * Escape, this is a no-op and the session pause holds the clock instead. */
  function tryEscapeProfile(t) {
    if (t - (F.lastProfileCheck || 0) <= 2000) return;
    F.lastProfileCheck = t;
    if (!F.profileOpen()) return;
    if (t - (F.lastEscape || 0) <= 5000) return;
    F.lastEscape = t;
    try {
      var escInit = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
      document.dispatchEvent(new KeyboardEvent('keydown', escInit));
      document.dispatchEvent(new KeyboardEvent('keyup', escInit));
    } catch (e) {}
    L('escape profile', {});
  }

  function bubbleConfirmed(b, t) {
    if (!b || b.via === 'anywhere') return false;
    if (b.glyph === false) return false;   // fail closed: a blob carrying opaque tag text never taps
    var p = F.bubblePrev;
    var same = !!p && Math.abs(p.x - b.cx) <= BUBBLE_CONFIRM_PX &&
      Math.abs(p.y - b.cy) <= BUBBLE_CONFIRM_PX && (t - p.at) <= BUBBLE_CONFIRM_MS;
    F.bubblePrev = { x: b.cx, y: b.cy, at: t, n: same ? p.n + 1 : 1,
      taps: same ? (p.taps || 0) : 0,
      blockedUntil: same ? (p.blockedUntil || 0) : 0 };
    var q = F.bubblePrev;
    if (q.blockedUntil && t < q.blockedUntil) return false;
    return q.n >= 2;
  }
  function noteBubbleTap(t) {
    var q = F.bubblePrev;
    if (!q) return;
    q.taps += 1;
    if (q.taps >= PLAYER_TAPS) q.blockedUntil = t + PLAYER_BLOCK_MS;
  }

  F.findBubble = function () {
    const t = now();
    if (t - (F.bubbleScanAt || 0) < (F.geo ? 90 : 40)) return null;
    F.bubbleScanAt = t;
    if (!snapshot()) return null;
    if (bubbleGate()) {
      const b = bubbleInBox();
      if (b) return b;
    }
    // This surface missed. Ask the other canvas before concluding there is no prompt; a miss costs
    // one boxed readback and it is throttled, while a wrong surface costs the whole session.
    if (t - (F.altAt || 0) > 300) {
      F.altAt = t;
      const alt = probeOtherSurface();
      if (alt) return alt;
    }
    return bubbleAnywhere();
  };

  /**
   * The catch card: a parchment panel that blocks the next cast until it is tapped away.
   * It is drawn on the same UI layer, so it is found by colour and area - a cream fill over a
   * wide centre rect. The dial cannot trip this: it covers well under the 45% threshold.
   */
  const CARD_BOX_REF = { x: 620, y: 315, w: 365, h: 405, cw: 1179, ch: 821 };
  /** The card box follows the live canvas, like promptBox(). At 1920x1080 the fixed 1179x821
   * rectangle was reading cream world art and tapping it every four seconds. */
  function cardBox(cw, ch) {
    const W = Math.max(1, Math.round(cw || CARD_BOX_REF.cw));
    const H = Math.max(1, Math.round(ch || CARD_BOX_REF.ch));
    const sx = W / CARD_BOX_REF.cw, sy = H / CARD_BOX_REF.ch;
    const w = Math.min(W, Math.max(260, Math.round(CARD_BOX_REF.w * sx)));
    const h = Math.min(H, Math.max(300, Math.round(CARD_BOX_REF.h * sy)));
    const x = Math.max(0, Math.min(W - w, Math.round(CARD_BOX_REF.x * sx)));
    const y = Math.max(0, Math.min(H - h, Math.round(CARD_BOX_REF.y * sy)));
    return { x, y, w, h };
  }

  /**
   * Cheap "might a card be up?" test on the shared snapshot: a card is a big parchment panel, so a
   * sparse cream count over its box answers without a readback, and the full-resolution card read
   * only happens when this says yes. A tinted card can slip past it, which is why the shape scan
   * below still runs on every card tick.
   */
  function cardGate() {
    const box = cardBox(uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    const x0 = Math.max(0, Math.floor(box.x / SDOWN));
    const y0 = Math.max(0, Math.floor(box.y / SDOWN));
    const x1 = Math.min(sw, Math.ceil((box.x + box.w) / SDOWN));
    const y1 = Math.min(sh, Math.ceil((box.y + box.h) / SDOWN));
    let hit = 0, n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0, i = (y * sw + x0) * 4; x < x1; x += 2, i += 8) {
        n++;
        if (sdata[i + 3] > 60 && sdata[i] > 195 && sdata[i + 1] > 175 && sdata[i + 2] > 105 && sdata[i + 2] < 252) hit++;
      }
    }
    return n > 0 && hit / n >= 0.08;
  }

  function creamFraction(r) {
    const d = r.d, w = r.w, h = r.h;
    let hit = 0, n = 0;
    for (let y = 6; y < h - 6; y += 8) {
      for (let x = 6; x < w - 6; x += 8) {
        n++;
        const i = (y * w + x) * 4;
        if (d[i + 3] > 60 && d[i] > 225 && d[i + 1] > 200 && d[i + 2] > 130 && d[i + 2] < 238) hit++;
      }
    }
    return n ? hit / n : 0;
  }

  function cardInBox() {
    const box = cardBox(uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    const r = readUI(box.x, box.y, box.w, box.h);
    if (!r) return null;
    const frac = creamFraction(r);
    if (frac < 0.2) return null;      // paper is 249,238,208 and covers ~28% once art and frame are excluded
    return { cx: Math.round(r.x + r.w / 2), cy: Math.round(r.y + r.h / 2), frac: +frac.toFixed(2), via: 'box' };
  }

  /**
   * A rare catch tints the card frame by rarity (epic is pink), so "is it cream?" is out on exactly
   * the catches worth recording. Every card, though, is a big solid opaque panel. The first shape
   * pass took the largest connected opaque blob and trusted its bounding box; an event card broke it
   * - its illustration spills far past the frame, so the blob measured 700x576 at 46% fill, was
   * rejected, and the bot sat in front of a card it could not see. Instead: find a solid seed the
   * size of the smallest card, grow it while it stays solid (spilt artwork cannot fill the grown
   * rectangle), and tap the seed's centre, which is inside the frame by construction. Bounded by the
   * largest card and by a share of the layer, so an opaque layer is not mistaken for a card, and a
   * card always prints text, so require ink.
   */
  const CARD_MIN_W = 180, CARD_MIN_H = 250, CARD_MAX_W = 760, CARD_MAX_H = 820;
  let shapeAt = 0;
  /** @type {Int32Array | null} */
  let cardI = null;                 // the integral image is reused: this runs up to 2.5x/s
  function cardByShape() {
    const t = now();
    if (t - shapeAt < 400) return null;
    shapeAt = t;
    if (!snapshot()) return null;              // shared quarter read, no second copy of the layer
    const stride = sw + 1;
    const need = stride * (sh + 1);
    // Row 0 and column 0 are never written by the pass below, so a reused buffer keeps its zeros.
    if (!cardI || cardI.length !== need) cardI = new Int32Array(need);
    /** @type {Int32Array} */
    const I = cardI;
    for (let y = 0; y < sh; y++) {
      let row = 0;
      for (let x = 0; x < sw; x++) {
        if (sdata[(y * sw + x) * 4 + 3] > 250) row++;
        I[(y + 1) * stride + x + 1] = I[y * stride + x + 1] + row;
      }
    }
    const sum = (x0, y0, x1, y1) => I[y1 * stride + x1] - I[y0 * stride + x1] - I[y1 * stride + x0] + I[y0 * stride + x0];
    const CW = Math.ceil(CARD_MIN_W / SDOWN), CH = Math.ceil(CARD_MIN_H / SDOWN);
    if (sw < CW || sh < CH) return null;
    /** @type {{ x: number, y: number, n: number } | null} */
    let seed = null;
    for (let y = 0; y + CH <= sh; y++) {
      for (let x = 0; x + CW <= sw; x++) {
        const n = sum(x, y, x + CW, y + CH);
        if (!seed || n > seed.n) seed = { x, y, n };
      }
    }
    if (!seed || seed.n / (CW * CH) < 0.94) return null;   // nothing card-sized and solid here
    if (I[sh * stride + sw] / (sw * sh) > 0.6) return null; // an opaque layer is the world, not a card
    const solid = (x0, y0, x1, y1) => sum(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0)) >= 0.88;
    let x0 = seed.x, y0 = seed.y, x1 = x0 + CW, y1 = y0 + CH;
    const MAXW = Math.floor(CARD_MAX_W / SDOWN), MAXH = Math.floor(CARD_MAX_H / SDOWN);
    let grew = true;
    for (let guard = 0; grew && guard < 4000; guard++) {
      grew = false;
      if (x1 < sw && x1 - x0 < MAXW && solid(x0, y0, x1 + 1, y1)) { x1++; grew = true; }
      if (x0 > 0 && x1 - x0 < MAXW && solid(x0 - 1, y0, x1, y1)) { x0--; grew = true; }
      if (y1 < sh && y1 - y0 < MAXH && solid(x0, y0, x1, y1 + 1)) { y1++; grew = true; }
      if (y0 > 0 && y1 - y0 < MAXH && solid(x0, y0 - 1, x1, y1)) { y0--; grew = true; }
    }
    const W = (x1 - x0) * SDOWN, H = (y1 - y0) * SDOWN;
    if (W < CARD_MIN_W || W > CARD_MAX_W || H < CARD_MIN_H || H > CARD_MAX_H) return null;
    if (!uiCanvas || W * H > uiCanvas.width * uiCanvas.height * 0.7) return null;    // the layer itself is opaque, not a card
    const r = readUI(x0 * SDOWN, y0 * SDOWN, W, H);
    if (!r) return null;
    const ink = inkMix(r);
    const shape = cardShapeOk({ w: W, h: H, ink: ink.dark });
    if (!shape.card) {                                                 // reel UI, not a card
      L('shape rejected', { why: shape.why, w: W, h: H, ink: +ink.dark.toFixed(3) });
      return null;
    }
    const fill = sum(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
    const cand = {
      cx: Math.round(seed.x * SDOWN + (CW * SDOWN) / 2),
      cy: Math.round(seed.y * SDOWN + (CH * SDOWN) / 2),
      w: W, h: H, frac: +fill.toFixed(2), via: 'shape'
    };
    L('card by shape', { cx: cand.cx, cy: cand.cy, w: cand.w, h: cand.h, fill: cand.frac, ink: +ink.dark.toFixed(3) });
    return cand;
  }

  /**
   * A catch card waits for a tap, so finding it 38 times a second buys nothing: the idle branch of
   * step() asks every frame, and each ask re-reads a 365x405 box plus (every 400 ms) the whole
   * downscaled surface. That measured 157 ms of every second at 4.1 ms a call. 10 Hz is ten
   * chances before the cast prompt could matter.
   *
   * Both detectors now read the one shared snapshot: the box read is spent only when the snapshot
   * sees parchment, and the shape scan costs no readback at all until it has grown a candidate.
   */
  F.findCatch = function () {
    const t = now();
    if (t - (F.cardCheckAt || 0) < (F.opts.cardCheckMs || 100)) return null;
    F.cardCheckAt = t;
    if (!snapshot()) return null;
    if (cardGate()) {
      const c = cardInBox();
      if (c) return c;
    }
    return cardByShape();
  };
  /**
   * Text capture. The card is canvas-drawn: no DOM node, no scene text, no local save. But every
   * string is drawn through CanvasRenderingContext2D.fillText (Pixi bakes Text nodes that way),
   * so patching fillText yields the exact words: species | weight | quality | value, with a
   * rarity line only on non-common fish. The patch installs once and its buffer survives
   * re-injection, so re-running the module never re-records old strings.
   */
  function hookText() {
    if (!window.__txtBuf) window.__txtBuf = [];
    if (window.__txtHook) return window.__txtBuf;
    window.__txtHook = true;
    const buf = window.__txtBuf;
    const patch = (proto) => {
      if (!proto || !proto.fillText) return;
      const orig = proto.fillText;
      proto.fillText = function (text, x, y) {
        try {
          buf.push({ t: now(), s: String(text).slice(0, 60) });
          if (buf.length > 600) buf.shift();
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    };
    patch(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype);
    patch(window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype);
    return buf;
  }

  /* textSince and parseCard live in src/vision.js (AutoFishVision). */

  F.parseCatch = function () {
    const out = parseCard(textSince(hookText(), F.txtAt || 0), normTier, function (name) {
      return speciesInfo(name).known;
    });
    F.parseWhy = out.why;
    return out.rec || null;
  };

  /**
   * Catch log. One row per fish, POSTed to the local logger which appends it to catches.csv.
   * Species, rarity, weight and value are read from the card's own text, never inferred.
   */
  function isTrophyCatch(row) {
    return !!(row && (row.rarity === 'Epic' || row.rarity === 'Legendary' || row.rarity === 'Secret' || row.shiny || row.golden));
  }

  /**
   * Read an arbitrary canvas region (used for trophy card capture on gameCanvas when uiCanvas
   * only holds a white silhouette/mask). Runs at most once per trophy catch.
   */
  function readCanvasPixels(c, x, y, w, h) {
    if (!c || !c.width || !c.height) return null;
    if (c === uiCanvas) return readUI(x, y, w, h);
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(c.width - x, Math.round(w));
    h = Math.min(c.height - y, Math.round(h));
    if (w <= 0 || h <= 0) return null;
    try {
      const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
      let g = app && app.renderer && app.renderer.gl;
      if (!g || g.canvas !== c) {
        try { g = c.getContext('webgl2'); } catch (e) { g = null; }
        if (!g) { try { g = c.getContext('webgl'); } catch (e) { g = null; } }
      }
      if (g && g.canvas === c && typeof g.readPixels === 'function' && !(g.isContextLost && g.isContextLost())) {
        const bw = g.drawingBufferWidth, bh = g.drawingBufferHeight;
        if (x + w <= bw && y + h <= bh) {
          const buf = new Uint8Array(w * h * 4);
          const row = new Uint8Array(w * 4);
          let prev = null, ok = false;
          try {
            prev = g.getParameter(g.FRAMEBUFFER_BINDING);
            if (prev) g.bindFramebuffer(g.FRAMEBUFFER, null);
            g.pixelStorei(g.PACK_ALIGNMENT, 1);
            g.readPixels(x, glRowY(bh, y, h), w, h, g.RGBA, g.UNSIGNED_BYTE, buf);
            ok = g.getError() === g.NO_ERROR;
          } catch (e) { ok = false; }
          finally { if (prev) { try { g.bindFramebuffer(g.FRAMEBUFFER, prev); } catch (e) {} } }
          if (ok) {
            flipRows(buf, w, h, row);
            return { d: buf, w, h, x, y };
          }
        }
      }
      const scratch = document.createElement('canvas');
      scratch.width = w; scratch.height = h;
      const sctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!sctx) return null;
      sctx.drawImage(c, x, y, w, h, 0, 0, w, h);
      return { d: sctx.getImageData(0, 0, w, h).data, w, h, x, y };
    } catch (e) { return null; }
  }

  /** Pick whichever surface currently displays settled colored card pixels (never pure white). */
  function pickSettledCardSurface(box) {
    if (!box) return null;
    const uiRaw = uiCanvas ? readUI(box.x, box.y, box.w, box.h) : null;
    if (isCardSettled(uiRaw)) return uiCanvas;
    const gameRaw = gameCanvas && gameCanvas !== uiCanvas ? readCanvasPixels(gameCanvas, box.x, box.y, box.w, box.h) : null;
    if (isCardSettled(gameRaw)) return gameCanvas;
    return null;
  }

  /**
   * Capture the visible catch card from whichever surface holds the settled artwork, padding
   * for overflowing rare art and encoding as transparent WebP (PNG fallback). Never returns a
   * white silhouette blob.
   */
  function captureCardBlob(card, targetCanvas, cb) {
    const c = targetCanvas || uiCanvas;
    if (!c || typeof document === 'undefined' || !card) return cb(null);
    const base = F.lastCardRect || cardBox(c.width, c.height);
    const box = padCardBox(base, c.width, c.height) || base;
    const r = readCanvasPixels(c, box.x, box.y, box.w, box.h);
    if (!r || !r.d || !r.w || !r.h || !isCardSettled(r)) return cb(null);
    try {
      const src = document.createElement('canvas');
      src.width = r.w; src.height = r.h;
      const sctx = src.getContext('2d');
      if (!sctx) return cb(null);
      const img = sctx.createImageData(r.w, r.h);
      img.data.set(r.d.subarray(0, r.w * r.h * 4));
      sctx.putImageData(img, 0, 0);
      const maxW = 480;
      const scale = r.w > maxW ? maxW / r.w : 1;
      const dw = Math.max(1, Math.round(r.w * scale));
      const dh = Math.max(1, Math.round(r.h * scale));
      const out = document.createElement('canvas');
      out.width = dw; out.height = dh;
      const octx = out.getContext('2d');
      if (!octx) return cb(null);
      octx.drawImage(src, 0, 0, dw, dh);
      if (out.toBlob) {
        out.toBlob((blob) => {
          if (blob && blob.size) return cb(blob);
          out.toBlob((png) => cb(png || null), 'image/png');
        }, 'image/webp', 0.86);
      } else {
        cb(null);
      }
    } catch (e) { cb(null); }
  }

  F.recordCatch = function (card) {
    const rec = F.parseCatch();
    if (!rec) return 'pending';
    const info = describeCatch(rec);
    /** @type {HTMLCanvasElement | null} */
    let cardSurface = null;
    if (isTrophyCatch({ rarity: info.rarity, shiny: info.shiny, golden: info.golden })) {
      const settleMs = F.opts && F.opts.trophySettleMs != null ? F.opts.trophySettleMs : 900;
      const ref = uiCanvas || gameCanvas;
      const box = F.lastCardRect || (ref ? cardBox(ref.width, ref.height) : null);
      cardSurface = pickSettledCardSurface(box);
      if (!cardSurface) {
        const at = now();
        if (!F.trophyWaitAt) F.trophyWaitAt = at;
        if (at - F.trophyWaitAt < settleMs) return 'trophy-wait';
        L('trophy settle timeout', { species: rec.species, elapsedMs: Math.round(at - F.trophyWaitAt) });
      }
    }
    F.trophyWaitAt = 0;
    clearResultMissing('catch card');
    F.txtAt = now();
    // A parsed catch proves the character was seated and fishing, whatever the watchdog last
    // concluded. Without this, a long attempt or a slow card leaves the flag set and the session
    // pauses on seat until a prompt (or the seat probe) clears it.
    F.needsSeat = false;                                    // a parsed catch: the character is seated
    // The card prints a rarity word only for non-common fish. Fill the blank from the catalogue
    // and carry the source, never a pixel guess.
    if (!rec.rarity) rec.rarity = info.rarity;
    const row = Object.assign({ t: Date.now(), frac: card && card.frac }, rec);
    row.rarity = info.rarity;
    row.raritySource = info.derived ? 'catalogue' : 'card';
    row.shiny = info.shiny;
    row.golden = info.golden;
    row.profile = logProfile;
    F.catches.push(row);
    // A sequence, not the ring's length: the session's no-catch clock (panel -> session.js) only
    // advances on a strictly larger fact, so a 400-row display ring froze it after 400 fish.
    F.stats.catchSeq = (F.stats.catchSeq || 0) + 1;
    if (F.catches.length > 400) F.catches.shift();
    L('catch logged', { species: row.species, rarity: row.rarity, derived: info.derived, shiny: info.shiny, quality: row.quality, weight: row.weight, value: row.value });
    // Local ledger: the only history the server-free install keeps. Never allowed to throw.
    try {
      const book = addToLog(loadLedger(), info, Date.now());
      trimLog(book, 60);
      if (!saveLedger(book)) L('ledger not saved (storage blocked or full)');
    } catch (e) { L('ledger failed', { err: String((e && e.message) || e) }); }
    // Parsed catch text is the only oracle in this system: it closes the fish attempt that earned it.
    if (F.pendingWin) {
      const pr = F.pendingWin;
      pr.cardMs = pr.closedAt != null ? Math.round(now() - pr.closedAt) : null;
      pr.landed = true;
      clearPendingWin();
    }
    if (F.attempt) {
      F.attempt.species = row.species;
      F.attempt.rarity = row.rarity;
      resolveAttempt('caught', now(), null);
    }
    if (F.logUrl) {
      try {
        fetch(F.logUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(row) }).catch(function () {});
      } catch (e) {}
    }
    if (typeof F.onCatch === 'function') { try { F.onCatch(row); } catch (e) {} }
    if (isTrophyCatch(row) && typeof F.onTrophy === 'function') {
      try { captureCardBlob(card, cardSurface, (blob) => { try { F.onTrophy(row, blob); } catch (e) {} }); } catch (e) {}
    }
    return 'logged';
  };


  /* --------------------------------------------------------- rim mask ---- */
  /**
   * The dial search tests ~99,000 rim samples per attempt (225 centres x 22 radii x 20 angles).
   * Measured live 2026-10-28: 83 ms per call, 8 calls a second - two thirds of the main thread, and
   * the reason the page fell to 16-32 fps whenever no dial was on screen. Three costs, all
   * removable without touching the geometry: Math.cos/sin per sample (measured 14 ms), a 4-element
   * array per sample (10 ms), and re-testing the same pixels for every candidate circle. So the
   * direction tables are built once, the predicates read the buffer by index, and one pass marks
   * every rim pixel for the search to count.
   */
  const RIM_C20 = new Float64Array(20), RIM_S20 = new Float64Array(20);
  for (let k = 0; k < 20; k++) { const a = k * Math.PI / 10; RIM_C20[k] = Math.cos(a); RIM_S20[k] = Math.sin(a); }
  const RIM_C40 = new Float64Array(40), RIM_S40 = new Float64Array(40);
  for (let k = 0; k < 40; k++) { const a = k * Math.PI / 20; RIM_C40[k] = Math.cos(a); RIM_S40[k] = Math.sin(a); }
  const DIAL_N = 72, DIAL_C = new Float64Array(DIAL_N), DIAL_S = new Float64Array(DIAL_N);
  for (let k = 0; k < DIAL_N; k++) { const a = k * 2 * Math.PI / DIAL_N; DIAL_C[k] = Math.cos(a); DIAL_S[k] = Math.sin(a); }
  const PIN_F = [], PIN_C = [], PIN_S = [];
  for (let f = 0.58; f <= 0.881; f += 0.075) {
    for (let deg = -9; deg <= 9.1; deg += 4.5) {
      const a = deg * Math.PI / 180;
      PIN_F.push(f); PIN_C.push(Math.cos(a)); PIN_S.push(Math.sin(a));
    }
  }
  const PIN_N = PIN_F.length;
  // Candidate offsets for the whole-surface recovery. The blob is an ARC, so its bbox centre can
  // sit anywhere from the dial centre out to ~0.9R from it (an 85-degree sector's bbox centre is
  // much closer than 0.7R) - sweeping every ring is what makes the guess independent of where the
  // wedge happens to be. Each ring is sampled every ~6 px of arc, so the nearest candidate is at
  // most 3 px from the true centre at any distance. Built once, like the rim tables.
  const ANNULUS = [];
  for (let dist = 0; dist <= 100; dist += 4) {
    const n = dist === 0 ? 1 : Math.max(12, Math.ceil(2 * Math.PI * dist / 6));
    for (let k = 0; k < n; k++) {
      const rad = (k / n) * Math.PI * 2;
      ANNULUS.push({ dx: dist * Math.cos(rad), dy: dist * Math.sin(rad) });
    }
  }

  /** RIM() read off the buffer: the same predicate, without allocating a pixel array. */
  function isRim(d, i) {
    if (d[i + 3] <= 60) return false;
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    const mx = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0);
    const mn = r0 < g0 ? (r0 < b0 ? r0 : b0) : (g0 < b0 ? g0 : b0);
    if (mx - mn > 22) return false;
    const lu = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
    return lu >= 158 && lu <= 246;
  }
  /** GRN() by index: nearest-tone match, wedge has to win by the same margin. */
  function isGreen(d, i) {
    if (d[i + 3] <= 60) return false;
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    const wr = r0 - 182, wg = g0 - 188, wb = b0 - 132;
    const w = wr * wr + wg * wg + wb * wb;
    if (w >= 1100) return false;
    const br = r0 - 142, bg = g0 - 138, bb = b0 - 111;
    return w * 1.8 < br * br + bg * bg + bb * bb;
  }
  /** PIN() by index. */
  function isPin(d, i) {
    if (d[i + 3] <= 60) return false;
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    return r0 > 185 && g0 > 85 && g0 < 165 && b0 < 135 && r0 - g0 > 55;
  }
  /**
   * One pass per read: 1 where a rim pixel sits, indexed y * w + x.
   *
   * The buffer is reused. A fresh 420x420 Uint8Array per recovery blob measured 2.04 MB/s of
   * allocation on its own - the same large-object pressure that made the whole page hitch.
   * Only one mask is live at a time (every caller finishes with it before the next read).
   */
  /** @type {Uint8Array | null} */
  let rimMaskBuf = null;
  function rimMask(r) {
    const d = r.d, n = r.w * r.h;
    if (!rimMaskBuf || rimMaskBuf.length < n) rimMaskBuf = new Uint8Array(n);
    /** @type {Uint8Array} */
    const m = rimMaskBuf;
    m.fill(0, 0, n);
    for (let p = 0, i = 0; p < n; p++, i += 4) if (isRim(d, i)) m[p] = 1;
    return m;
  }
  /** How many of `steps` rim directions around (cx, cy, R) land on a rim pixel. */
  function rimHits(m, r, cx, cy, R, cos, sin, steps) {
    const w = r.w, h = r.h, ox = r.x, oy = r.y;
    let hit = 0;
    for (let k = 0; k < steps; k++) {
      const x = Math.round(cx + R * cos[k]) - ox, y = Math.round(cy + R * sin[k]) - oy;
      if (x >= 0 && y >= 0 && x < w && y < h && m[y * w + x]) hit++;
    }
    return hit;
  }

  /* ------------------------------------------------------------ dial ----- */
  /**
   * Find the dial near a hint: grey annulus + two-tone interior, else null.
   *
   * The widget sits in ONE place for a whole session, so a circle that locked before is tried first.
   * That matters because the hint can be wrong: false bubble detections (name tags, chat, the reel
   * panel) moved it 100 px off the real dial on 2026-10-29, and a +/-22 px search around a wrong
   * hint can never reach the dial. A hit costs one read and no mask; a miss falls through to the
   * search below with the same cost as before.
   */
  /**
   * Refine the best coarse circle and prove it is the dial. Shared by the hinted search and the
   * whole-surface recovery, so their validation can never diverge.
   */
  function finishLock(r, mask, best) {
    let bestR = best.R, bestN = -1;
    for (let R = Math.max(74, best.R - 8); R <= best.R + 8; R++) {
      const n = rimHits(mask, r, best.cx, best.cy, R, RIM_C40, RIM_S40, 40);
      if (n > bestN) { bestN = n; bestR = R; }
    }
    const geo = { cx: best.cx, cy: best.cy, R: bestR };
    const s = F.sample(geo);
    if (!s || !s.valid || s.ring < 0.75) return null;
    geo.width = s.width;
    return geo;
  }

  /**
   * The coarse scan: every candidate circle around the hint, scored by how many of its 20 rim samples
   * land on a rim pixel. Its own function because it was 30.28 ms a call in 3.8.2 while the same loop
   * standalone was 1.4 ms - living inside `lockDial` kept it out of optimised code, and function size
   * alone did not explain it (padding a bench function to 1,200 statements cost nothing).
   *
   * The scan is inlined over the mask rather than calling `rimHits` once per circle: on Gecko those
   * helper calls cost more than the whole search (31-33 ms against 8-11 ms, same answer, measured
   * 2026-10-29). 15/20, not 17 - see the note on the gate below.
   */
  function coarseScan(mask, rw, rh, ox, oy, hintX, hintY, half, step, C, S) {
    /** @type {{ cx: number, cy: number, R: number, score: number } | null} */
    let best = null;
    for (let dy = -half; dy <= half; dy += step) {
      for (let dx = -half; dx <= half; dx += step) {
        const cx = Math.round(hintX + dx), cy = Math.round(hintY + dy);
        for (let R = 78; R <= 120; R += 2) {
          let hit = 0;
          for (let k = 0; k < 20; k++) {
            const x = Math.round(cx + R * C[k]) - ox, y = Math.round(cy + R * S[k]) - oy;
            if (x >= 0 && y >= 0 && x < rw && y < rh && mask[y * rw + x]) hit++;
          }
          // 15, not 17. The gate used to accept only 17 of 20 rim samples, and the live dial at a
          // 1680x1031 viewport measures EXACTLY 17 (R=96): one anti-aliased sample and the search
          // finds nothing while the dial is plainly on screen. Measured 2026-10-29: 1 lock in 20
          // minutes with the threshold at 17. The pin gate and the wedge requirement in sample()
          // are what reject non-dials, not this count.
          if (hit >= 15 && (!best || hit > best.score)) best = { cx, cy, R, score: hit };
        }
      }
    }
    return best;
  }

  /* The scan is also compiled as a standalone function at startup. In 3.8.2-3.8.5 the same loop took
   * 30 ms a call inside the userscript while the identical source eval'd in the page took 2.3 ms, and
   * 3.8.3's extraction into its own function changed nothing - so the difference is the instance's
   * compilation context, not the code. `new Function` gives the same source a fresh, small scope with
   * no closure at all (the direction tables are passed in for exactly that reason). If the page's CSP
   * forbids eval, the call throws and the literal function is used instead: same answer, old cost.
   */
  /** @type {any} */
  let scanDial = coarseScan;
  /** @type {any} */
  let scanCompiled = null;
  /** @type {string | null} */
  let scanCompileError = null;
  try {
    scanCompiled = new Function('"use strict"; return (' + coarseScan.toString() + ');')();
    scanDial = scanCompiled;
  } catch (e) {
    scanCompileError = String((e && e.message) || e);
  }

  F.lockDial = function (hintX, hintY, span) {
    const S = 240, hw = S / 2;
    // The span is how much the caller already distrusts its hint: +/-22 normally, wider after the
    // whole-surface recovery hands over a blob centre, and 2 px steps when the target is close.
    const half = span == null ? 22 : Math.max(0, Math.round(span));
    const step = half <= 12 ? 2 : 3;
    // The remembered circle is tried at most every memoEveryMs, not on every call. Tried every time
    // (3.8.6) it answered 38 of 4,611 calls - 0.8% - and cost 2.84 ms of a 6.48 ms call, because
    // step() asks for a dial ~4-6 times a second when there is nothing on screen. A miss is a full
    // sample() readback that the search below then repeats. Gating it keeps the recovery (a wrong
    // hint still finds the remembered widget, one gate-interval later) and drops the readback.
    const tNow = now();
    // Two conditions, counted separately: a dial must have been locked recently enough for the
    // remembered circle to still be a dial, and the readback itself is rate-limited.
    const recent = tNow - (F.lastLockAt || 0) <= MEMO_RECENT_MS;
    if (F.lastGeo && recent && tNow - (F.memoAt || 0) >= MEMO_EVERY_MS) {
      F.memoAt = tNow;
      const tMemo = now();
      const g = { cx: F.lastGeo.cx, cy: F.lastGeo.cy, R: F.lastGeo.R };
      const s = F.sample(g);
      perf.lockMemo += now() - tMemo;                 // the hit AND the miss: a miss still paid a read
      if (s && s.valid && s.ring >= 0.8) {
        g.width = s.width;
        if (!ghostBlocked(g, g.width, tNow, F.ghostGeo, F.opts)) {
          perf.lockMemoN++; F.lastLockAt = tNow; return g;
        }
      }
    } else if (F.lastGeo) {
      perf.lockMemoSkipped++;
      if (!recent) perf.lockMemoCold++;
    }
    const tGrab = now();
    const r = readUI(hintX - hw, hintY - hw, S, S);
    perf.lockGrab += now() - tGrab;
    if (!r) return null;
    // Mark the rim pixels once, then count them per candidate circle instead of re-testing the
    // same ~4,950 circles pixel by pixel (that was 83 ms a call; this is ~10 ms).
    const tMask = now();
    const mask = rimMask(r);
    perf.lockMask += now() - tMask;
    const rw = r.w, rh = r.h, ox = r.x, oy = r.y;
    const tScan = now();
    const best = scanDial(mask, rw, rh, ox, oy, hintX, hintY, half, step, RIM_C20, RIM_S20);
    perf.lockScan += now() - tScan;
    if (!best) return null;
    const tRefine = now();
    const locked = finishLock(r, mask, best);
    perf.lockRefine += now() - tRefine;
    if (locked && ghostBlocked(locked, locked.width, tNow, F.ghostGeo, F.opts)) return null;
    if (locked) F.lastLockAt = tNow;                // a dial is up: the memo is worth a read again
    return locked;
  };

  /** The wedge is the one green thing on the UI layer, and it has to survive a 4x downscale. */
  const GREEN_LOOSE = (d, i) => d[i + 3] > 60 && d[i + 1] > d[i + 2] + 30 && d[i + 1] >= d[i] - 5;

  /**
   * Is this blob's full-resolution bbox the right size to hold a wedge? The wedge is a sector up to
   * ~165 deg and ~0.55R-0.9R deep, so its bbox reaches ~1.8R per side - ~215 px at the largest dial.
   * The first version of this window capped H at 90 px from a guess, which rejects the real widget;
   * only specks and whole-surface washes are filtered here, and finishLock proves the circle.
   */
  function wedgeBoxOk(W, H) {
    return W >= 24 && H >= 24 && W <= 340 && H <= 340;
  }

  function greenBlobs() {
    if (!snapshot()) return [];
    const out = [];
    // 6 quarter-scale pixels = 96 full-resolution ones. A 30-degree arc at the smallest dial is
    // still ~45 after the downscale; this only drops anti-aliasing speckle and thin fragments.
    for (const b of blobs(GREEN_LOOSE, 6)) {
      if (!wedgeBoxOk((b.x1 - b.x0 + 1) * SDOWN, (b.y1 - b.y0 + 1) * SDOWN)) continue;
      out.push(b);
      if (out.length >= 3) break;
    }
    return out;
  }

  /**
   * Last-resort dial search. The hint can be wrong (no prompt yet, a false bubble earlier), and a
   * +/-22 px search around a wrong hint can never reach the widget: measured 2026-10-29, F.hint sat
   * at (739,369) while the dial was at (840,411). The wedge gives the position away: the dial's
   * centre lies somewhere on an annulus around the blob's bbox centre, so one boxed full-resolution
   * read tests that annulus with the same rim mask the normal search uses. Recovery
   * only: the caller gates it on a long stretch with no dial, and the throttle keeps it off the
   * per-frame path.
   */
  function dialAnywhere() {
    const t = now();
    // Backed off, not a fixed 900 ms: see dialFallbackWait. The pass itself is unchanged, so the
    // recovery still works whenever a dial really is somewhere off the hint.
    if (t - (F.dialAnyAt || 0) < dialFallbackWait(F.dialAnyFail, F.opts)) return null;
    F.dialAnyAt = t;
    const greens = greenBlobs();
    if (!greens.length) {
      F.dialAnyFail = (F.dialAnyFail || 0) + 1;
      return null;
    }
    const S = 420, hw = S / 2;
    for (const b of greens) {
      const gx = Math.round((b.x0 + b.x1 + 1) * SDOWN / 2);
      const gy = Math.round((b.y0 + b.y1 + 1) * SDOWN / 2);
      const r = readUI(gx - hw, gy - hw, S, S);
      if (!r) continue;
      const mask = rimMask(r);
      /** @type {{ cx: number, cy: number, R: number, score: number } | null} */
      let best = null;
      for (const off of ANNULUS) {
        const cx = Math.round(gx + off.dx);
        const cy = Math.round(gy + off.dy);
        for (let R = 80; R <= 116; R += 4) {
          const hit = rimHits(mask, r, cx, cy, R, RIM_C20, RIM_S20, 20);
          if (hit >= 15 && (!best || hit > best.score)) best = { cx, cy, R, score: hit };
        }
      }
      if (!best) continue;
      // The annulus is a coarse grid: refine the centre before the rim count is allowed to decide.
      let fine = best;
      for (let dy = -4; dy <= 4; dy += 2) {
        for (let dx = -4; dx <= 4; dx += 2) {
          for (let R = Math.max(78, best.R - 4); R <= best.R + 4; R += 2) {
            const hit = rimHits(mask, r, best.cx + dx, best.cy + dy, R, RIM_C20, RIM_S20, 20);
            if (hit > fine.score) fine = { cx: best.cx + dx, cy: best.cy + dy, R, score: hit };
          }
        }
      }
      const geo = finishLock(r, mask, fine);
      if (geo) {
        if (ghostBlocked(geo, geo.width, t, F.ghostGeo, F.opts)) continue;
        F.dialAnyFail = 0;
        L('dial found anywhere', { cx: geo.cx, cy: geo.cy, R: geo.R, width: Math.round(geo.width) });
        return geo;
      }
    }
    F.dialAnyFail = (F.dialAnyFail || 0) + 1;
    return null;
  }

  /**
   * One frame of dial state. Re-tests the rim over a small radius band so the dial's
   * fade-in / scale-in cannot drop the lock, then reads the wedge at 0.69R.
   */
  const dialSamples = new Uint8Array(DIAL_N);
  F.sample = function (geo) {
    const pad = 14, half = Math.round(Math.max(geo.R, 100) + pad);
    const r = readUI(geo.cx - half, geo.cy - half, half * 2, half * 2);
    if (!r) return null;

    const d = r.d, rw = r.w, rh = r.h, ox = r.x, oy = r.y;
    let bestR = geo.R, bestHit = -1;
    for (let dR = -6; dR <= 8; dR += 2) {
      const R = geo.R + dR;
      let hit = 0;
      for (let k = 0; k < 20; k++) {
        const x = Math.round(geo.cx + R * RIM_C20[k]) - ox, y = Math.round(geo.cy + R * RIM_S20[k]) - oy;
        if (x >= 0 && y >= 0 && x < rw && y < rh && isRim(d, (y * rw + x) * 4)) hit++;
      }
      if (hit > bestHit) { bestHit = hit; bestR = R; }
    }
    const ring = bestHit / 20;
    if (bestHit >= 15) geo.R = bestR;

    const n = DIAL_N, rr = Math.round(geo.R * 0.69);        // 63px at the measured R~91
    const b = dialSamples;
    let greenN = 0;
    for (let k = 0; k < n; k++) {
      // 0 = 12 oclock, clockwise
      const x = Math.round(geo.cx + rr * DIAL_S[k]) - ox, y = Math.round(geo.cy - rr * DIAL_C[k]) - oy;
      const inside = x >= 0 && y >= 0 && x < rw && y < rh;
      // 1 = wedge, 2 = pin (wildcard), 0 = disc base. Only the pin own +-10 deg band is
      // blanked; a stray orange elsewhere must not manufacture a phantom arc.
      const nearPin = k <= 2 || k >= n - 2;
      const v = inside && isGreen(d, (y * rw + x) * 4) ? 1 : (nearPin ? 2 : 0);
      if (v === 1) greenN++;
      b[k] = v;
    }
    // The pin is fixed at 12 oclock and always painted, so it doubles as a geometry check:
    // if no orange appears anywhere in that band, this circle is not the dial.
    let pinN = 0;
    for (let k = 0; k < PIN_N; k++) {
      const pr = geo.R * PIN_F[k];
      const x = Math.round(geo.cx + pr * PIN_S[k]) - ox, y = Math.round(geo.cy - pr * PIN_C[k]) - oy;
      if (x >= 0 && y >= 0 && x < rw && y < rh && isPin(d, (y * rw + x) * 4)) pinN++;
    }
    if (!pinN) return { ring, valid: false, greenN, pin: false };
    if (greenN < 3) return { ring, valid: false, greenN };
    // Every circular run of non-zero samples (1 = wedge, 2 = pin wildcard).
    const runs = [];
    for (let i = 0; i < n; i++) {
      if (!b[i] || b[(i - 1 + n) % n]) continue;
      let len = 0;
      while (len < n && b[(i + len) % n]) len++;
      if (len < n) runs.push({ s: i, l: len });
    }
    if (!runs.length) return { ring, valid: false, greenN };

    // The pin paints over the wedge at 12 oclock, so it splits ONE arc into two runs. Merging
    // runs separated only by wildcards restores the real arc; without it the tracked midpoint
    // floored about 12 deg short of the pin and no press could ever be centred.
    const runsM = [];
    for (const r0 of runs) {
      const last = runsM[runsM.length - 1];
      if (last) {
        const gap = (r0.s - (last.s + last.l) + n) % n;
        let ok = gap > 0 && gap <= 4;
        for (let k = 0; k < gap && ok; k++) if (b[(last.s + last.l + k) % n] !== 2) ok = false;
        if (ok) { last.l += gap + r0.l; continue; }
      }
      runsM.push({ s: r0.s, l: r0.l });
    }
    if (runsM.length > 1) {
      const first = runsM[0], last = runsM[runsM.length - 1];
      const gap = (first.s - (last.s + last.l) + n) % n;
      let ok = gap > 0 && gap <= 4;
      for (let k = 0; k < gap && ok; k++) if (b[(last.s + last.l + k) % n] !== 2) ok = false;
      if (ok) { last.l += gap + first.l; runsM.shift(); }
    }

    // Trim wildcard-only edges, then keep only plausible wedge widths.
    const stepDeg = 360 / n;
    const cand = [];
    for (const r0 of runsM) {
      let s = r0.s, l = r0.l;
      while (l > 0 && b[s % n] === 2) { s++; l--; }
      while (l > 0 && b[(s + l - 1) % n] === 2) l--;
      if (l < 2) continue;
      const width = l * stepDeg;
      if (width < 30 || width > 200) continue;                        // merged arc is ~165 deg
      const start = (s % n) * stepDeg;
      cand.push({ start, width, mid: (start + width / 2) % 360 });
    }
    if (!cand.length) return { ring, valid: false, greenN, runs: runs.length };

    // Pick the arc that CONTINUES the tracked one. Choosing the longest run latched onto a
    // second green region about 125 deg away whenever noise nudged the lengths, which is why
    // the midpoint jumped instead of rotating.
    const dt = geo._mt == null ? 0 : now() - geo._mt;
    const step = geo._om != null && dt > 0 && dt < 200 ? geo._om * dt / 1000 : 0;
    const tracked = geo._mid != null;
    let best = cand[0], bestD = 0;
    if (tracked) {
      bestD = 1e9;
      const want = geo._mid + step;
      for (const c of cand) {
        let d = c.mid - want;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = c; }
      }
      // Further than a quarter turn from where it should be: a different object, not a
      // rotation. Reject the frame instead of reporting a bogus angle.
      if (bestD > 90) return { ring, valid: false, greenN, jump: Math.round(bestD) };
    } else {
      for (const c of cand) if (c.width > best.width) best = c;
    }

    const start = best.start, width = best.width, mid = best.mid;

    // Spin rate: least-squares over the last ~200 ms of DISTINCT frames (unwrapped, no
    // deadband, no 600 deg/s clamp). The one-frame delta this replaces froze at slow spin,
    // held a stale fast value, and clipped the 746 deg/s dials this game actually uses.
    const tNow = now();
    if (!geo._hist) geo._hist = [];
    const hist = geo._hist;
    const lastPt = hist[hist.length - 1];
    if (!lastPt || tNow - lastPt.t >= 4 || Math.abs(wrap180(mid - lastPt.mid)) >= 0.2) {
      hist.push({ t: tNow, mid });
      while (hist.length > 12) hist.shift();
    }
    const fit = fitOmega(hist, { now: tNow, maxAgeMs: 200, limit: 1500, minSpanMs: 12 });
    const midOmega = fit ? fit.omega : null;      // d(mid)/dt, used to track the wedge
    const omega = deltaOmega(midOmega);           // d(delta)/dt, what planPress/newTriangle use
    geo._mid = mid; geo._mt = tNow; geo._om = midOmega; geo._fit = fit;

    // Signed distance from the wedge midpoint to the pin: 0 means aligned. Since delta = -mid,
    // its rate is -d(mid)/dt; that conversion is the one deltaOmega() exists for.
    const delta = wrap180(0 - mid);

    // Lead: where the midpoint will be when a dispatched event is processed.
    const lead = ((F.opts && F.opts.leadMs) || 0) / 1000;
    const pred = omega == null ? delta : wrap180(delta + omega * lead);

    return {
      ring, valid: true, start, width, mid, delta, pred, omega, t: tNow, fit,
      tracked, runs: runs.length, greenN, R: geo.R,
    };
  };

  /* ------------------------------------------------------- pressing ----- */
  /* Dial/press state transitions and stepFrame live in src/loop.js (AutoFishLoop). */
  function cancelPend() {
    loopCancelPend(F, loopIo);
  }

  /**
   * The game can accept a winning attempt and then never deliver its `$fishing-result`: win()
   * disables input with the `waiting-for-result` reason and only onFishingResult clears it. No
   * amount of casting can recover that client-side lock, and the seat-hold probe would otherwise
   * keep pressing Space forever. Latch the missing result instead; only a fresh Start (after the
   * tab is reloaded) or a late card/prompt clears it. The game itself is never touched.
   */

  function clearPendingWin() {
    F.pendingWin = null;
  }

  /**
   * A card-shaped panel arrived. That is a SIGHTING, not a catch: the panel that followed every
   * press turned out to be reel UI, so scoring off this function is what made 21 "wins" out of
   * 2 fish. Count it apart and let the parsed catch text decide.
   */
  function markShapeHit(t) {
    F.stats.shapeHits = (F.stats.shapeHits || 0) + 1;
    const rec = F.pendingWin;
    if (!rec) return;
    if (rec.cardMs == null && rec.closedAt != null) rec.cardMs = Math.round(t - rec.closedAt);
    rec.shapeSeen = true;
  }

  /* ----------------------------------------------------------- input ----- */
  function tap(x, y) {
    // Detectors work in canvas pixels; elementFromPoint and PointerEvent want CSS pixels.
    const p = cssPoint(x, y, uiFrame());
    let el = document.elementFromPoint(p.x, p.y) || gameCanvas;
    // The panel sits above the game; if it covers the press point, aim at the canvas instead.
    if (el && el.closest && el.closest('#autofish-panel')) el = gameCanvas;
    if (!el) return false;
    const b = {
      bubbles: true, cancelable: true, composed: true,
      clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1,
    };
    el.dispatchEvent(new PointerEvent('pointerover', Object.assign({}, b, { buttons: 0 })));
    el.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, b, { buttons: 0 })));
    el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, b, { buttons: 1, pressure: 0.5 })));
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, b, { buttons: 0, pressure: 0 })));
    return true;
  }

  function space(where) {
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    const tgt = where === 'canvas' ? (app ? app.renderer.canvas : gameCanvas)
      : where === 'document' ? document
      : where === 'body' ? document.body
      : window;
    const init = {
      key: ' ', code: 'Space', keyCode: 32, which: 32, charCode: 32,
      bubbles: true, cancelable: true, composed: true,
    };
    const kd = new KeyboardEvent('keydown', init);
    tgt.dispatchEvent(kd);
    tgt.dispatchEvent(new KeyboardEvent('keyup', init));
    return !kd.defaultPrevented;
  }

  /**
   * D2 (TASK-2026-11-28-missions-claim-d2): press one DOM element — the only new input path.
   * Same PointerEvent trust as tap() above, aimed at an element (the Quests claim control)
   * instead of canvas pixels. It decides nothing: whether to press is autoClaimPass()'s job,
   * and a hidden tab is refused here too, same rule as the rest of the bot.
   */
  F.pressElement = function (el) {
    if (!el || !el.dispatchEvent) return false;
    if (document.visibilityState !== 'visible') return false;
    /** @type {DOMRect | null} */
    let r = null;
    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
    const x = r ? r.left + r.width / 2 : 0;
    const y = r ? r.top + r.height / 2 : 0;
    const b = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1,
    };
    el.dispatchEvent(new PointerEvent('pointerover', Object.assign({}, b, { buttons: 0 })));
    el.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, b, { buttons: 0 })));
    el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, b, { buttons: 1, pressure: 0.5 })));
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, b, { buttons: 0, pressure: 0 })));
    return true;
  };

  /* No movement keys are synthesised anywhere: a walk stands the character up out of the fishing
   * seat, and the seat is the only thing that produces a cast prompt (see castRecovery above). */

  /* ------------------------------------------------------------ loop ----- */
  F.start = function (opts) {
    F.opts = Object.assign({
      press: true,
      pressWith: 'pointer',         // 'pointer' | 'space' - the pointer path is the proven one
      spaceTarget: 'window',
      trigger: 'contain',           // 'contain' = pin anywhere inside the arc | 'angle' = midpoint only
      midDeg: 6,                    // 'angle' window: press when the midpoint is this close to the pin
      marginDeg: 4,                 // 'contain' stays this far inside the drawn arc
      leadMs: 25,                   // dispatch -> game judgement latency
      biasMs: 0,                    // fixed extra delay; an active sweep overrides it per press
      schedHorizonMs: 40,           // furthest ahead a press is put on a timer (2-3 frames)
      replanMs: 8,                  // re-aim the timer only when the plan moved this much
      pressGapMs: 120,
      fastFirstPress: false,        // opt-in: tap the first pass on a hard dial instead of waiting for a stable fit
      firstPressMinN: 6,            // first press on a hard dial: enough fit points to trust it
      firstPressMinSpanMs: 150,     // ... spanning this long, with a residual under firstPressMaxRms
      firstPressMaxRms: 2,
      firstPressMaxWidthDeg: 60,    // a "hard dial" is narrower than this (deg of drawn arc)...
      firstPressFastOmega: 300,     // ...or spinning at least this fast (deg/s)
      firstPressMaxWaitMs: 2500,    // never hold a first press longer than this, even if the fit is noisy
      firstPressMaxTransitFrac: 0.4, // ...and never past this fraction of one pass (width / omega)
      firstPressAssumeOmega: 300,    // no fit at all on a narrow dial: assume at least this fast
      insideNowMs: 60,              // contain: pin past centre and still inside -> press now rather than wait a turn
      relockGraceMs: 450,           // hold a dial's geometry this long after a press (the ring blinks)
      maxPressPerDial: 30,          // safety cap on presses per dial lock (high-tier fish can take >12)
      maxRejectedPerDial: 5,        // stop re-arming if consecutive presses are rejected
      hitMs: 1500,                  // a press the game acts on ends the dial within this
      stallDialMs: 0,               // opt-in: name a narrow ring held this long 'stalled' instead of miss/ghost
      skipMs: 300,                  // an unpressed dial that lived this long lost a fish (fades are ~100 ms)
      attemptIdleMs: 25000,         // an attempt with no dial and no press this long is over
      resultMissingMs: 8000,        // a win-like attempt with no card or prompt this long -> the game is waiting for a result
      sweep: null,                  // e.g. { min: -60, max: 60, step: 15 } - one probe per press
      ab: null,                     // { arms: [{name:'contain',trigger:'contain'},{name:'angle',trigger:'angle',midDeg:6}] } - one arm per FISH
      bubbleDebounceMs: 900,
      castRungResetMs: 10000,       // the prompt was gone this long: the recovery ladder starts over
      castRetryMs: 5000,            // nothing has happened this long: cast with the game's own keybind
      seatWatchdogMs: 45000,        // no dial, no press, no prompt this long -> the character is not seated
      seatHoldRetryMs: 60000,       // a seat hold probes the keybind this often, so a stuck line can recover
      lossGraceMs: 2500,            // a cast prompt right after a press may still be a win landing
      dialCheckMs: 120,
      dialFallbackMs: 2500,         // no dial this long -> one whole-surface search (0 disables)
      dialFallbackThrottleMs: 900,  // first recovery pass this soon after a cast...
      dialFallbackMaxMs: 6000,      // ...then doubling per fruitless pass, up to this
      pressGraceMs: 250,            // a press with no new triangle this long was not acted on
      cardCheckMs: 100,
      scanTickMs: 66,               // the shared quarter-scale grab is refreshed at most this often (~15 Hz)
      maxMinutes: 240,
    }, opts || {});
    surfaces();
    watchSurfaces();
    F._hookTryAt = 0; F._rafN = 0; F._stepFrame = -1;
    F._postAt = now();
    installPostRender();     // detection has to run after the game's draw, not before it
    resetPerf();
    watchLongTasks();
    F.stats = {
      bubbles: 0, dials: 0, presses: 0, dialsClosed: 0,
      hits: 0, misses: 0, noPress: 0, stalled: 0,
      attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0, skipped: 0, ghosts: 0,
      frames: 0, errors: 0, cards: 0, catchSeq: 0,
      shapeHits: 0, castRetries: 0, stalls: 0, pressAccepted: 0, pressRejected: 0, textGaps: 0, resultMissing: 0,
      firstPressHeld: 0, firstPressForced: 0, firstPressHeldForced: 0, holdPassesMax: 0, locksDisarmed: 0,
    };
    F.arms = {}; F.dialArm = null; F.armCfg = null; F.attempt = null; F.attempts = [];
    F.bands = {}; F.widths = {}; F.rarities = {};
    F.pressLog = []; F.pressProbe = null; F.predLog = []; F.predProbe = null;
    // Opt-in only. A userscript has no local server, and a hardcoded localhost POST turns every
    // catch into a failed request. The panel passes a URL only when the user turned POST catches on.
    F.geo = null; F.ghostGeo = null; F.catches = []; F.logUrl = (opts && opts.logUrl) ? String(opts.logUrl) : null;
    clearResultMissing('start');
    F.resultMissingAt = 0; F.resultMissingAttempt = null;
    // A fresh start has no prompt to learn the widget from: prefer the circle the last run locked
    // (scaled if the canvas was a different size), else the middle of the play area. Never a
    // literal point measured at one viewport - dialAnywhere() is the backstop when this is wrong.
    if (!F.lastGeo) {
      const mem = dialGeoFit(loadDialMemory(), uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
      if (mem) { F.lastGeo = mem; L('dial remembered', { cx: mem.cx, cy: mem.cy, R: mem.R }); }
    }
    F.hint = F.lastGeo
      ? { x: F.lastGeo.cx, y: F.lastGeo.cy }
      : { x: Math.round(((uiCanvas && uiCanvas.width) || window.innerWidth) / 2),
          y: Math.round(((uiCanvas && uiCanvas.height) || window.innerHeight) * 0.42) };
    F.txtAt = now(); F.cardWait = null; F.trophyWaitAt = 0;       // only text drawn from here on counts
    F.armed = true; F.lastPress = 0; F.lastDialCheck = 0; F.bad = 0; F.dialRejected = 0;
    F.pressStamp = null; F.dialBlinks = 0; F.pressWait = null; F.dialAnyAt = 0;
    F.pend = null; F.outcomes = []; F.sweep = {}; F.bands = {}; F.dialLastPress = null;
    F.bubbleMiss = 0; F.stallRetry = 0; F.lastSpaceTry = 0; F.lastCastTry = 0; F.needsSeat = false;
    F.bubblePrev = null; F.lastBubbleCause = null; F.lastDialCause = null; F.lastAttemptLoss = null;
    F.dialAnyFail = 0; F.dialAnyAt = 0;                       // recovery backoff starts fresh each run
    F.castHold = false;
    F.geoTrace = []; F.geoReasons = {}; F.planReason = null;
    clearPendingWin();
    F.paused = false; F.lastBubble = null; F.lastBubbleAt = 0; F.lastCardRect = null;
    F._mask = null; F.maskStats.on = false;
    F.lastCard = 0; F.cardCheckAt = 0; F.cardScan = 0;
    F.pressesThisDial = 0;
    F.running = true; F.startedAt = now(); F.hiddenPauses = 0;
    F.lastTickAt = now(); F.stalled = false;
    L('start', { opts: F.opts, ui: !!uiCanvas, game: !!gameCanvas });
    if (!F._raf) F._raf = requestAnimationFrame(loop);
    if (F._stallTimer) clearInterval(F._stallTimer);
    F._stallTimer = setInterval(checkStall, 1000);
    return F.status();
  };

  F.stop = function () {
    F.running = false;
    unwatchSurfaces();
    F.castHold = false;      // a stopped core must not inherit a hold from the session that held it
    perf.stoppedAt = now();   // freeze the measurement window; a later perf() must not be diluted
    cancelPend();

    clearPendingWin();
    F.pressWait = null;
    if (F.attempt) { L('attempt abandoned', { n: F.attempt.n, presses: F.attempt.presses }); F.attempt = null; }
    if (F._raf) cancelAnimationFrame(F._raf);
    F._raf = null;
    if (F._stallTimer) { clearInterval(F._stallTimer); F._stallTimer = null; }
    F.stalled = false;
    clearResultMissing('stop');
    L('stop', { stats: F.stats });
    return F.status();
  };

  /** Hold the loop where it is without ending the session: no presses until resume(). */
  F.pause = function () {
    F.paused = true;
    cancelPend();
    clearPendingWin();
    F.pressWait = null;
    F.geo = null; F.bad = 0; F.pressesThisDial = 0;   // re-lock on resume rather than press a stale wedge
    L('pause');
    return F.status();
  };

  F.resume = function () {
    F.paused = false;
    F.lastPress = 0; F.lastDialCheck = 0; F.bad = 0;
    L('resume');
    return F.status();
  };

  /**
   * Throttle cast retries without stopping the loop. A seat pause deliberately keeps the core alive
   * to spot the returning prompt, and an unthrottled retry would put a line in the water, removing
   * the prompt the hold is waiting for (measured live 2026-11-02: 69 retries, line out, no way back
   * without a manual reel). The hold still probes the keybind once a minute (seatHoldRetryMs).
   */
  F.holdCasts = function (on) {
    F.castHold = !!on;
    F.castHoldAt = F.castHold ? now() : 0;   // the seat-hold probe waits a full interval from here
    // Clearing the hold must not fire a retry on the very next frame: give the passive prompt
    // detector its usual window first, so a Resume does not start with a blind Space press.
    if (!F.castHold) F.lastCastTry = now();
    L('cast hold', { on: F.castHold });
    return F.castHold;
  };

  /** Fresh counters without restarting: used when a panel session begins on a live loop. */
  F.resetStats = function () {
    resetPerf();
    F.stats = {
      bubbles: 0, dials: 0, presses: 0, dialsClosed: 0,
      hits: 0, misses: 0, noPress: 0, stalled: 0,
      attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0, skipped: 0, ghosts: 0,
      frames: 0, errors: 0, cards: 0, catchSeq: 0,
      shapeHits: 0, castRetries: 0, stalls: 0, pressAccepted: 0, pressRejected: 0, textGaps: 0, resultMissing: 0,
      firstPressHeld: 0, firstPressForced: 0, firstPressHeldForced: 0, holdPassesMax: 0, locksDisarmed: 0,
    };
    F.arms = {}; F.dialArm = null; F.armCfg = null; F.attempt = null; F.attempts = [];
    F.ghostGeo = null;
    F.bubbleMiss = 0; F.stallRetry = 0;
    F.bubblePrev = null;
    F.sweep = {};
    F.bands = {}; F.widths = {}; F.rarities = {};
    F.pressLog = []; F.pressProbe = null; F.predLog = []; F.predProbe = null;
    clearPendingWin();
    F.catches = [];
    clearResultMissing('stats reset');
    return F.status();
  };

  /** Where the game is drawing right now, so overlays can keep clear of it. Rects are CSS {x,y,w,h}. */
  F.zones = function () {
    const f = uiFrame();
    const kx = f && f.cw ? f.w / f.cw : 1, ky = f && f.ch ? f.h / f.ch : 1;
    const box = (x, y, w, h) => {
      const p = cssPoint(x, y, f);
      return { x: p.x, y: p.y, w: w * kx, h: h * ky };
    };
    const bubble = F.lastBubble
      ? box(F.lastBubble.cx - F.lastBubble.w / 2, F.lastBubble.cy - F.lastBubble.h / 2, F.lastBubble.w, F.lastBubble.h)
      : null;
    const dial = F.geo ? box(F.geo.cx - F.geo.R, F.geo.cy - F.geo.R, F.geo.R * 2, F.geo.R * 2) : null;
    const hintZone = (!bubble && !dial && F.hint) ? box(F.hint.x - 90, F.hint.y - 90, 180, 180) : null;
    const card = F.lastCardRect
      ? box(F.lastCardRect.x, F.lastCardRect.y, F.lastCardRect.w, F.lastCardRect.h)
      : null;
    return { bubble, dial, card, hintZone };
  };

  /**
   * Ask for one PNG of the UI layer on the next animation frame. The panel posts it to fishserve so
   * a run that never sees a prompt can be diagnosed from the pixels the bot actually looked at,
   * instead of from guesses about what went wrong.
   */
  F.captureUI = function () { F._shot = null; F._shotWanted = true; return true; };

  /**
   * One detection step, run immediately after the game's renderer has drawn. A WebGL buffer is
   * valid only until the next render clears it, which is why every read lives here and not in rAF.
   * The re-entry guard matters because step() taps the canvas, and a game that rendered from inside
   * a pointer handler would otherwise run the whole detector in the middle of itself. The frame
   * token keeps a renderer that draws twice in one frame from stepping twice on the same pixels.
   */
  function postRenderTick() {
    if (!F.running || F._inStep || F._stepFrame === F._rafN) return;
    F._stepFrame = F._rafN;
    F._postAt = now();
    F._inStep = true;
    try {
      takeShot();
      step();
    } catch (e) {
      F.stats.errors++;
      L('error', { e: String((e && e.message) || e) });
    } finally {
      F._inStep = false;
    }
  }

  /** The one place a pending diagnostic capture is consumed, on whichever surface is readable. */
  function takeShot() {
    if (!F._shotWanted || !uiCanvas) return;
    F._shotWanted = false;
    try { F._shot = uiCanvas.toDataURL('image/png'); } catch (e) { F._shot = 'ERR ' + ((e && e.message) || e); }
  }

  /** The prototype that owns render(), not a renderer instance: Pixi recreates instances on resize. */
  function renderProto() {
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    if (!app || !app.renderer) return null;
    let p = Object.getPrototypeOf(app.renderer);
    while (p && !Object.prototype.hasOwnProperty.call(p, 'render')) p = Object.getPrototypeOf(p);
    return p && typeof p.render === 'function' ? p : null;
  }

  /**
   * Read the prompt layer where it is actually drawn. Measured live 2026-11-02: the renderer canvas
   * held 965,753 painted pixels and the old UI canvas held none, yet sampling the renderer from rAF
   * still read blank (222/222 swaps) while a post-render sample read ink 256/256. Patching the
   * prototype's render() survives Pixi replacing the renderer instance (a resize does), and the
   * canvas check keeps an overlay renderer from feeding a hidden surface into the step.
   */
  function installPostRender() {
    const proto = renderProto();
    if (!proto) return false;
    const prev = proto.render && proto.render.__autofishHook;
    if (prev) {
      // A re-pasted core inherits the one wrapper. loop() returns as soon as _postRender is true,
      // so a wrapper still owned by the stopped copy would report a live hook and never step.
      prev.owner = F;
      F._postTick = F._postTick || postRenderTick;
      F._maskTick = maskTick;
      F._postRender = true;
      F._postAt = now();
      return true;
    }
    const orig = proto.render;
    const hook = { owner: F };
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      const owner = hook.owner;
      // 3.9.41: the focus mask is a clear of the prompt's own canvas, so it has to run for whichever
      // canvas this call drew - the prompt layer is not the app canvas. It is a no-op unless the
      // panel has armed a rect, and a plain property read otherwise.
      if (owner && this && this.canvas && typeof owner._maskTick === 'function') owner._maskTick(this.canvas);
      const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
      if (this && app && (this.canvas === app.renderer.canvas || this === app.renderer)) {
        if (owner && typeof owner._postTick === 'function') owner._postTick();
      }
      return out;
    };
    wrapped.__autofishPostRender = true;
    wrapped.__autofishHook = hook;
    try { proto.render = wrapped; } catch (e) { return false; }
    if (proto.render !== wrapped) return false;   // a frozen prototype must not look installed
    F._postTick = postRenderTick;
    F._maskTick = maskTick;
    F._postRender = true;
    F._postAt = now();
    L('post-render hook', { canvas: !!(uiCanvas && uiCanvas.width) });
    return true;
  }

  /* ------------------------------------------- focus prompt mask (3.9.41) ---- */
  /*
   * Clear the CAST!/REEL! bubble while a focus session holds the run.
   *
   * The prompt is painted into the game's canvas, so a page script cannot hide the sprite. It can
   * erase the pixels after the game has drawn them and before the browser composites, which is the
   * window this hook already owns. The erase is a scissor plus a colour clear on the canvas that
   * carries the prompt: nothing is drawn over the game, the bubble's pixels are simply removed and
   * the world layer underneath shows through.
   *
   * The scope is deliberately narrow. Only the surface the bot reads is ever cleared, and never
   * when that surface is the world canvas: in the merged layout one buffer holds the scenery and the
   * prompt together, so a clear there would leave a hole in the world instead of revealing it. In
   * that layout maskTarget() refuses and the prompt stays visible - the honest fallback, and the
   * reason this feature can be dropped without touching the pause.
   */
  F._mask = null;
  F.maskStats = { on: false, clears: 0, skips: 0, probes: 0, resolved: 0, rects: 0, dropped: 0, path: 'none', lastError: null };

  /**
   * The mask needs two things a paused core never sets up by itself: a resolved read surface and the
   * post-render hook. A page that has never fished has neither, so an arm would be refused and no
   * frame would ever reach maskTick (measured live 2026-11-17: 108 refusals, 0 probes after a reload
   * with the hold engaged at mount). Both calls are idempotent and cheap.
   */
  function ensureMaskLive() {
    if (!uiCanvas || !uiCanvas.isConnected || !uiCanvas.width) surfaces();
    if (!F._postRender) installPostRender();
  }

  /** The canvas the mask may clear, or null when clearing it would damage the world layer. */
  function maskTarget() {
    if (!uiCanvas || !uiCanvas.isConnected || !uiCanvas.width) return null;
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    const world = app && app.renderer && app.renderer.canvas;
    if (world && world === uiCanvas) return null;
    return uiCanvas;
  }

  /** Erase one rect (canvas pixels, top-down) from a WebGL canvas, leaving the GL state as it was. */
  function clearPromptRect(gl, canvas, r) {
    const bw = gl.drawingBufferWidth || canvas.width;
    const bh = gl.drawingBufferHeight || canvas.height;
    const sx = bw / (canvas.width || bw);
    const sy = bh / (canvas.height || bh);
    const w = Math.max(1, Math.round(r.w * sx));
    const h = Math.max(1, Math.round(r.h * sy));
    const x = Math.round(r.x * sx);
    const y = Math.round(bh - (r.y + r.h) * sy);   // GL's origin is bottom-left
    if (x < 0 || y < 0 || x + w > bw || y + h > bh) { F.maskStats.skips++; return false; }
    const hadScissor = gl.isEnabled(gl.SCISSOR_TEST);
    const box = hadScissor ? gl.getParameter(gl.SCISSOR_BOX) : null;
    const cc = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    try {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      F.maskStats.clears++;
      return true;
    } catch (e) {
      F.maskStats.lastError = String((e && e.message) || e);
      return false;
    } finally {
      // The game owns this context: it must not inherit our scissor or our clear colour.
      try {
        gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
        if (hadScissor && box) gl.scissor(box[0], box[1], box[2], box[3]); else gl.disable(gl.SCISSOR_TEST);
      } catch (e) { F.maskStats.lastError = String((e && e.message) || e); }
    }
  }

  /**
   * Called by the render wrapper for every canvas it draws. Only the prompt surface is cleared, and
   * only while rects are armed, so an idle game pays one comparison a draw.
   */
  function maskTick(canvas) {
    const m = F._mask;
    if (!m) return;
    if (canvas !== uiCanvas) return;
    if (m.resolve) {
      // The game repaints this layer every frame, so the probe always reads the prompt and the lure
      // button before this tick clears them. Re-reading - not resolving once - is what keeps the
      // clear on a bubble that changes size or on an element that has just appeared.
      const t = now();
      if (t - (m.probeAt || 0) >= 300) {
        m.probeAt = t;
        F.maskStats.probes++;
        const rects = uiRects();
        if (rects && rects.length) {
          m.rects = rects;
          m.empty = 0;
          F.maskStats.rects = rects.length;
          F.maskStats.resolved++;
        } else if (rects) {
          // Read fine, nothing on the layer: the prompt was dismissed or the view changed. Keep the
          // rects for one more probe - the layer is repainted every frame, so a single miss is a
          // timing artefact - then drop them. A stale rect left armed would erase whatever paints
          // there next, which is not a pixel of this feature.
          m.empty = (m.empty || 0) + 1;
          if (m.empty >= 2) {
            m.rects = null;
            F.maskStats.rects = 0;
            F.maskStats.dropped = (F.maskStats.dropped || 0) + 1;
          }
        }
      }
    }
    if (!m.rects || !m.rects.length) return;
    const gl = webglFor(canvas);
    if (!gl) { F.maskStats.skips++; F.maskStats.path = 'no-gl'; return; }
    F.maskStats.path = 'gl';
    for (let i = 0; i < m.rects.length; i++) clearPromptRect(gl, canvas, m.rects[i]);
  }

  /** Any pixel the game actually painted on the UI layer. One threshold for the blob finder and the
   * full-resolution refinement: two copies of 24 would drift apart and leave a component unreachable. */
  const INK_ALPHA = 24;
  const ANY_INK = (d, i) => d[i + 3] > INK_ALPHA;

  /**
   * Every element on the UI layer, at its own pixel bounds.
   *
   * The layer is sparse: it holds the prompt bubble and the lure button side by side, transparent
   * everywhere else. Hiding the whole layer's content is what the hold promises, and a rect from the
   * detector's text box does not do it - measured live 2026-11-17, the bubble was 531,225,114,60 and
   * the lure button 651,234,48,48, while the cleared rect was 528,223,120,54: 6 px short of the
   * bubble's bottom border, and the button untouched. The shared quarter-scale snapshot finds the
   * blobs; each is then measured at full resolution through readUI, so the clear ends exactly on the
   * sprite's own edge instead of a rounded quarter-scale box.
   */
  // Both scratch buffers grow once to the largest window and are reused on every probe: this runs
  // while the core is paused, on a page the owner is using, so a fresh buffer per pass is not free.
  /** @type {Uint8Array | null} */
  let rectSeen = null, rectStack = null;
  const near4 = new Int32Array(4);
  function uiRects() {
    if (!uiCanvas || !uiCanvas.width) return null;
    if (!snapshot()) return null;
    // null means the probe could not read the layer; [] means it read it and found nothing. The
    // caller acts on the difference: an unreadable layer keeps its rects, an empty one drops them.
    const found = blobs(ANY_INK, 6);
    if (!found.length) return [];
    const out = [];
    for (let i = 0; i < found.length; i++) {
      const b = found[i];
      const qx = b.x0 * SDOWN, qy = b.y0 * SDOWN;
      const qw = (b.x1 - b.x0 + 1) * SDOWN, qh = (b.y1 - b.y0 + 1) * SDOWN;
      const pad = SDOWN * 3;
      const wx = Math.max(0, qx - pad), wy = Math.max(0, qy - pad);
      const wr = readUI(wx, wy, Math.min(uiCanvas.width, qx + qw + pad) - wx, Math.min(uiCanvas.height, qy + qh + pad) - wy);
      const fallback = { x: qx, y: qy, w: qw, h: qh };
      if (!wr) { out.push(fallback); continue; }
      // Only this blob's own component may set the bounds. The padded window overlaps the next
      // element (the prompt and the lure button sit 6 px apart), so a plain window bbox would bridge
      // the gap and stop being the sprite's bounds.
      const sx0 = Math.max(0, b.x0 * SDOWN - wr.x), sx1 = Math.min(wr.w - 1, (b.x1 + 1) * SDOWN - 1 - wr.x);
      const sy0 = Math.max(0, b.y0 * SDOWN - wr.y), sy1 = Math.min(wr.h - 1, (b.y1 + 1) * SDOWN - 1 - wr.y);
      let seed = -1;
      for (let y = sy0; y <= sy1 && seed < 0; y++) {
        for (let x = sx0; x <= sx1; x++) {
          if (wr.d[(y * wr.w + x) * 4 + 3] > INK_ALPHA) { seed = y * wr.w + x; break; }
        }
      }
      if (seed < 0) { out.push(fallback); continue; }
      const n = wr.w * wr.h;
      if (!rectSeen || !rectStack || rectSeen.length < n) {
        rectSeen = new Uint8Array(n);
        // @ts-expect-error tests/promptmask.test.js asserts 'let rectSeen = null, rectStack = null;' verbatim
        rectStack = new Int32Array(n);   // each pixel is pushed at most once, so n entries suffice
      }
      /** @type {Uint8Array} */
      const seen = rectSeen;
      seen.fill(0, 0, n);
      /** @type {Int32Array} */
      // @ts-expect-error rectStack initialized above alongside rectSeen (shared decl kept verbatim for promptmask.test.js)
      const stack = rectStack;
      let top = 0;
      stack[top++] = seed;
      seen[seed] = 1;
      let x0 = wr.w, y0 = wr.h, x1 = -1, y1 = -1;
      while (top > 0) {
        const q = stack[--top], px = q % wr.w, py = (q / wr.w) | 0;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        near4[0] = px > 0 ? q - 1 : -1;
        near4[1] = px < wr.w - 1 ? q + 1 : -1;
        near4[2] = py > 0 ? q - wr.w : -1;
        near4[3] = py < wr.h - 1 ? q + wr.w : -1;
        for (let k = 0; k < 4; k++) {
          const nb = near4[k];
          if (nb < 0 || seen[nb] || wr.d[nb * 4 + 3] <= INK_ALPHA) continue;
          seen[nb] = 1;
          stack[top++] = nb;
        }
      }
      out.push({ x: wr.x + x0, y: wr.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    return out;
  }

  /**
   * Arm or disarm the mask. Any truthy spec arms it; null disarms. The geometry always comes from
   * the frame (uiRects), never from a caller's box: a detector box is the text, not the sprite.
   * Returns whether the mask can act on this surface at all.
   */
  F.setPromptMask = function (spec) {
    if (!spec) {
      F._mask = null;
      F.maskStats.on = false;
      return false;
    }
    ensureMaskLive();
    if (!maskTarget()) {
      F._mask = null;
      F.maskStats.on = false;
      F.maskStats.skips++;
      return false;
    }
    // A re-arm (the panel arms once a second) keeps the last rects, so the clear never blinks off,
    // and keeps probeAt, so the throttle still spaces the probes instead of forcing one per arm.
    const keep = F._mask;
    F._mask = { resolve: true, rects: (keep && keep.rects) || null, probeAt: (keep && keep.probeAt) || 0 };
    F.maskStats.on = true;
    return true;
  };

  /** What the mask is doing, for the panel and for a live probe. */
  F.promptMask = function () {
    const rects = F._mask && F._mask.rects;
    return {
      on: !!(rects && rects.length),
      eligible: !!maskTarget(),
      rect: rects ? rects[0] : null,
      rects: rects || null,
      stats: F.maskStats,
    };
  };

  function loop() {
    if (!F.running) { F._raf = null; return; }
    F._raf = requestAnimationFrame(loop);
    F._rafN = (F._rafN || 0) + 1;
    const frameAt = now();
    if (perf.last) {
      perf.gaps.push(frameAt - perf.last);
      if (perf.gaps.length > 600) perf.gaps.shift();   // ~10 s at 60 fps
    }
    perf.last = frameAt; perf.n++;
    // With the render hook live, detection belongs after the game's draw: a sample here reads the
    // buffer the renderer has already cleared, which is the bug this replaced. rAF keeps only the
    // frame clock and re-tries the hook when the renderer was not reachable yet.
    if (!F._postRender && (!F._hookTryAt || frameAt - F._hookTryAt > 1000)) {
      F._hookTryAt = frameAt;
      installPostRender();
    }
    if (F._postRender) return;
    takeShot();
    try { step(); } catch (e) { F.stats.errors++; L('error', { e: String((e && e.message) || e) }); }
  }

  /**
   * A stolen animation frame is invisible from the inside. The browser can suspend rAF for an
   * occluded window while document.visibilityState still reads "visible"; the loop then simply
   * stops, the panel keeps saying RUNNING, and the session keeps charging its budget for nothing.
   * Measured live 2026-10-28: 10.7 minutes of silence while status() reported running: true.
   * One interval watches the tick clock and re-arms the frame - that is the whole repair.
   */
  const STALL_MS = 2000;
  function checkStall() {
    if (!F.running) return;
    // A hidden tab is not a stall: the game is frozen by design, and the panel's hidden-tab rule
    // already pauses the clock. Only a visible window owes frames.
    if (document.visibilityState !== 'visible') return;
    // A renderer the game replaced takes the hook with it; re-wrap a replaced one. A game that is
    // simply not drawing stays a stall - falling back to rAF would read the cleared buffer and
    // report a live scene as empty.
    if (F._postRender && now() - (F._postAt || 0) > 1000) installPostRender();
    const age = F.lastTickAt ? now() - F.lastTickAt : 0;
    if (age <= STALL_MS) {
      if (F.stalled) { F.stalled = false; L('loop resumed', { after: Math.round(age) }); }
      return;
    }
    if (!F.stalled) {
      F.stalled = true;
      F.stats.stalls = (F.stats.stalls || 0) + 1;
      L('loop stalled', { ms: Math.round(age) });
    }
    // The pending callback may never arrive, so drop it before asking again: otherwise a late
    // frame would start a second loop and every scan would run twice.
    if (F._raf) { try { cancelAnimationFrame(F._raf); } catch (e) {} }
    F._raf = requestAnimationFrame(loop);
  }

  /** @type {LoopIo} */
  const loopIo = {
    isVisible: () => document.visibilityState === 'visible',
    now,
    stop: () => F.stop(),
    findCatch: () => F.findCatch(),
    findBubble: () => F.findBubble(),
    sample: (geo) => F.sample(geo),
    lockDial: (hx, hy, span) => F.lockDial(hx, hy, span),
    dialAnywhere: () => dialAnywhere(),
    recordCatch: (card) => F.recordCatch(card),
    captureTextCursor: () => { F.txtAt = now(); },
    tap,
    space,
    clearPendingWin,
    startAttempt,
    resolveAttempt,
    sameDial,
    saveDialMemory,
    tryEscapeProfile,
    log: L,
    noteBubbleTap,
    bubbleConfirmed,
    clearResultMissing,
    markResultMissing,
    markShapeHit,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  function step() {
    stepFrame(F, now(), loopIo);
  }

  /* -------------------------------------------------------- attempts ----- */
  /**
   * One FISH, not one dial. The game grows a hidden level bar to 100 over several triangle
   * presses (see AUTOFISH.md: gain per press, 100 target), so a press that pays out no card
   * immediately is normal. The fish attempt is therefore the unit an A/B arm is chosen for and
   * the unit accuracy is scored on: it opens when a dial appears with none in progress and
   * closes at a parsed catch ("caught") or when the cast prompt / a long idle gap says the
   * minigame is over ("lost").
   */
  function startAttempt(t) {
    const arms = F.opts.ab && F.opts.ab.arms;
    const cfg = arms && arms.length ? arms[F.stats.attempts % arms.length] : null;
    const name = cfg ? (cfg.name || cfg.trigger || String(F.stats.attempts % arms.length)) : null;
    F.attempt = {
      n: F.stats.attempts + 1, startedAt: t, touched: t,
      presses: 0, dials: 0, skipped: 0, maxOmega: 0,
      pressAccepted: 0, pressRejected: 0, dialHits: 0, dialMisses: 0,
      widthSum: 0, widthN: 0, maxWidth: 0, minWidth: 0,
      arm: name, armCfg: cfg,
    };
    F.armCfg = cfg;
    F.dialArm = name;
    return F.attempt;
  }

  function resolveAttempt(verdict, t, why) {
    const a = F.attempt;
    if (!a) return null;
    F.attempt = null;
    a.verdict = verdict;
    a.why = why || null;
    a.ms = Math.round(t - a.startedAt);
    F.stats.attempts++;
    const key = verdict === 'caught' ? 'caught' : 'lost';
    F.stats[key]++;
    // wins/losses stay in the stats object because the HUD and older logs read them.
    F.stats.wins = F.stats.caught; F.stats.losses = F.stats.lost;
    a.avgWidth = a.widthN ? +(a.widthSum / a.widthN).toFixed(1) : null;
    a.widthBand = widthBand(a.avgWidth);
    a.pressAccepted = a.pressAccepted || 0;
    a.pressRejected = a.pressRejected || 0;
    a.dialHits = a.dialHits || 0;
    a.dialMisses = a.dialMisses || 0;
    a.pressHitRate = a.pressAccepted + a.pressRejected
      ? +(a.pressAccepted / (a.pressAccepted + a.pressRejected)).toFixed(3) : null;
    a.dialHitRate = a.dialHits + a.dialMisses
      ? +(a.dialHits / (a.dialHits + a.dialMisses)).toFixed(3) : null;
    const band = omegaBand(a.maxOmega || null);
    const b = F.bands[band] || (F.bands[band] = { band, attempts: 0, caught: 0, lost: 0, presses: 0 });
    b.attempts++; b[key]++; b.presses += a.presses;
    const wb = F.widths[a.widthBand] || (F.widths[a.widthBand] = { band: a.widthBand, attempts: 0, caught: 0, lost: 0, presses: 0, accepted: 0, rejected: 0, dialHits: 0, dialMisses: 0 });
    wb.attempts++; wb[key]++; wb.presses += a.presses;
    wb.accepted += a.pressAccepted; wb.rejected += a.pressRejected;
    wb.dialHits += a.dialHits; wb.dialMisses += a.dialMisses;
    // Rarity is only known when the card parsed. That is still enough to ask "how hard are the
    // legendary/secret fish that DO land", which is the calibration question for the narrow bands.
    if (verdict === 'caught' && a.rarity) {
      const r = F.rarities[a.rarity] || (F.rarities[a.rarity] = { rarity: a.rarity, caught: 0, presses: 0, widthSum: 0, widthN: 0 });
      r.caught++;
      r.presses += a.presses;
      if (a.avgWidth != null) { r.widthSum += a.avgWidth; r.widthN += 1; }
    }
    if (a.arm) {
      const c = F.arms[a.arm] || (F.arms[a.arm] = { arm: a.arm, attempts: 0, caught: 0, lost: 0, presses: 0, dials: 0 });
      c.attempts++; c[key]++; c.presses += a.presses; c.dials += a.dials;
    }
    a.wallAt = Date.now();
    saveRunRow(a);
    F.attempts.push(a);
    while (F.attempts.length > 200) F.attempts.shift();
    L(verdict === 'caught' ? 'attempt caught' : 'attempt lost', {
      n: a.n, ms: a.ms, presses: a.presses, dials: a.dials, skipped: a.skipped,
      arm: a.arm, band, width: a.avgWidth, widthBand: a.widthBand, why: a.why,
      lossDiag: a.lossDiag || null,
      species: a.species || null, rarity: a.rarity || null,
    });
    // A lost fish must stay attributable after the 8-entry tail expires: the reason, the
    // attempt number, and the dial score persist on status until the next loss (or start).
    if (verdict === 'lost') F.lastAttemptLoss = { n: a.n, why: a.why, ms: a.ms, dials: a.dials, presses: a.presses, dialHits: a.dialHits, dialMisses: a.dialMisses, avgWidth: a.avgWidth, lossDiag: a.lossDiag || null, at: t };
    return a;
  }

  /* ------------------------------------------------------- reporting ----- */
  F.status = function () {
    const book = loadLedger();
    // Callable before the first start(): the panel and the chip both poll it while idle, and a
    // status() that throws blanks the whole HUD.
    const s = F.stats || {};
    const frame = uiFrame();
    const verdicts = pressVerdictReport(s.pressVerdicts);
    return {
      running: !!F.running,
      paused: !!F.paused,
      stalled: !!F.stalled,
      postRender: !!F._postRender,
      lastTickAgoMs: F.lastTickAt ? Math.round(now() - F.lastTickAt) : null,
      runAgeMs: F.running && F.startedAt ? Math.round(now() - F.startedAt) : null,
      catchCount: s.catchSeq || 0,
      hidden: !!F.hidden,
      geo: F.geo ? { cx: F.geo.cx, cy: F.geo.cy, R: F.geo.R, width: F.geo.width && Math.round(F.geo.width) } : null,
      hint: F.hint,
      pxScale: frame && frame.cw ? +(frame.w / frame.cw).toFixed(3) : null,
      needsSeat: !!F.needsSeat,
      resultMissing: !!F.resultMissing,
      resultMissingAt: F.resultMissingAt || null,
      resultMissingAttempt: F.resultMissingAttempt || null,
      // inlined (not a helper): status.test.js compiles F.status out of the core
      // with only F/now in scope, so a closure call would not resolve there.
      playerBlocked: !!(F.bubblePrev && F.bubblePrev.blockedUntil && now() < F.bubblePrev.blockedUntil),
      profileOpen: typeof F.profileOpen === 'function' ? !!F.profileOpen() : false,
      lastDialCause: F.lastDialCause || null,
      lastAttemptLoss: F.lastAttemptLoss || null,
      sinceBubbleMs: F.lastBubbleAt ? Math.round(now() - F.lastBubbleAt) : null,
      sinceDialMs: F.geoAt ? Math.round(now() - F.geoAt) : null,
      stats: F.stats || {},
      accuracy: {
        attempts: s.attempts || 0, caught: s.caught || 0, lost: s.lost || 0,
        presses: s.presses || 0, shapeHits: s.shapeHits || 0,
        pressAccepted: s.pressAccepted || 0, pressRejected: s.pressRejected || 0,
        firstPressHeld: s.firstPressHeld || 0, firstPressForced: s.firstPressForced || 0,
        firstPressHeldForced: s.firstPressHeldForced || 0,
        pressAcceptRate: s.pressAccepted + s.pressRejected
          ? +((s.pressAccepted || 0) / (s.pressAccepted + s.pressRejected)).toFixed(3) : null,
        pressVerdicts: verdicts,
        pressAcceptRateObserved: verdicts.observed.rate,
        openAttempt: F.attempt ? { n: F.attempt.n, presses: F.attempt.presses } : null,
        byWidth: F.widthReport(),
      },
      pressesThisDial: F.pressesThisDial,
      pendingMs: F.pend ? Math.round(F.pend.at - now()) : null,
      ledger: { total: book.total || 0, species: Object.keys(book.species || {}).length, shiny: book.shiny || 0 },
      logTail: F.events.slice(-8),
    };
  };

  /**
   * Why fishing is or is not happening, in one word plus one action: the state a support question
   * would otherwise need five console commands to reconstruct. Pure read - it takes no samples and
   * starts no timer, so a panel may poll it.
   */
  F.doctor = function () {
    const s = F.stats || {};
    const p = F.perf();
    const t = now();
    return doctor({
      running: !!F.running,
      paused: !!F.paused,
      hidden: !!F.hidden,
      stalled: !!F.stalled,
      lastTickAgoMs: F.lastTickAt ? Math.round(t - F.lastTickAt) : null,
      postRender: !!F._postRender,
      snapshot: p.snapshot,
      readback: p.readback,
      longtasks: p.longtasks,
      worstFrameMs: p.worst,
      needsSeat: !!F.needsSeat,
      resultMissing: !!F.resultMissing,
      profileOpen: typeof F.profileOpen === 'function' ? !!F.profileOpen() : false,
      playerBlocked: !!(F.bubblePrev && F.bubblePrev.blockedUntil && t < F.bubblePrev.blockedUntil),
      sincePromptMs: F.lastBubbleAt ? Math.round(t - F.lastBubbleAt) : null,
      sinceDialMs: F.geoAt ? Math.round(t - F.geoAt) : null,
      accepted: s.pressAccepted || 0,
      rejected: s.pressRejected || 0,
      acceptRate: (s.pressAccepted || 0) + (s.pressRejected || 0)
        ? (s.pressAccepted || 0) / ((s.pressAccepted || 0) + (s.pressRejected || 0))
        : null,
      dials: s.dials || 0,
      held: s.firstPressHeld || 0,
      forced: s.firstPressForced || 0,
      holdPassesMax: s.holdPassesMax || 0,
    });
  };

  /**
   * Press acceptance per probe offset. Acceptance means the game spawned a new triangle, so this is
   * the one number a timing sweep can score: "dial closed soon after" only ever grades the press
   * that finished the fish. A sweep is still a slow calibration pass, not a normal mode.
   */
  F.sweepReport = function () {
    return Object.keys(F.sweep)
      .map((k) => F.sweep[k])
      .sort((a, b) => a.biasMs - b.biasMs)
      .map((r) => ({
        biasMs: r.biasMs, presses: r.presses || 0,
        accepted: r.accepted || 0, rejected: r.rejected || 0,
        acceptRate: r.presses ? +((r.accepted || 0) / r.presses).toFixed(2) : null,
      }));
  };

  /** Fish attempts caught/lost per closing speed band - the number that says WHERE fish are lost. */
  F.bandReport = function () {
    const order = ['slow', 'mid', 'fast', 'blur'];
    return order.filter((k) => F.bands && F.bands[k]).map((k) => {
      const b = F.bands[k];
      return { band: b.band, attempts: b.attempts, caught: b.caught, lost: b.lost, presses: b.presses,
        catchRate: b.attempts ? +(b.caught / b.attempts).toFixed(3) : null };
    });
  };
  /**
   * Per-arm performance for an interleaved A/B, scored on FISH: attempts caught against attempts
   * lost. Presses are reported too, because a faster arm that lands more presses per fish is only
   * better if it also catches more fish.
   */
  F.armReport = function () {
    return Object.keys(F.arms || {}).map((k) => {
      const a = F.arms[k];
      return { arm: a.arm, attempts: a.attempts, caught: a.caught, lost: a.lost, presses: a.presses,
        dials: a.dials,
        catchRate: a.attempts ? +(a.caught / a.attempts).toFixed(3) : null,
        pressesPerCatch: a.caught ? +(a.presses / a.caught).toFixed(2) : null };
    });
  };

  /** Fish attempts caught/lost per dial-width band - the rare-dial signal speed bands hide. */
  F.widthReport = function () {
    const order = ['narrow', 'mid', 'wide', 'full', 'unknown'];
    return order.filter((k) => F.widths && F.widths[k]).map((k) => {
      const b = F.widths[k];
      const accepted = b.accepted || 0;
      const rejected = b.rejected || 0;
      const dialHits = b.dialHits || 0;
      const dialMisses = b.dialMisses || 0;
      return { band: b.band, attempts: b.attempts, caught: b.caught, lost: b.lost, presses: b.presses,
        accepted, rejected,
        pressHitRate: accepted + rejected ? +(accepted / (accepted + rejected)).toFixed(3) : null,
        dialHits, dialMisses,
        dialHitRate: dialHits + dialMisses ? +(dialHits / (dialHits + dialMisses)).toFixed(3) : null,
        pressesPerAttempt: b.attempts ? +(b.presses / b.attempts).toFixed(2) : null,
        catchRate: b.attempts ? +(b.caught / b.attempts).toFixed(3) : null };
    });
  };

  /**
   * Caught fish per rarity, with the average dial width and presses it took. Losses cannot be
   * assigned a rarity (no card parsed), so this is a "what landed" report, not a fake catch rate.
   */
  F.rarityReport = function () {
    const tierRank = (r) => {
      const i = TIER_ORDER.indexOf(r);
      return i < 0 ? TIER_ORDER.length : i;
    };
    return Object.keys(F.rarities || {}).map((k) => {
      const r = F.rarities[k];
      return { rarity: r.rarity, caught: r.caught, presses: r.presses,
        avgWidth: r.widthN ? +(r.widthSum / r.widthN).toFixed(1) : null,
        pressesPerCatch: r.caught ? +(r.presses / r.caught).toFixed(2) : null };
    }).sort((a, b) => tierRank(a.rarity) - tierRank(b.rarity) || (a.rarity < b.rarity ? -1 : 1));
  };

  /**
   * The calibration surface: the live timing knobs plus the reports that say where fish are lost.
   * Call with no argument to read it; F.tune({ marginDeg: 6 }) applies a knob to the live run.
   * This is deliberately console-only: the panel's one-button flow must not silently re-time itself.
   */
  F.calibration = function () {
    const opts = F.opts || {};
    const widths = F.widthReport();
    const narrow = widths.filter((w) => w.band === 'narrow' && w.attempts >= 5)[0] || null;
    return {
      opts: {
        trigger: opts.trigger, pressWith: opts.pressWith, leadMs: opts.leadMs,
        marginDeg: opts.marginDeg, midDeg: opts.midDeg, biasMs: opts.biasMs,
        firstPressMinN: opts.firstPressMinN, firstPressMinSpanMs: opts.firstPressMinSpanMs,
        fastFirstPress: !!opts.fastFirstPress,
        firstPressMaxRms: opts.firstPressMaxRms, firstPressMaxWaitMs: opts.firstPressMaxWaitMs,
        insideNowMs: opts.insideNowMs, stallDialMs: opts.stallDialMs,
        firstPressMaxWidthDeg: opts.firstPressMaxWidthDeg, firstPressFastOmega: opts.firstPressFastOmega,
      },
      press: {
        accepted: (F.stats && F.stats.pressAccepted) || 0,
        rejected: (F.stats && F.stats.pressRejected) || 0,
        rate: F.accuracy ? F.accuracy().pressAcceptRate : null,
      },
      byWidth: widths,
      byBand: F.bandReport(),
      byRarity: F.rarityReport(),
      note: narrow && narrow.catchRate != null && narrow.catchRate < 0.5
        ? 'narrow dials are losing more than half their fish; inspect marginDeg and leadMs before the general settings'
        : 'read byWidth/byBand after a session; a band needs five attempts before its rate means anything',
    };
  };

  /** Apply numeric timing knobs, maxMinutes, or logUrl to the live run. Returns the calibration report. */
  F.tune = function (patch) {
    if (!patch || typeof patch !== 'object') return F.calibration();
    if (!F.opts) F.opts = {};
    if (patch.fastFirstPress != null) F.opts.fastFirstPress = !!patch.fastFirstPress;
    if (patch.logUrl !== undefined) F.logUrl = patch.logUrl ? String(patch.logUrl) : null;
    ['leadMs', 'marginDeg', 'midDeg', 'biasMs', 'pressGapMs', 'schedHorizonMs', 'maxMinutes',
      'firstPressMinN', 'firstPressMinSpanMs', 'firstPressMaxRms', 'firstPressMaxWaitMs',
      'firstPressMaxWidthDeg', 'firstPressFastOmega', 'insideNowMs', 'stallDialMs'].forEach((k) => {
      const n = Number(patch[k]);
      if (patch[k] != null && isFinite(n)) F.opts[k] = n;
    });
    return F.calibration();
  };

  /**
   * The honesty layer. A "win" here means a parsed catch card, nothing else: shape hits are
   * counted separately because they were once mistaken for wins and produced a 100% hit rate
   * against 2 real fish.
   */
  F.accuracy = function () {
    const s = F.stats || {};
    const presses = s.presses || 0;
    // Whole-session totals. The attempts ring is capped at 200, so deriving the headline from it
    // made accuracy() disagree with status() after 200 fish and divided session presses by a
    // ring-sized catch count. The ring now only feeds `recent`; the band reports use session maps.
    const attempts = s.attempts || 0;
    const caught = s.caught || 0;
    const lost = s.lost || 0;
    const verdicts = pressVerdictReport(s.pressVerdicts);
    return {
      attempts, caught, lost,
      catchRate: caught + lost ? +(caught / (caught + lost)).toFixed(3) : null,
      presses, pressesPerCatch: caught ? +(presses / caught).toFixed(2) : null,
      pressAccepted: s.pressAccepted || 0, pressRejected: s.pressRejected || 0,
      firstPressHeld: s.firstPressHeld || 0, firstPressForced: s.firstPressForced || 0,
      firstPressHeldForced: s.firstPressHeldForced || 0,
      pressAcceptRate: s.pressAccepted + s.pressRejected
        ? +((s.pressAccepted || 0) / (s.pressAccepted + s.pressRejected)).toFixed(3) : null,
      // The honest denominator: only verdicts where the spawn was actually seen.
      pressVerdicts: verdicts,
      pressAcceptRateObserved: verdicts.observed.rate,
      openAttempt: F.attempt ? { n: F.attempt.n, presses: F.attempt.presses, dials: F.attempt.dials, ms: Math.round(now() - F.attempt.startedAt) } : null,
      shapeHits: s.shapeHits || 0,
      // The last ten fish, each with its own denominator: presses the game answered with a new
      // triangle (accepted = inside the wedge), presses it did not, and dials that ended on a hit
      // or timed out instead. A narrow band with no accepted presses is the complaint, in numbers.
      recent: (F.attempts || []).slice(-10).map((a) => ({
        n: a.n, verdict: a.verdict, why: a.why || null,
        width: a.avgWidth, band: a.widthBand,
        presses: a.presses, accepted: a.pressAccepted || 0, rejected: a.pressRejected || 0,
        pressHitRate: a.pressHitRate == null ? null : a.pressHitRate,
        dials: a.dials, dialHits: a.dialHits || 0, dialMisses: a.dialMisses || 0,
        species: a.species || null, rarity: a.rarity || null,
      })),
      byBand: F.bandReport(), byArm: F.armReport(),
      byWidth: F.widthReport(), byRarity: F.rarityReport(),
      oracle: 'parsed catch text closes a fish attempt; a press alone is never a win or a loss',
    };
  };

  /**
   * The catch ledger, as the panel and the console read it. This is history, not a scoreboard: it
   * only ever contains catches whose card text parsed. It survives a reload because it lives in
   * localStorage, and it needs no server.
   */
  /** @type {string} */
  let logSummaryKey = '';
  /** @type {any} */
  let logSummaryVal = null;
  F.log = function () {
    const t = Date.now();
    const key = ledgerStore.getEpoch() + ':' + logDay(t);
    if (logSummaryVal && logSummaryKey === key) return logSummaryVal;
    const book = loadLedger();
    const summary = logSummary(book, t);
    // The raw unknown map is cumulative history; the worklist says what is still a gap today.
    summary.worklist = unknownWorklist(book);
    logSummaryKey = key;
    logSummaryVal = summary;
    return summary;
  };
  /** Which catch history the panel reads and writes. No argument reads it. */
  F.logProfile = function (name) {
    if (name === undefined) return logProfile;
    const next = String(name || '').trim().replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 24) || 'default';
    if (next !== logProfile) {
      logProfile = next;
      ledgerStore.setProfile(next);
      F.txtAt = now();            // text drawn before the switch is another card
    }
    return logProfile;
  };
  /** Every profile this browser has a ledger for. */
  F.logProfiles = function () { return logProfiles(); };
  /** The same ledger as one CSV row per species (paste it anywhere). */
  F.logCsv = function () {
    return logCsv(loadLedger());
  };
  /** Wipe the local catch history. fishserve's own CSVs are untouched. */
  F.logReset = function () {
    saveLedger(emptyLog());
    return true;
  };

  /* ---- the run store ---------------------------------------------------
   * Attempts used to live only in the in-memory ring, so one reload or one lost seat destroyed a
   * long session's sample. They now persist per profile - the same convention as the ledger and the
   * budget - and exportRun() merges the store with the live ring.
   */
  const RUN_KEY = 'autofish:run:v1';
  const RUN_PREFIX = RUN_KEY + ':';
  const RUN_CAP = 250;

  function runStoreKey() { return RUN_PREFIX + logProfile; }

  /** The compact row both the store and the export use; one shape, one place. */
  function runRowOf(a) {
    const wall = a.wallAt != null ? a.wallAt : null;
    return {
      // The counter restarts with the page while the store does not, so n alone repeats after a
      // reload (measured live: n=1 three times in one run). The id pairs the wall clock with n and
      // is what the merge dedupes on.
      id: wall != null ? wall + '-' + (a.n || 0) : 'x-' + (a.n || 0),
      n: a.n, v: a.verdict || null, why: a.why || null, lossDiag: a.lossDiag || null, ms: a.ms || 0,
      p: a.presses || 0, pa: a.pressAccepted || 0, pr: a.pressRejected || 0,
      d: a.dials || 0, w: (a.avgWidth != null && isFinite(a.avgWidth)) ? +a.avgWidth.toFixed(1) : null,
      wb: a.widthBand || null, b: a.band || null,
      dl: Array.isArray(a.dialLog) && a.dialLog.length ? a.dialLog : null,
      sp: a.species || null, r: a.rarity || null,
      // Wall clock, captured once at resolve. performance.now() is a page-relative clock, so the
      // first export dated the run to 1970 - and a per-call Date.now() here would give the stored
      // row and its in-memory twin different keys and double-count the attempt.
      t: a.wallAt != null ? a.wallAt : (a.startedAt != null ? Math.round(a.startedAt) : null),
    };
  }

  function loadRunRows() {
    try {
      const raw = localStorage.getItem(runStoreKey());
      if (!raw) return [];
      const rows = JSON.parse(raw);
      return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
  }

  /**
   * Persist one resolved attempt. Never throws: the page is mid-render inside the game's own frame,
   * and a storage failure must not take the fishing loop down with it.
   */
  function saveRunRow(a) {
    try {
      const rows = loadRunRows();
      rows.push(runRowOf(a));
      while (rows.length > RUN_CAP) rows.shift();
      localStorage.setItem(runStoreKey(), JSON.stringify(rows));
      F.runStoreError = null;
    } catch (e) {
      F.runStoreError = String((e && e.message) || e);
    }
  }

  /**
   * One blob for a finished run: every attempt, the interval around the rate, the environment it ran
   * in, and what the bot thought of itself at the end. Rendering it in a shell means the numbers in
   * README/STATE are recomputed from attempts instead of transcribed by hand.
   *
   *   copy(__fish.exportRun())      // JSON, paste it into the notebook review
   *   __fish.exportRun({ reset: true })   // export, then clear the stored run
   */
  F.exportRun = function (opts) {
    const o = opts || {};
    const rows = loadRunRows().concat((F.attempts || []).map(runRowOf));
    const seen = {}, merged = [];
    for (const r of rows) {
      if (!r || r.n == null) continue;
      const key = r.id || (r.n + ':' + (r.t || 0));
      if (seen[key]) continue;
      seen[key] = 1;
      merged.push(r);
    }
    // Rows from different pages have unrelated clocks: sort the timed ones by wall clock and keep
    // the rest in resolution order rather than pretending one clock covers both.
    const timed = merged.filter((r) => r.t != null && r.t > 1e12).map((r) => r.t).sort((a, b) => a - b);
    merged.sort((a, b) => {
      const at = a.t != null && a.t > 1e12, bt = b.t != null && b.t > 1e12;
      if (at && bt) return a.t - b.t || (a.n || 0) - (b.n || 0);
      if (at !== bt) return at ? 1 : -1;
      return (a.n || 0) - (b.n || 0);
    });
    const asAttempts = merged.map((r) => ({
      verdict: r.v, band: r.b, widthBand: r.wb, presses: r.p,
      pressAccepted: r.pa, pressRejected: r.pr, dials: r.d,
      avgWidth: r.w, ms: r.ms, species: r.sp, rarity: r.r, why: r.why, startAt: r.t, dialLog: r.dl,
    }));
    const p = F.perf();
    // The panel owns guard/blind state. A missing hook (an older panel) or a throwing one must
    // not make exportRun fail: the export is the night's only record.
    /** @type {any} */
    let panelState = null;
    try {
      panelState = typeof F.exportDiag === 'function' ? F.exportDiag() : null;
    } catch (e) {
      panelState = { error: String((e && e.message) || e) };
    }
    const out = {
      version: F.version,
      exportedAt: new Date().toISOString(),
      profile: logProfile,
      stored: loadRunRows().length,
      storeError: F.runStoreError || null,
      // A run that started before 3.9.15 carries page-clock timestamps for part of its rows; a
      // fabricated 1970 date is worse than an honest null.
      startedAt: timed.length ? new Date(timed[0]).toISOString() : null,
      endedAt: timed.length ? new Date(timed[timed.length - 1]).toISOString() : null,
      untimedRows: merged.length - timed.length,
      // Read-only mission snapshot (D1): what the Quests DOM shows, or null when it shows
      // nothing. Same contract as panelState above - a missing or throwing panel hook must
      // never fail the export, which is the night's only record.
      missions: (function () {
        try { return typeof F.exportMissions === 'function' ? F.exportMissions() : null; }
        catch (e) { return { error: String((e && e.message) || e) }; }
      })(),
      // D2 claim-handling state (additive, same contract as missions above): what the guarded
      // claim pass did last, or null when the panel has none.
      claims: (function () {
        try { return typeof F.exportClaimState === 'function' ? F.exportClaimState() : null; }
        catch (e) { return { error: String((e && e.message) || e) }; }
      })(),
      presses: pressAcceptSummary(F.pressLog),
      prediction: predictionSummary(F.predLog),
      pressLog: (F.pressLog || []).slice(-60),
      run: runSummary(asAttempts, {
        cut: F.cutReason || null,
        locksDisarmed: (F.stats && F.stats.locksDisarmed) || 0,
        firstPressHeld: (F.stats && F.stats.firstPressHeld) || 0,
        firstPressForced: (F.stats && F.stats.firstPressForced) || 0,
        firstPressHeldForced: (F.stats && F.stats.firstPressHeldForced) || 0,
      }),
      perf: {
        fps: p.fps, p50: p.p50, p95: p.p95, worst: p.worst,
        longtasks: p.longtasks, snapshot: p.snapshot, readback: p.readback, rates: p.rates,
      },
      doctor: F.doctor ? F.doctor() : null,
      guard: panelState && panelState.guard ? panelState.guard : null,
      blind: panelState && panelState.blind ? panelState.blind : null,
      diagError: panelState && panelState.error ? panelState.error : null,
      opts: F.opts,
      attempts: merged,
    };
    if (o.reset) {
      try { localStorage.removeItem(runStoreKey()); } catch (e) {}
      F.attempts = [];
    }
    return JSON.stringify(out);
  };

  F.report = function () {
    return {
      version: F.version, accuracy: F.accuracy(), stats: F.stats, opts: F.opts,
      sweep: F.sweepReport(), bands: F.bandReport(), widths: F.widthReport(),
      rarities: F.rarityReport(), calibration: F.calibration(), outcomes: F.outcomes.slice(-60),
      attempts: (F.attempts || []).slice(-40),
      log: F.events.slice(-250),
      catchLog: F.log(),
    };
  };

  /** The timing maths, exposed so a live console can re-plan against a captured dial. */
  F.timing = { wrap180, fitOmega, planPress, sweepBias, omegaBand, widthBand, cardShapeOk, newTriangle, pressOutcome, castRecovery, cssPoint };

  /** The embedded species table, for a console that wants to check a rarity by hand. */
  F.catalogue = { count: SPECIES.length, tiers: TIER_ORDER.slice(), info: speciesInfo, describe: describeCatch };

  /** One-shot probes, safe to call from a normal task. */
  F.probeBubble = () => new Promise((res) => requestAnimationFrame(() => res(F.findBubble())));
  
  F.probeDial = (x, y) => new Promise((res) => requestAnimationFrame(() => res(F.lockDial(x, y))));
  F.probeDialAnywhere = () => new Promise((res) => requestAnimationFrame(() => res(dialAnywhere())));
  F.spaceTest = (where) => ({ consumed: !space(where || 'window') });

  /**
   * Colour calibration. Run this with a dial on screen: it reports the distinct RGB values
   * around the ring at several radii and how many degrees each occupies.
   *
   * The open question this exists to answer: the wedge colours seen in a screenshot
   * (base 142,138,111 / wedge 182,188,132) are NOT necessarily what the UI layer emits, and
   * a pin-colour test built on guessed thresholds produced zero detections in testing.
   * Run this first, then tighten GRN in this file to the values it prints.
   */
  F.calibrate = function () {
    return new Promise((res) => requestAnimationFrame(() => {
      const g = F.lockDial(F.hint.x, F.hint.y);
      if (!g) return res({ error: 'no dial on screen' });
      const pad = 14, half = Math.round(g.R + pad);
      const r = readUI(g.cx - half, g.cy - half, half * 2, half * 2);
      if (!r) return res({ error: 'read failed', g });
      const out = { geo: g, radii: {} };
      for (const f of [0.4, 0.5, 0.62, 0.74, 0.86]) {
        const rr = Math.round(g.R * f);
        const hist = {};
        for (let k = 0; k < 72; k++) {
          const a = k * 2 * Math.PI / 72;
          const c = PX(r, Math.round(g.cx + rr * Math.sin(a)), Math.round(g.cy - rr * Math.cos(a)));
          if (c[3] <= 60) continue;
          const key = c[0] + ',' + c[1] + ',' + c[2];
          hist[key] = (hist[key] || 0) + 1;
        }
        out.radii['r=' + f] = Object.entries(hist)
          .sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([k, n]) => ({ rgb: k, degrees: n * 5 }));
      }
      res(out);
    }));
  };

  /* Wrap the finished detectors last, so their numbers include everything they do. Two
   * performance.now() calls per call is noise against a readback measured at ~2.1 ms. */
  const PERF_KEYS = { findBubble: 'bubble', findCatch: 'card', lockDial: 'lock', sample: 'sample' };
  Object.keys(PERF_KEYS).forEach((name) => {
    const orig = F[name];
    if (typeof orig !== 'function') return;
    const key = PERF_KEYS[name];
    F[name] = function () {
      const t0 = now();
      try { return orig.apply(this, arguments); }
      finally { perf[key] += now() - t0; perf[key + 'N']++; }
    };
  });

  /** Long-task totals plus the ones inside the last ten seconds. */
  function longTaskReport() {
    const t = now();
    let n = 0, max = 0;
    for (const e of perf.ltRing) {
      if (t - e.t <= 10000) { n++; if (e.ms > max) max = e.ms; }
    }
    return { total: perf.ltN, maxMs: Math.round(perf.ltMax), inLast10s: n, max10sMs: Math.round(max) };
  }

  /** lockDial's five phases as ms, ms per call and share of the call. */
  function lockPhases() {
    const total = perf.lock || 0, n = perf.lockN || 0;
    const one = (ms, extra) => Object.assign({
      ms: +ms.toFixed(1),
      msPerCall: n ? +(ms / n).toFixed(2) : null,
      pct: total ? +(100 * ms / total).toFixed(1) : null,
    }, extra || {});
    return {
      memoTries: n,
      memo: one(perf.lockMemo, { hits: perf.lockMemoN, skipped: perf.lockMemoSkipped, cold: perf.lockMemoCold }),
      grab: one(perf.lockGrab),
      mask: one(perf.lockMask),
      scan: one(perf.lockScan),
      refine: one(perf.lockRefine),
    };
  }

  /**
   * Frame budget and per-detector cost, from the last ~10 s of frames.
   *
   * Measure with the bot stopped, then running, and compare: the difference is what the bot costs.
   * On Chromium the readback is cheap; on Gecko (Zen) the same numbers are often several times
   * larger, which is a browser fact, not a bug in the detector.
   */
  F.perf = function () {
    const gaps = perf.gaps.slice().sort((a, b) => a - b);
    const q = (p) => gaps.length ? +gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))].toFixed(1) : null;
    const sum = gaps.reduce((s, v) => s + v, 0);
    // Measuring after a stop is normal (stop, then read the report): freeze at the stop.
    const end = (F.running || !perf.stoppedAt) ? now() : perf.stoppedAt;
    const uptime = perf.startedAt ? end - perf.startedAt : 0;
    const calls = { snapshot: perf.snapN, findBubble: perf.bubbleN, lockDial: perf.lockN, sample: perf.sampleN, findCatch: perf.cardN };
    const totals = { snapshot: perf.snap, findBubble: perf.bubble, lockDial: perf.lock, sample: perf.sample, findCatch: perf.card };
    const rates = perfRates(calls, totals, uptime);
    for (const key of Object.keys(rates)) {
      const r = rates[key];
      r.callsPerSec = r.callsPerSec == null ? null : +r.callsPerSec.toFixed(1);
      r.msPerCall = r.msPerCall == null ? null : +r.msPerCall.toFixed(2);
      r.msPerSec = r.msPerSec == null ? null : +r.msPerSec.toFixed(1);
      r.share = r.share == null ? null : +r.share.toFixed(3);
    }
    return {
      frames: perf.n,
      uptimeMs: Math.round(uptime),
      fps: gaps.length ? +(1000 / (sum / gaps.length)).toFixed(1) : null,
      p50: q(0.5), p95: q(0.95),
      worst: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : null,
      // share is the fraction of wall time; findBubble includes its snapshot, so they overlap.
      rates,
      // Full-resolution reads served from the renderer. `gl` is the WebGL readPixels path and
      // allocates only when its buffer grows; `canvas2d` is the fallback and allocates every
      // call. `allocMB` also counts the shared quarter-scale snapshot, so it is the whole
      // canvas-readback garbage rate, not just this path.
      readback: {
        calls: perf.readN,
        gl: perf.readGL,
        canvas2d: perf.read2d,
        mb: +perf.readMB.toFixed(1),
        allocMB: +perf.allocMB.toFixed(2),
        allocMBPerSec: uptime ? +(perf.allocMB / (uptime / 1000)).toFixed(2) : null,
        bufferMB: glBuf ? +(glBuf.byteLength / 1048576).toFixed(2) : 0,
      },
      // Where lockDial's ms go. `pct` is that phase's share of lockDial's own total, so the parts
      // account for the call instead of being compared against guesses. `memo.hits` counts the
      // calls the remembered circle answered - a high hit rate is the fast path working.
      // Which path served the quarter-scale snapshot. 3.9.10 shipped a GL path that never engaged
      // and left no trace; a counter is the difference between noticing in a minute and never.
      snapshot: { gl: perf.snapGL, canvas2d: perf.snap2d },
      // Seen from outside the loop. A block the bot did not cause looks identical to one it did,
      // and only this counter separates them; inLast10s is what doctor() reads.
      longtasks: longTaskReport(),
      lockPhases: lockPhases(),
      // false means the page's CSP refused `new Function` and the in-script scan is in use.
      scanCompiled: !!scanCompiled,
      scanCompileError,
    };
  };

  surfaces();
  window.__fish = F;
  return { installed: F.version, ui: !!uiCanvas, game: !!gameCanvas };
})();
