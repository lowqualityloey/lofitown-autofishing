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
  if (window.__fish) { try { window.__fish.stop(); } catch (e) {} }

  /**
   * build-userscript.js replaces 'dev' with package.json's version, so the header, __fish.version
   * and the panel cannot disagree. Served unbundled (the bookmarklet path) it stays 'dev', which is
   * the honest answer: that copy has no build step to stamp it.
   */
  const F = { version: 'dev' };
  const now = () => performance.now();

  /* ---- performance probe -------------------------------------------------
   * Zen/Gecko pays far more for a canvas readback than Chromium does, and the only honest way to
   * tune that is to measure it on the machine that hurts. __fish.perf() reports frame gaps and the
   * average cost of each detector, so a change can be justified by numbers rather than a guess.
   */
  const perf = { gaps: [], n: 0, last: 0, startedAt: 0, stoppedAt: 0, snap: 0, snapN: 0, bubble: 0, bubbleN: 0, lock: 0, lockN: 0, sample: 0, sampleN: 0, card: 0, cardN: 0, readN: 0, readGL: 0, read2d: 0, readMB: 0, allocMB: 0, snapGL: 0, snap2d: 0, ltN: 0, ltMax: 0, ltRing: [] };
  /* lockDial is one timer around five different kinds of work - a remembered circle, a GPU readback,
   * a rim mask, a 4,950-circle scan and the 40-sample refinement - and the sum of the parts that had
   * been measured separately (readback 7-9 ms, mask 0.38 ms, coarse scan 0.75 ms) did not reach the
   * 35-44 ms a call the live probe reported. These five phases split the call itself so the missing
   * time names itself instead of being inferred. */
  perf.lockMemo = 0; perf.lockMemoN = 0; perf.lockMemoSkipped = 0; perf.lockMemoCold = 0; perf.lockGrab = 0; perf.lockMask = 0; perf.lockScan = 0; perf.lockRefine = 0;
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
  // <timing-core>
  /** Fold an angle into (-180, 180]. */
  function wrap180(a) {
    a = (a + 180) % 360;
    if (a < 0) a += 360;
    return a - 180;
  }

  /**
   * Least-squares spin rate over the last few DISTINCT frames.
   *
   * pts: [{ t: ms, mid: deg }] oldest -> newest. The mids are unwrapped in order so a wedge
   * crossing 0 deg does not read as a 360 deg jump. Frames older than maxAgeMs are dropped, a
   * single outlier is removed and the fit re-run. Returns null when the frames cannot define
   * a rate at all (fewer than minN survive, or they all share one timestamp).
   *
   * Why a fit: a one-frame delta behind a 0.5 deg deadband never updated at slow spin, kept a
   * stale fast value, and had to be clamped at 600 deg/s - exactly the speeds this game uses.
   */
  function fitOmega(pts, opts) {
    const o = opts || {};
    const maxAge = o.maxAgeMs != null ? o.maxAgeMs : 200;
    const minN = o.minN != null ? o.minN : 2;
    const minSpan = o.minSpanMs != null ? o.minSpanMs : 8;
    const limit = o.limit != null ? o.limit : 1500;
    if (!pts || pts.length < minN) return null;
    const last = pts[pts.length - 1];
    const nowMs = o.now != null ? o.now : last.t;
    const live = [];
    for (const p of pts) {
      if (p && isFinite(p.mid) && isFinite(p.t) && nowMs - p.t <= maxAge) live.push(p);
    }
    if (live.length < minN) return null;
    if (live[live.length - 1].t - live[0].t < minSpan) return null;

    const slope = (rows) => {
      let st = 0, sm = 0;
      for (const r of rows) { st += r.t; sm += r.m; }
      const mt = st / rows.length, mm = sm / rows.length;
      let num = 0, den = 0;
      for (const r of rows) { const d = r.t - mt; num += d * (r.m - mm); den += d * d; }
      return den > 0 ? (num / den) * 1000 : null;      // deg per ms -> deg per s
    };
    const unroll = (rows) => {
      const out = [{ t: rows[0].t, m: rows[0].mid }];
      for (let i = 1; i < rows.length; i++) {
        out.push({ t: rows[i].t, m: out[i - 1].m + wrap180(rows[i].mid - rows[i - 1].mid) });
      }
      return out;
    };
    const rmsOf = (rows, omega) => {
      const t0 = rows[0].t, m0 = rows[0].m;
      let s = 0;
      for (const r of rows) { const e = r.m - (m0 + omega / 1000 * (r.t - t0)); s += e * e; }
      return Math.sqrt(s / rows.length);
    };

    let rows = unroll(live);
    let omega = slope(rows);
    if (omega == null) return null;
    let dropped = 0, rms = rmsOf(rows, omega);
    if (rows.length >= 3) {
      const t0 = rows[0].t, m0 = rows[0].m;
      let worst = 1, worstE = 0;
      for (let i = 1; i < rows.length; i++) {
        const e = Math.abs(rows[i].m - (m0 + omega / 1000 * (rows[i].t - t0)));
        if (e > worstE) { worstE = e; worst = i; }
      }
      const kept = rows.slice(0, worst).concat(rows.slice(worst + 1));
      const w2 = slope(kept);
      if (w2 != null) {
        // Drop the point when it is an outlier against the rest AND removing it makes the fit
        // materially better. A real rotation cannot improve that much, a mis-tracked arc can.
        const rms2 = rmsOf(kept, w2);
        const r = kept.map((q) => q.m - (kept[0].m + w2 / 1000 * (q.t - kept[0].t)));
        const scale = Math.max(1, Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length));
        if (worstE > Math.max(5, 3 * scale) || rms2 < 0.6 * rms) {
          rows = kept; omega = w2; rms = rms2; dropped = 1;
        }
      }
    }
    const clamped = Math.abs(omega) > limit;
    if (clamped) omega = omega > 0 ? limit : -limit;
    return {
      omega, rms, dropped, clamped,
      n: rows.length,
      span: rows[rows.length - 1].t - rows[0].t,
    };
  }

  /**
   * Is a spin-rate estimate mature enough to trust for a FIRST press?
   *
   * The first press is the one with the least evidence: fitOmega accepts two frames 8 ms apart, so
   * an early fit can be a noisy angle track rather than a rotation. A wide slow dial forgives that;
   * a narrow (<60 deg) or fast (>=300 deg/s) dial does not - the same error is most of its window.
   * This gate waits for more points over a longer span with a tight residual before the first press.
   */
  function fitStable(fit, o) {
    const cfg = o || {};
    if (!fit || !isFinite(fit.omega)) return false;
    if (fit.clamped) return false;
    const minN = cfg.firstPressMinN != null ? cfg.firstPressMinN : 6;
    const minSpan = cfg.firstPressMinSpanMs != null ? cfg.firstPressMinSpanMs : 150;
    const maxRms = cfg.firstPressMaxRms != null ? cfg.firstPressMaxRms : 2;
    const rms = fit.rms == null ? Infinity : fit.rms;
    return (fit.n || 0) >= minN && (fit.span || 0) >= minSpan && rms <= maxRms;
  }

  /**
   * The tracker fits the midpoint's rate, d(mid)/dt. The planner's delta is (pin - mid), so the
   * rate it needs is the negation. Converting once here is what stops a live dial from being
   * scheduled a full turn late: on 2026-11-03 a 40 deg Legendary dial logged 69 consecutive
   * 'wait' frames and never pressed.
   */
  function deltaOmega(midOmega) {
    if (midOmega == null || !isFinite(midOmega)) return null;
    return midOmega === 0 ? 0 : -midOmega;
  }

  /**
   * How long the first press may wait for a mature spin fit, in ms.
   *
   * The fixed 2500 ms ceiling is several rotations on a fast dial: at 700 deg/s a 45 deg arc is
   * under the pin for 64 ms, so "wait up to 2.5 s" means the bot visibly skips three or four
   * passes of a fish the player is watching. Measured live 2026-11-02: firstPressHeld on 9 of 18
   * dials and firstPressForced twice, on a session that was otherwise 51/51 presses accepted.
   * The budget is therefore a fraction of ONE pass, still bounded by the old ceiling for the slow
   * dials where a long, accurate fit is worth having.
   */
  function firstPressBudget(width, omega, o) {
    const cfg = o || {};
    const capMs = cfg.firstPressMaxWaitMs != null ? cfg.firstPressMaxWaitMs : 2500;
    const frac = cfg.firstPressMaxTransitFrac != null ? cfg.firstPressMaxTransitFrac : 0.4;
    const w = Number(width);
    if (!(w > 0)) return capMs;
    const om = Math.abs(Number(omega));
    if (!(om > 0)) {
      // No rate at all. A wide dial never enters the first-press gate, so keep the old ceiling
      // there; a narrow dial must not stare at a spinning wedge for 2.5 s (live 2026-11-03: a
      // 35 deg Legendary dial held 2,619 ms with zero presses). Assume the fast-dial floor and
      // hold for only a fraction of one pass.
      if (w >= (cfg.firstPressMaxWidthDeg || 60)) return capMs;
      const assumed = cfg.firstPressAssumeOmega || 300;
      return Math.min(capMs, (w / assumed) * 1000 * frac);
    }
    return Math.min(capMs, (w / om) * 1000 * frac);
  }

  /**
   * How long to wait before the next whole-surface dial recovery pass, in ms.
   *
   * Measured live 2026-11-02 (3.9.10): one recovery pass is a ~257k-test annulus sweep costing
   * 250-300 ms, and it ran every 900 ms whenever nothing was locked - i.e. every second while the
   * character simply waited for a bite. Pausing the core made the stalls disappear entirely
   * (143.8 fps, 0 long tasks), which is how it was attributed. A wrong hint is a per-CAST problem,
   * not a per-second one: the cadence doubles after each fruitless pass and a cast resets it.
   */
  function dialFallbackWait(fail, o) {
    const cfg = o || {};
    const base = cfg.dialFallbackThrottleMs != null ? cfg.dialFallbackThrottleMs : 900;
    const cap = cfg.dialFallbackMaxMs != null ? cfg.dialFallbackMaxMs : 6000;
    const n = Math.max(0, Math.min(8, Number(fail) || 0));
    return Math.min(cap, base * Math.pow(2, n));
  }

  /**
   * Is this zero-press dial a fading ring rather than a fish?
   *
   * A real unpressed dial stays up for about 15.9 s. The narrow ghosts measured live 2026-11-03
   * lasted only ~2.7 s and shrank from 40 to 30 deg. The old test only caught a ring that barely
   * moved, but these drift ~35 deg while fading, so they were counted as skipped fish and
   * re-locked. A short, narrow, shrinking dial is a ghost; a long-lived one is not.
   */
  function dialGhost(st, o) {
    const s = st || {};
    const cfg = o || {};
    if ((Number(s.presses) || 0) > 0) return false;
    const travel = Math.abs(Number(s.travel) || 0);
    if (travel < (cfg.ghostTravelDeg != null ? cfg.ghostTravelDeg : 15)) return true;
    const held = Number(s.heldMs);
    const width = Number(s.width);
    const shrink = Number(s.widthShrink);
    const maxHeld = cfg.ghostMaxMs != null ? cfg.ghostMaxMs : 5000;
    const maxWidth = cfg.ghostMaxWidthDeg != null ? cfg.ghostMaxWidthDeg : 60;
    const minShrink = cfg.ghostMinShrinkDeg != null ? cfg.ghostMinShrinkDeg : 5;
    return held >= 0 && held < maxHeld && width > 0 && width < maxWidth && shrink >= minShrink;
  }

  /**
   * A narrow ring blinks: the rim sampler loses a thin wedge for a few frames while the pin
   * keeps turning underneath, and the bad-sample branch would call that a ghost and lose the
   * fish (live: two 40 deg dials, spin 50-140 deg/s, zero presses, both fish gone - the 85%).
   * A fade - the thing the ghost rule is for - sits still, so a FRESH non-zero spin estimate
   * tells them apart. The witness is already on the lock: the sampler freezes geo._om/_mt at
   * the last valid frame, so no new state is kept and staleness expires the hold on its own.
   * A solved dial never reaches here (it has presses). _om is the midpoint rate; the planner
   * uses its negation, and only the magnitude matters here.
   */
  function spinAlive(geo, t) {
    if (!geo || !(geo.width > 0 && geo.width < 60)) return false;   // narrow: the gate's own band
    const om = geo._om;
    if (om == null || !isFinite(om) || Math.abs(om) <= 20) return false;   // still or unmeasured
    return (t - (geo._mt || 0)) < 1000;   // blind frames are ms-scale; then the ghost rule decides
  }

  /**
   * Is a lock candidate the same fading circle we just ghosted? A short cooldown stops the memo
   * and the next scan from re-locking the same ring; a real triangle at the same circle widens the
   * arc (live: 30-40 deg ghost, 70 deg real dial), so a width jump is allowed through.
   */
  function ghostBlocked(g, width, at, ghost, o) {
    if (!g || !ghost || !(at < ghost.until)) return false;
    const cfg = o || {};
    const maxPx = cfg.ghostCirclePx != null ? cfg.ghostCirclePx : 10;
    const maxR = cfg.ghostRadiusPx != null ? cfg.ghostRadiusPx : 8;
    const maxDw = cfg.ghostWidthDeg != null ? cfg.ghostWidthDeg : 12;
    const dx = Math.abs(Number(g.cx) - Number(ghost.cx));
    const dy = Math.abs(Number(g.cy) - Number(ghost.cy));
    const dr = Math.abs(Number(g.R) - Number(ghost.R));
    const dw = Math.abs((Number(width) || 0) - (Number(ghost.width) || 0));
    return dx <= maxPx && dy <= maxPx && dr <= maxR && dw <= maxDw;
  }

  /**
   * Decide what this frame should do about the dial.
   *
   * st: { t, delta, width, omega, armed, pendingAt }
   *     delta  signed degrees from the wedge midpoint to the pin (0 = aligned)
   *     armed  no press has been sent for this rotation yet
   * o:  { trigger, midDeg, marginDeg, leadMs, biasMs, horizonMs, replanMs, minOmega }
   *
   * Returns { press, armAt, at, cancel, pred, win, reason }.
   *   press  send the press now (only ever <= leadMs before the crossing)
   *   armAt  absolute time to dispatch the press (null = no timer wanted)
   *   cancel drop an already-armed timer (false = keep it as it is)
   *   pred   where the pin will be when the game judges a press dispatched NOW
   *   win    the acceptance half-width in degrees
   *
   * The schedule aims at the CROSSING (pin on the midpoint) - that is the widest error tolerance
   * in both directions. Containment widens the window used to decide that a late press is still
   * inside the drawn arc, and takes an already-open window ('inside-now') once the pin is past the
   * midpoint instead of waiting almost a full rotation for the next crossing. Trigger 'angle'
   * keeps the pure midpoint rule.
   */
  function planPress(st, o) {
    const cfg = o || {};
    const lead = (cfg.leadMs || 0) / 1000;
    const bias = (cfg.biasMs || 0) / 1000;
    const minOmega = cfg.minOmega != null ? cfg.minOmega : 8;          // deg/s
    const horizon = cfg.horizonMs != null ? cfg.horizonMs : 40;
    const replan = cfg.replanMs != null ? cfg.replanMs : 8;
    const midDeg = cfg.midDeg != null ? cfg.midDeg : 6;
    const margin = cfg.marginDeg != null ? cfg.marginDeg : 4;
    const half = (st.width || 0) / 2;
    const win = cfg.trigger === 'angle' || !half ? midDeg : Math.max(midDeg, half - margin);
    const delta = st.delta == null ? wrap180(0 - (st.mid || 0)) : st.delta;
    const omega = isFinite(st.omega) ? st.omega : null;
    const pred = omega == null ? delta : wrap180(delta + omega * lead);
    const out = { delta, pred, win, press: false, armAt: null, at: null, cancel: false, reason: '' };

    if (omega == null || Math.abs(omega) < minOmega) {
      out.reason = 'static';
      out.cancel = true;
      out.press = !!st.armed && Math.abs(pred) <= win;
      return out;
    }

    const degPerMs = omega / 1000;
    const period = 360 / Math.abs(degPerMs);
    let toJudge = -delta / degPerMs;                       // ms until midpoint reaches the pin
    toJudge = ((toJudge % period) + period) % period;      // next occurrence, >= 0
    const dispatchAt = st.t + toJudge - (lead + bias) * 1000;
    const wait = dispatchAt - st.t;

    if (!st.armed) {
      out.reason = 'disarmed';
      out.cancel = true;
      return out;
    }
    // Contain means the pin may be pressed anywhere inside the arc, but the schedule above aims at
    // the MIDPOINT crossing because that is where the tolerance is widest. When that crossing is far
    // away and the pin is ALREADY inside, take the open window now.
    //
    // This used to require delta * omega > 0, i.e. only take it when the arc was rotating away from
    // the pin. On a narrow dial that is the difference between pressing and spinning in place: the
    // window is a handful of degrees, the scheduled crossing is most of a rotation out, and the pass
    // through the arc happens on the other sign - so nothing ever fired. Measured live 2026-11-02:
    // a 30 deg dial produced 279 consecutive 'wait' frames, 0 presses, then 'dial gone'.
    // Containment does not care which side the arc is passing on: inside is inside.
    const insideNowMs = cfg.insideNowMs != null ? cfg.insideNowMs : 60;
    if (cfg.trigger !== 'angle' && st.armed && toJudge > insideNowMs &&
        Math.abs(delta) <= win && Math.abs(pred) <= win) {
      out.reason = 'inside-now';
      out.cancel = true;
      out.press = true;
      return out;
    }
    if (wait <= 0) {
      // Too late to schedule the crossing: press only if the pin is still inside the window
      // at judgement time. Containment turns what would be a dropped dial into a likely hit.
      const inside = Math.abs(pred) <= win;
      out.reason = inside ? 'now-inside' : 'now-outside';
      out.cancel = true;
      out.press = inside;
      return out;
    }
    if (wait <= horizon) {
      const keep = st.pendingAt != null && Math.abs(st.pendingAt - dispatchAt) <= replan;
      out.reason = 'schedule';
      out.at = dispatchAt;
      out.cancel = !keep;
      out.armAt = keep ? null : dispatchAt;
      return out;
    }
    out.reason = 'wait';
    out.cancel = true;
    return out;
  }

  /** Next probe offset (ms) from a bias-sweep config; 0 when the sweep is off. */
  function sweepBias(cfg, i) {
    if (!cfg) return 0;
    let list = cfg.biases;
    if (!list || !list.length) {
      const min = cfg.min != null ? cfg.min : -60;
      const max = cfg.max != null ? cfg.max : 60;
      const step = cfg.step || 15;
      list = [];
      for (let b = min; b <= max + 1e-9; b += step) list.push(Math.round(b));
    }
    return list[((i % list.length) + list.length) % list.length];
  }
  // A press makes the game spawn a fresh triangle in the same widget, with a new random
  // rotation and thickness. Pressing "again" while the SAME triangle is still under the pin is
  // a misclick: the game subtracts the last gain. So a second press on one dial lock is only
  // allowed once the measurement shows a new triangle.
  function newTriangle(press, s, blinks, o) {
    if (!press) return true;                       // first press of the lock
    const opts = o || {};
    if ((blinks || 0) >= (opts.blinkFrames || 2)) return true;   // the ring blinked out: new spawn
    if (press.width != null && s.width != null &&
        Math.abs(Number(s.width) - Number(press.width)) >= (opts.widthJumpDeg || 3)) return true;
    if (press.delta != null && s.delta != null && s.t != null && press.t != null) {
      const dt = Math.max(0, (s.t - press.t) / 1000);
      const predicted = Number(press.delta) + (s.omega || 0) * dt;
      if (Math.abs(wrap180(Number(s.delta) - predicted)) > (opts.jumpDeg || 25)) return true;
    }
    return false;
  }
  /**
   * Speed band a press is scored in. The verified win rate is only meaningful per band: a dial at
   * 120 deg/s has ~300 ms of tolerance and one at 700 deg/s has ~70 ms, so averaging them hides
   * exactly the case this file is trying to fix.
   */
  function omegaBand(omega) {
    const a = Math.abs(omega || 0);
    if (a < 150) return 'slow';
    if (a < 300) return 'mid';
    if (a < 500) return 'fast';
    return 'blur';
  }
  /**
   * Dial-width bands. Speed is not the only difficulty axis: a rare fish can paint a narrow arc
   * whose acceptance window is small even at a moderate spin. Attempts are scored in these bands
   * separately so "narrow dials are lost" is visible instead of averaged into a healthy total.
   * Widths are degrees of the drawn arc; live dials measured 30-200 deg.
   */
  function widthBand(width) {
    const w = Number(width);
    if (!isFinite(w) || w <= 0) return 'unknown';
    if (w < 60) return 'narrow';
    if (w < 100) return 'mid';
    if (w < 140) return 'wide';
    return 'full';
  }
  /**
   * Is this solid panel the catch card, or a piece of reel UI that looks like one?
   *
   * Measured in the live game on 2026-10-27: a real catch card was 296-336 px wide and 430-440
   * tall with a dark-ink share of 0.12-0.23 (cream paper, a few lines of text). The panel that
   * followed every press was 204x272 with an ink share of 0.47-0.59 - a dark reel-UI box. Size
   * alone was not enough (204 > the old 180 px floor), so ink is the separator and width is the
   * backstop. Pure on purpose: the thresholds are the reason the win counter lied.
   */
  function cardShapeOk(m, o) {
    const cfg = o || {};
    const minW = cfg.minW != null ? cfg.minW : 260;
    const maxInk = cfg.maxInk != null ? cfg.maxInk : 0.3;
    if (!m) return { card: false, why: 'none' };
    if (!(m.w >= minW)) return { card: false, why: 'narrow' };
    if (!(m.ink < maxInk)) return { card: false, why: 'inky' };
    return { card: true, why: 'ok' };
  }
  /**
   * What to do on the N-th fruitless attempt to make a cast happen (N counts from 1).
   *
   * A white bubble is not always the CAST button: the caught-indicator and other HUD sprites share
   * the shape, and tapping one changes nothing. Measured live on 2026-10-28: the bot found a blob,
   * tapped it every ~0.9 s for 60+ s, and never cast, because the bubble branch returns before the
   * cast retry. So a rung ladder: the first tap is the normal path, then also the game's own fishing
   * keybind.
   *
   * Never walk. Fishing in this game is SEAT-BASED: the cast prompt is emitted only by the sit-down
   * path (character.sit -> isRaycastHittingWater(seat.fishingReach ?? 50) -> signal showCastButton)
   * and by the post-fish / post-fail result. A standing character has no prompt at all, so walking
   * cannot create one - and the walk itself stands the character up (200 ms of held movement) and,
   * measured live, walked it behind a building where it was neither visible nor fishable. The seat
   * watchdog in step() names that condition instead of flailing.
   *
   * Never stop clicking either. The ladder used to drop the click from rung 3 and press only the
   * keybind, and the rung was only ever reset by a successful dial lock - so two failed taps locked
   * the bot into keybind-only forever. Measured live 2026-10-29: 140 cast retries over 20 minutes,
   * rungs 14-36 every one `tap:false`, while a REEL! prompt sat on screen the whole time, and the
   * panel then paused the session with "nothing to bite: sit on a chair by the water" at a character
   * that was sitting on one. A prompt is a button: press it every time, and add the keybind on top
   * once a click has not taken.
   */
  /**
   * Did the game accept that press?
   *
   * A good press does not close the dial - the game spawns a fresh triangle in the same widget - so
   * "the dial ended soon after" only ever scores the finishing press. The observable present on
   * every press is that spawn: `newTriangle` already detects it (a thickness jump, a delta jump
   * beyond the predicted rotation, or the ring blinking out). No spawn inside the grace means the
   * game did not act on the press.
   *
   * st: { press, s, blinks, opts, graceMs } -> { verdict: 'none'|'pending'|'accepted'|'rejected' }
   */
  function pressOutcome(st) {
    const w = st || {};
    if (!w.press) return { verdict: 'none' };
    const o = w.opts || {};
    const grace = w.graceMs != null ? w.graceMs : (o.pressGraceMs != null ? o.pressGraceMs : 250);
    if (!w.s) return { verdict: 'pending' };
    if (newTriangle(w.press, w.s, w.blinks, o)) return { verdict: 'accepted' };
    if (isFinite(w.press.t) && isFinite(w.s.t) && w.s.t - w.press.t >= grace) return { verdict: 'rejected' };
    return { verdict: 'pending' };
  }
  function castRecovery(n) {
    const i = Math.floor(n) || 0;
    if (i <= 1) return { tap: true, space: false, walk: false };   // the normal path: click the bubble
    return { tap: true, space: true, walk: false };                // click and the keybind together
  }

  /**
   * Cumulative counters -> rates, so the perf probe says WHERE the frame time goes (ms/s and share
   * of wall clock), not just how long one call took. Pure, so the arithmetic is tested.
   * `share` is the fraction of wall time spent on the main thread; nested calls overlap
   * (findBubble includes its snapshot), so read it as attribution, not a partition.
   */
  function perfRates(calls, totals, uptimeMs) {
    const secs = uptimeMs > 0 ? uptimeMs / 1000 : 0;
    const out = {};
    for (const key of Object.keys(totals)) {
      const ms = totals[key] || 0;
      const n = calls[key] || 0;
      const msPerSec = secs ? ms / secs : null;
      out[key] = {
        callsPerSec: secs ? n / secs : null,
        msPerCall: n ? ms / n : null,
        msPerSec,
        share: msPerSec == null ? null : msPerSec / 1000,
      };
    }
    return out;
  }
  // </timing-core>

  /* ---- doctor ----------------------------------------------------------
   * One verdict about why fishing is or is not happening, from state the bot already collects:
   * no DOM, no timers, no reads. tests/doctor.test.js feeds it the states this project has actually
   * been in, so the classes that each cost a live debugging session are named instead of inferred.
   */
  // <doctor-core>
  /**
   * s: { running, paused, hidden, stalled, lastTickAgoMs, postRender,
   *      snapshot: { gl, canvas2d }, readback: { canvas2d, allocMBPerSec },
   *      longtasks: { inLast10s, maxMs }, worstFrameMs,
   *      needsSeat, sincePromptMs, sinceDialMs,
   *      accepted, rejected, acceptRate, dials, held, forced, holdPassesMax }
   * -> { verdict, severity: 'ok'|'warn'|'high', action, evidence }
   */
  function doctor(s) {
    const st = s || {};
    const o = (verdict, severity, action, evidence) =>
      ({ verdict, severity, action, evidence: evidence || {} });

    if (!st.running) return o('idle', 'ok', 'press Start', {});
    if (st.stalled || (st.lastTickAgoMs != null && st.lastTickAgoMs > 2000)) {
      return o('loop-stalled', 'high', 'reload the page: the loop stopped ticking',
        { lastTickAgoMs: st.lastTickAgoMs });
    }
    if (st.hidden) return o('page-hidden', 'warn', 'bring the tab to the front', {});
    if (st.paused) return o('paused', 'ok', 'press Resume', {});
    if (st.postRender === false) {
      return o('path-silent', 'high', 'detection is not on the render hook: rebuild or reinstall',
        { postRender: false });
    }
    // Which path served the quarter-scale read. 3.9.10 shipped a GL path that never engaged and
    // left no trace; this verdict is what would have said so in the first minute.
    const snap = st.snapshot || {};
    const snapN = (snap.gl || 0) + (snap.canvas2d || 0);
    if (snapN >= 50 && !(snap.gl > 0)) {
      return o('snapshot-fallback', 'high', 'the quarter-scale read fell back to getImageData: report it',
        { gl: snap.gl || 0, canvas2d: snap.canvas2d || 0 });
    }
    const rb = st.readback || {};
    if ((rb.canvas2d || 0) > 0 && (rb.allocMBPerSec || 0) > 1) {
      return o('readback-allocating', 'high', 'the readback is allocating: report it',
        { allocMBPerSec: rb.allocMBPerSec, canvas2d: rb.canvas2d });
    }
    const lt = st.longtasks || {};
    if ((lt.inLast10s || 0) >= 3 && (lt.maxMs || 0) >= 100) {
      return o('frame-stalls', 'warn', 'something is stalling the frame: read __fish.perf()',
        { inLast10s: lt.inLast10s, maxMs: lt.maxMs });
    }
    if ((st.worstFrameMs || 0) > 250) {
      return o('frame-stalls', 'warn', 'a frame took ' + Math.round(st.worstFrameMs) + ' ms',
        { worstFrameMs: st.worstFrameMs });
    }
    if (st.needsSeat) return o('not-seated', 'warn', 'sit on a chair by the water', {});
    if (st.profileOpen) return o('profile-open', 'warn', 'a player profile is open over the game: close it to resume', {});
    if (st.playerBlocked) return o('nearby-player', 'warn', 'a tap keeps landing where no dial follows: move spots or close the profile', { playerBlocked: true });
    if ((st.accepted || 0) + (st.rejected || 0) >= 20 &&
        st.acceptRate != null && st.acceptRate < 0.9) {
      return o('press-rejected', 'warn', 'presses are being rejected: read __fish.calibration()',
        { acceptRate: st.acceptRate, accepted: st.accepted, rejected: st.rejected });
    }
    // The 3.9.9 report was a wait of several turns. The bar is set well above one turn on purpose:
    // measured live 2026-11-02, a slow dial can legitimately hold through ~1.03 turns under the
    // 2500 ms ceiling, and flagging that marked a healthy session as broken for its whole duration.
    if ((st.holdPassesMax || 0) > 2.5) {
      return o('timing-held', 'warn', 'the first press waits longer than one rotation',
        { holdPassesMax: st.holdPassesMax, held: st.held, forced: st.forced });
    }
    if (st.sinceDialMs != null && st.sinceDialMs <= 5000) {
      return o('fishing', 'ok', 'none', { sinceDialMs: st.sinceDialMs });
    }
    if (st.sincePromptMs != null && st.sincePromptMs <= 45000) {
      return o('waiting-bite', 'ok', 'none', { sincePromptMs: st.sincePromptMs });
    }
    if (st.sinceDialMs != null && st.sinceDialMs <= 45000) {
      return o('waiting-bite', 'ok', 'none', { sinceDialMs: st.sinceDialMs });
    }
    return o('detector-blind', 'high',
      'no prompt and no dial for 45 s: run __fish.calibrate() and compare the colours',
      { sincePromptMs: st.sincePromptMs, sinceDialMs: st.sinceDialMs });
  }
  // </doctor-core>

  /* ---- run statistics --------------------------------------------------
   * The numbers a long session has to produce: a catch rate with an interval, the press acceptance,
   * and the per-band split. Pure, so tests can check them against intervals this repo has already
   * published instead of trusting the arithmetic that quotes them.
   */
  // <stats-core>
  /**
   * Wilson score interval for k successes out of n. Returns null for an empty sample rather than a
   * NaN that would make the exported JSON invalid.
   */
  function wilson(k, n, z) {
    const kk = Number(k), nn = Number(n);
    if (!(nn > 0) || !(kk >= 0) || kk > nn) return null;
    const zz = z == null ? 1.96 : Number(z);
    const p = kk / nn;
    const denom = 1 + (zz * zz) / nn;
    const centre = p + (zz * zz) / (2 * nn);
    const margin = zz * Math.sqrt((p * (1 - p)) / nn + (zz * zz) / (4 * nn * nn));
    return { p, lo: (centre - margin) / denom, hi: (centre + margin) / denom };
  }

  /**
   * One summary of a run's attempts. The attempt is the denominator: a press is not a fish, so the
   * rate is caught / attempts and the press numbers are reported beside it, never mixed in.
   * attempts: [{ verdict, band, widthBand, presses, pressAccepted, pressRejected, dials,
   *              avgWidth, ms, startAt }]
   */
  function runSummary(attempts, o) {
    const list = Array.isArray(attempts) ? attempts : [];
    const cfg = o || {};
    const widths = {}, bands = {};
    let n = 0, caught = 0, lost = 0, presses = 0, accepted = 0, rejected = 0, dials = 0, ms = 0;
    let widthSum = 0, widthN = 0, firstAt = null, lastAt = null;
    for (const a of list) {
      if (!a) continue;
      n++;
      const hit = a.verdict === 'caught';
      if (hit) caught++;
      else if (a.verdict === 'lost') lost++;
      presses += a.presses || 0;
      accepted += a.pressAccepted || 0;
      rejected += a.pressRejected || 0;
      dials += a.dials || 0;
      ms += a.ms || 0;
      if (a.avgWidth != null && isFinite(a.avgWidth)) { widthSum += a.avgWidth; widthN++; }
      if (a.startAt != null) {
        if (firstAt == null || a.startAt < firstAt) firstAt = a.startAt;
        if (lastAt == null || a.startAt > lastAt) lastAt = a.startAt;
      }
      const wb = String(a.widthBand || 'unknown');
      const w = widths[wb] || (widths[wb] = { band: wb, attempts: 0, caught: 0, lost: 0 });
      w.attempts++; if (hit) w.caught++; else if (a.verdict === 'lost') w.lost++;
      const sb = String(a.band || 'unknown');
      const b = bands[sb] || (bands[sb] = { band: sb, attempts: 0, caught: 0, lost: 0 });
      b.attempts++; if (hit) b.caught++; else if (a.verdict === 'lost') b.lost++;
    }
    const pressN = accepted + rejected;
    return {
      attempts: n, caught, lost,
      // How many dials arrived with the press gate shut. Above zero after the arming fix means the
      // gate is being closed mid-dial and never reopened, which is a different bug.
      locksDisarmed: cfg.locksDisarmed != null ? cfg.locksDisarmed : null,
      catchRate: n ? caught / n : null,
      catchCi: wilson(caught, n),
      presses, accepted, rejected,
      pressAcceptRate: pressN ? accepted / pressN : null,
      pressCi: wilson(accepted, pressN),
      pressesPerAttempt: n ? +(presses / n).toFixed(2) : null,
      pressesPerCatch: caught ? +(presses / caught).toFixed(2) : null,
      dials,
      meanAttemptMs: n ? Math.round(ms / n) : null,
      meanWidth: widthN ? +(widthSum / widthN).toFixed(1) : null,
      widths: Object.keys(widths).sort().map((k) => widths[k]),
      bands: Object.keys(bands).sort().map((k) => bands[k]),
      firstAt, lastAt,
      cut: cfg.cut || null,
    };
  }

  /**
   * What the presses actually did, from the probe log: how often the model predicted a press inside
   * the window, how wrong the prediction turned out to be in degrees, and how many presses were
   * never measured (accepted by assumption rather than observed).
   */
  /**
   * How well (delta, omega) predicts the next frame's delta, in degrees and in milliseconds.
   *
   * This is the quantity that decides a marginal narrow press, and it must be measured WITHOUT
   * pressing: a press makes the game spawn a new triangle, so the frame after one jumps for a
   * reason that is not model error. The first version of this measured exactly that post-press
   * frame and reported 77 deg of "error" on a 40 deg window - an artifact of the spawn.
   *
   * ms is the number that matters: a +/-18.5 deg window at 300 deg/s is only 62 ms wide.
   */
  function predictionSummary(log) {
    const rows = Array.isArray(log) ? log.filter(Boolean) : [];
    const deg = rows.map((r) => Math.abs(r.err)).filter((v) => isFinite(v)).sort((a, b) => a - b);
    const ms = rows.map((r) => (r.om ? (Math.abs(r.err) / Math.abs(r.om)) * 1000 : null))
      .filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
    const q = (arr, p) => (arr.length ? +arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(1) : null);
    const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    return {
      samples: rows.length,
      meanAbsDeg: deg.length ? +mean(deg).toFixed(1) : null,
      p50Deg: q(deg, 0.5),
      p95Deg: q(deg, 0.95),
      maxDeg: deg.length ? +deg[deg.length - 1].toFixed(1) : null,
      meanAbsMs: ms.length ? +mean(ms).toFixed(1) : null,
      p50Ms: q(ms, 0.5),
      p95Ms: q(ms, 0.95),
      maxMs: ms.length ? +ms[ms.length - 1].toFixed(1) : null,
      over50ms: ms.filter((v) => v > 50).length,
      over50msRate: ms.length ? +(ms.filter((v) => v > 50).length / ms.length).toFixed(3) : null,
    };
  }

  /** Press acceptance, and how much of it was observed rather than assumed. */
  function pressAcceptSummary(log) {
    const rows = Array.isArray(log) ? log.filter(Boolean) : [];
    const judged = rows.filter((r) => r.inside != null);
    const assumed = rows.filter((r) => r.via === 'assumed').length;
    const settled = rows.filter((r) => r.via === 'settled').length;
    return {
      presses: rows.length,
      settled,
      assumed,
      assumedRate: (settled + assumed) ? +(assumed / (settled + assumed)).toFixed(3) : null,
      insidePredicted: rows.filter((r) => r.inside === true).length,
      judged: judged.length,
      insideRate: judged.length ? +(rows.filter((r) => r.inside === true).length / judged.length).toFixed(3) : null,
      meanWindowDeg: rows.filter((r) => isFinite(r.win)).length
        ? +(rows.filter((r) => isFinite(r.win)).reduce((s, r) => s + r.win, 0) / rows.filter((r) => isFinite(r.win)).length).toFixed(1)
        : null,
    };
  }

  /**
   * Press verdicts by their evidence. `observed` saw the game spawn a new triangle; `assumed`
   * inferred acceptance from the next press arriving; `timing` inferred it from the dial closing
   * soon after. Only the observed row is a measurement - the others are why the headline used to
   * read 697 of 697 accepted.
   */
  function pressVerdictReport(t) {
    const src = t || {};
    const one = (c) => {
      const accepted = (c && c.accepted) || 0;
      const rejected = (c && c.rejected) || 0;
      return { accepted, rejected, total: accepted + rejected, rate: accepted + rejected ? +(accepted / (accepted + rejected)).toFixed(3) : null };
    };
    return { observed: one(src.observed), assumed: one(src.assumed), timing: one(src.timing) };
  }

  // </stats-core>

  /* ---- coordinate frame ------------------------------------------------
   * Everything the detectors see is in the UI canvas's backing-store pixels. Everything the DOM
   * does - elementFromPoint, PointerEvent, the panel's exclusion rect - is in CSS pixels. Those
   * are the same only while the canvas is 1:1 with its CSS box, which is true at the dpr the game
   * was measured at and is not something to keep assuming silently.
   */
  // <coords>
  function cssPoint(x, y, frame) {
    if (!frame) return { x: x, y: y };
    const kx = frame.cw ? frame.w / frame.cw : 1;
    const ky = frame.ch ? frame.h / frame.ch : 1;
    return { x: frame.left + x * kx, y: frame.top + y * ky };
  }
  // </coords>

  /* ---- dial memory ------------------------------------------------------
   * The reel widget sits in one place for a whole session, so its circle is worth remembering: a
   * fresh start has no prompt to learn it from, and the old seed was a literal point measured at
   * one viewport. It is stored with the canvas size it was measured at, because the widget's place
   * in the UI layer scales with the canvas, not with the window's CSS size.
   */
  // <dial-memory>
  const DIAL_KEY = 'autofish:dial:v1';
  const DIAL_R_MIN = 60, DIAL_R_MAX = 140;

  const finite = (n) => typeof n === 'number' && isFinite(n);
  const finitePositive = (n) => finite(n) && n > 0;

  /**
   * Validate a stored circle against the canvas it will be used on. Same canvas -> unchanged; a
   * proportionally bigger/smaller canvas -> scaled; anything else -> null, because a circle from a
   * different aspect is a different camera, not a resize.
   */
  function dialGeoFit(stored, cw, ch) {
    if (!stored || !finitePositive(cw) || !finitePositive(ch)) return null;
    const cx = Number(stored.cx), cy = Number(stored.cy), R = Number(stored.R);
    const sw0 = Number(stored.cw), sh0 = Number(stored.ch);
    if (!finite(cx) || !finite(cy) || !finite(R) || !finitePositive(sw0) || !finitePositive(sh0)) return null;
    let k = 1;
    if (sw0 !== cw || sh0 !== ch) {
      k = cw / sw0;
      if (Math.abs(ch / sh0 - k) > 0.02) return null;          // not the same camera, just a resize
    }
    const out = { cx: Math.round(cx * k), cy: Math.round(cy * k), R: Math.round(R * k) };
    if (out.R < DIAL_R_MIN || out.R > DIAL_R_MAX) return null;
    if (out.cx < 0 || out.cy < 0) return null;
    return out;
  }

  function loadDialMemory() {
    let raw = null;
    try { raw = window.localStorage.getItem(DIAL_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!p || p.v !== 1) return null;
      return { cx: p.cx, cy: p.cy, R: p.R, cw: p.cw, ch: p.ch };
    } catch (e) { return null; }
  }

  function saveDialMemory(g) {
    if (!g || !uiCanvas || !uiCanvas.width) return false;
    try {
      window.localStorage.setItem(DIAL_KEY, JSON.stringify({
        v: 1, cx: Math.round(g.cx), cy: Math.round(g.cy), R: Math.round(g.R),
        cw: uiCanvas.width, ch: uiCanvas.height,
      }));
      return true;
    } catch (e) { return false; }
  }

  function sameDial(a, b) {
    return !!a && !!b && Math.abs(a.cx - b.cx) <= 2 && Math.abs(a.cy - b.cy) <= 2 && Math.abs(a.R - b.R) <= 2;
  }
  // </dial-memory>

  /* ---- catch log --------------------------------------------------------
   * A durable, server-free record of every parsed catch. The data helpers in the block below are
   * pure (no DOM, no storage), so tests/catchlog.test.js pulls them out under node; the browser
   * storage calls sit underneath.
   *
   * Why a catalogue: the catch card prints a rarity word only for non-common fish, so commons
   * arrive blank. The game ships its own fish table (name, tier, weight range, gold), extracted
   * by scripts/gen-catalogue.js - a lookup, never a pixel guess.
   */
  // <catch-log>
  // <species-catalogue>
const SPECIES = [
  ["Anchovy","Common",0.1,0.3,5], ["Arctic Cod","Common",0.1,1,7], ["Bartlett's Anthias","Common",0.1,1,7], ["Bass","Common",1,8,8],
  ["Black Sea Bass","Common",1,10,7], ["Bluegills","Common",0.1,2,6], ["Boops","Common",0.01,0.1,7], ["Boxfish","Common",0.1,1,7],
  ["Capelin","Common",0.1,1,7], ["Catfish","Common",2,20,12], ["Cod","Common",2,15,10], ["Eelpouts","Common",0.1,1,7],
  ["Eyeless Shrimp","Common",0.01,0.1,7], ["Firefly Squid","Common",0.01,0.1,7], ["Flounder","Common",1,5,7], ["Frozen Fish","Common",1,10,7],
  ["Golden Shiner","Common",0.05,0.5,5], ["Hatched Fish","Common",0.01,0.1,7], ["Hawaiian Gregory","Common",0.1,1,7], ["Herring","Common",0.5,2,7],
  ["Keeltail Needlefish","Common",0.1,1,7], ["Lantern Fish","Common",0.1,1,7], ["Largemouth Bass","Common",1,10,10], ["Leech","Common",0.01,0.05,5],
  ["Lobster","Common",0.45,5,8], ["Mackerel","Common",1,4,9], ["Minnow","Common",0.01,0.1,5], ["Mud Crab","Common",0.1,1,7],
  ["Northern Shrimp","Common",0.01,0.1,7], ["Riftia","Common",0.1,1,7], ["Sand Lance","Common",0.01,0.1,7], ["Sardine","Common",0.2,1,6],
  ["Sea Cucumber","Common",0.1,1,7], ["Sea Urchin","Common",0.5,3,8], ["Shrimp","Common",0.1,0.5,5], ["Snook","Common",1,15,11],
  ["Star Fish","Common",0.2,2,6], ["Swamp Barb","Common",0.05,0.3,6], ["Tadpole","Common",0.01,0.05,5], ["The Deepest Rock","Common",1,10,7],
  ["White Sucker","Common",0.5,3,8], ["Yellow Perch","Common",0.2,2,7], ["Yellowstripe Goatfish","Common",0.1,1,7], ["Alligator Gar","Uncommon",10,140,30],
  ["Arctic Char","Uncommon",1,10,20], ["Arctic Skate","Uncommon",1,10,20], ["Asian Swamp Eel","Uncommon",0.5,5,18], ["Clown Fish","Uncommon",0.2,1,19],
  ["Crawfish","Uncommon",0.02,0.2,15], ["Eel","Uncommon",2,25,25], ["European Toad","Uncommon",0.02,0.15,16], ["Flagtail Blanquillo","Uncommon",1,10,20],
  ["Forceps Fish","Uncommon",1,10,20], ["Goby Fish","Uncommon",1,10,20], ["Greenland Halibut","Uncommon",1,10,20], ["Hagfish","Uncommon",0.1,1,20],
  ["Hawaiian Bigeye","Uncommon",1,10,20], ["Kelp Snailfish","Uncommon",0.1,1,20], ["Larger Mouth Bass","Uncommon",3,25,22], ["Moon Jellyfish","Uncommon",1,10,20],
  ["Moorish Idol","Uncommon",0.5,2,20], ["Mudfish","Uncommon",1,8,20], ["Mudskipper","Uncommon",0.05,0.3,17], ["Oyster","Uncommon",0.3,2,15],
  ["Puffer Fish","Uncommon",0.5,3,18], ["Rainbow Darter","Uncommon",0.01,0.1,19], ["Rocks with Mussels","Uncommon",1,10,20], ["Roi Fish","Uncommon",1,10,20],
  ["Salmon","Uncommon",5,30,28], ["Sea Sponge","Uncommon",1,10,20], ["Seahorse","Uncommon",0.1,1,17], ["Snailfish","Uncommon",1,10,20],
  ["Snow Crab","Uncommon",1,10,20], ["Spiny Dogfish","Uncommon",1,10,20], ["Squid","Uncommon",1,15,24], ["Sturgeon","Uncommon",20,350,35],
  ["Tarpon","Uncommon",15,160,28], ["Tetra","Uncommon",0.1,0.5,16], ["Trevally","Uncommon",3,25,22], ["Tripod Fish","Uncommon",0.1,1,20],
  ["Tubenose Poacher","Uncommon",0.1,1,20], ["Tuna","Uncommon",20,400,35], ["Walleye","Uncommon",1,10,24], ["Yellow Tang","Uncommon",1,10,20],
  ["Anemone","Rare",1,10,55], ["Axolotl","Rare",0.05,0.3,55], ["Banded Pipefish","Rare",1,10,55], ["Beaver","Rare",10,30,60],
  ["Blobfish","Rare",2,20,50], ["Bull Frog","Rare",0.2,0.8,48], ["Coelacanth","Rare",15,180,75], ["Dragon Fish","Rare",1,10,55],
  ["Dumbo Octopus","Rare",0.1,1,55], ["Flying Fish","Rare",1,5,42], ["Frog Fish","Rare",0.1,1,50], ["Giant Isopod","Rare",1,10,55],
  ["Goldfish","Rare",0.5,2,45], ["Green Coral","Rare",1,10,55], ["Greenland Shark","Rare",100,1000,55], ["Harlequin Shrimp","Rare",1,10,55],
  ["Harp Seal","Rare",100,1000,55], ["Koi Carp","Rare",2,35,55], ["Lamprey","Rare",0.5,5,52], ["Longfin Batfish","Rare",1,10,55],
  ["Lumpsucker","Rare",0.1,1,55], ["Mekong Catfish","Rare",50,300,75], ["Nautilus","Rare",0.1,1,55], ["Nurse Shark","Rare",50,150,70],
  ["Pancake Batfish","Rare",0.1,1,55], ["Pink Coral","Rare",1,10,55], ["Plant Fish","Rare",0.1,0.5,42], ["Platypus","Rare",1,3,65],
  ["Pompeii Worm","Rare",1,10,55], ["Ribbon Moray","Rare",5,40,60], ["Semicircle Angelfish","Rare",1,10,55], ["Snapping Turtle","Rare",5,35,58],
  ["Snipe Eel","Rare",0.1,1,55], ["Softshell Turtle","Rare",3,25,55], ["Stingray","Rare",10,800,65], ["Surgeon Fish","Rare",1,10,55],
  ["Thats A Huge Mouth Bass","Rare",5,50,68], ["Unicorn Fish","Rare",1,10,55], ["Vulcanoctopus","Rare",1,10,55], ["American Alligator","Epic",200,1000,200],
  ["Anomalocaris","Epic",1,10,140], ["Arowana","Epic",3,20,110], ["Banana Moray","Epic",1,10,140], ["Basking Shark","Epic",1000,10000,140],
  ["Beluga Whale","Epic",1000,10000,140], ["Betta","Epic",0.01,0.05,45], ["Blue Lobster","Epic",1,9,120], ["Crown of Thorns","Epic",1,10,140],
  ["Fried Egg Jellyfish","Epic",5,35,95], ["Frilled Shark","Epic",100,1000,140], ["Goliath Tigerfish","Epic",15,70,150], ["Great Barracuda","Epic",1,10,140],
  ["Hammer Shark","Epic",500,1200,165], ["Hermit Crab","Epic",1,10,140], ["Horseshoe Crab","Epic",2,10,100], ["Lais Tembiring","Epic",5,50,120],
  ["Lion Fish","Epic",1,5,85], ["Mandarinfish","Epic",1,10,140], ["Manta Ray","Epic",600,5000,200], ["Marlin","Epic",100,1800,175],
  ["Mushroom Jellyfish","Epic",10,60,95], ["Octopus","Epic",5,150,110], ["Ogre Fish","Epic",20,100,130], ["Orca","Epic",1000,10000,140],
  ["Paddle Fish","Epic",25,200,165], ["Parrotfish","Epic",100,1000,140], ["Pharooh Cuddlefish","Epic",1,10,140], ["Pike","Epic",5,55,100],
  ["Piranha","Epic",0.5,4,85], ["Polar Bear","Epic",100,1000,140], ["Spider Crab","Epic",1,10,140], ["Stargazer Fish","Epic",1,10,140],
  ["Sun Fish","Epic",500,5000,190], ["Swamp Chimera","Epic",50,500,180], ["Swamp Pupper","Epic",5,30,90], ["The Largest Mouth Bass","Epic",10,100,175],
  ["Tiger Shark","Epic",200,1400,180], ["Titan Triggerfish","Epic",1,10,140], ["Twinspot Lionfish","Epic",1,10,140], ["Viperfish","Epic",1,10,140],
  ["Wels Catfish","Epic",50,300,190], ["Whale Shark","Epic",15000,40000,220], ["Wolffish","Epic",1,10,140], ["Yeti Crab","Epic",100,1000,140],
  ["A Penguin?","Legendary",1,10,800], ["Akhlut","Legendary",100,1000,800], ["Amarok","Legendary",100,1000,800], ["Anaconda","Legendary",100,550,500],
  ["Arapaima","Legendary",100,440,600], ["Berg","Legendary",1000,10000,800], ["Bowhead Whale","Legendary",1000,10000,800], ["Cthulhu","Legendary",50000,200000,1000],
  ["Definitely not Catfish","Legendary",50,300,750], ["Dipterus","Legendary",5,40,800], ["Giant Clam","Legendary",1,10,800], ["Giant Squid","Legendary",600,1500,750],
  ["Golden Goldfish","Legendary",2,8,500], ["Green Sea Turtle","Legendary",1,10,800], ["Humphead Wrasse","Legendary",1,10,800], ["Ignis Cephalopod","Legendary",1000,10000,800],
  ["Kappa","Legendary",50,200,900], ["Kelpie","Legendary",200,1000,850], ["Lofee Bean Can","Legendary",50,300,18], ["Lush Witch","Legendary",30,150,950],
  ["Mantis Shrimp","Legendary",1,10,800], ["Marlin's Boot","Legendary",50,300,20], ["Megalodon","Legendary",50000,120000,900], ["Menehune","Legendary",1,10,800],
  ["Mermaid","Legendary",110,170,900], ["Mermaid?","Legendary",100,180,800], ["Moʻo","Legendary",1,10,800], ["Nyarlathotep","Legendary",1000,50000,1000],
  ["Ocean Man","Legendary",150,250,750], ["Ogre King","Legendary",500,3000,900], ["Oh Boy Thats A Big Bass","Legendary",100,500,750], ["Phantom Jellyfish","Legendary",10,100,500],
  ["Pink Canny","Legendary",50,300,60], ["Sea Bunny","Legendary",1,10,800], ["Snapping Dragon","Legendary",200,2000,850], ["Sperm Whale","Legendary",25000,125000,800],
  ["Swamp Monster","Legendary",5000,50000,950], ["The Bloop","Legendary",1000,10000,800], ["True Blobfish","Legendary",1,10,800], ["Volcanic Snail","Legendary",1,10,800],
  ["White Lobster","Legendary",1,15,400], ["White Steel Eel","Legendary",10,100,700], ["Barreleye Fish","Secret",1,5,1500], ["Billy Bass","Secret",1,5,2500],
  ["Black Seadevil Anglerfish","Secret",0.05,1,1500], ["Devil's Hole Pupfish","Secret",0.01,0.02,2000], ["Flowerhorn Cichlid","Secret",1,10,1500], ["Ghost Shark","Secret",1,16,1750],
  ["Goblin Shark","Secret",23,210,1500], ["Gulper Eel","Secret",2,10,1500], ["Plankton","Secret",0.01,0.1,1500], ["Red Handfish","Secret",0.04,0.1,1500],
  ["Bobbit Worm","Halloween",10,100,100], ["Nessie","Halloween",1000,10000,180], ["Siren","Halloween",100,200,150], ["Skeleton Fish","Halloween",1,10,60],
  ["The Great Angler","Halloween",500,5000,200], ["Vampire Squid","Halloween",5,30,75], ["Fish-Deer","Christmas",50,200,180], ["Garden Eel","Christmas",2,15,100],
  ["Narwhal","Christmas",800,3500,250], ["Ornated Jelly Fish","Christmas",5,30,150], ["Pinecone Fish","Christmas",1,5,75], ["Walrus","Christmas",500,1500,200]
];
  // </species-catalogue>

  const TIER_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas'];
  const LOG_KEY = 'autofish:log:v1';
  const LOG_PREFIX = LOG_KEY + ':';
  // One catch history per profile. The ledger used to be keyed by origin alone, so two accounts in
  // the same browser silently shared a strip. 'default' keeps the pre-profile key working.
  let logProfile = 'default';
  function logKey() { return LOG_PREFIX + logProfile; }
  const TIER_BY_LOWER = {};
  for (const tier of TIER_ORDER) TIER_BY_LOWER[tier.toLowerCase()] = tier;
  const SPECIES_BY_NAME = {};
  for (const row of SPECIES) SPECIES_BY_NAME[row[0].toLowerCase()] = row;

  function tidyName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /** 'COMMON' / 'common' / ' Common ' -> 'Common'; anything else -> ''. */
  function normTier(s) {
    return TIER_BY_LOWER[tidyName(s).toLowerCase()] || '';
  }

  /**
   * Card weight -> kilograms. The card prints '13.7 kg' or '350 g' (also t / lb); a blank or
   * unparseable weight stays null so it never poisons the best-weight comparison.
   */
  function parseWeightKg(text) {
    const m = /([0-9]+(?:\.[0-9]+)?)\s*(kg|g|t|lb)\b/i.exec(String(text == null ? '' : text));
    if (!m) return null;
    const n = Number(m[1]);
    if (!isFinite(n)) return null;
    const unit = m[2].toLowerCase();
    if (unit === 'g') return n / 1000;
    if (unit === 't') return n * 1000;
    if (unit === 'lb') return +(n * 0.45359237).toFixed(3);
    return n;
  }

  /**
   * Split a display name into variant and base species. The game renders a shiny catch as
   * 'Shiny <name>' and a special fish as 'Golden <name>', so the prefix is data, not a species.
   */
  function splitVariant(name) {
    const full = tidyName(name);
    const m = /^(Shiny|Golden)\s+(.+)$/i.exec(full);
    if (m) return { variant: m[1].toLowerCase() === 'shiny' ? 'Shiny' : 'Golden', base: tidyName(m[2]) };
    return { variant: '', base: full };
  }

  /** {name, base, variant, shiny, golden, rarity, minWeight, maxWeight, baseGold, known} */
  function speciesInfo(name) {
    const parts = splitVariant(name);
    const row = SPECIES_BY_NAME[parts.base.toLowerCase()] || null;
    return {
      name: tidyName(name),
      base: parts.base,
      variant: parts.variant,
      shiny: parts.variant === 'Shiny',
      golden: parts.variant === 'Golden',
      rarity: row ? normTier(row[1]) : '',
      minWeight: row ? row[2] : null,
      maxWeight: row ? row[3] : null,
      baseGold: row ? row[4] : null,
      known: !!row,
    };
  }

  /**
   * One parsed catch -> the record the ledger, the CSV and the panel read. Rarity is the card's
   * own word when it printed one; otherwise it is the catalogue's tier and 'derived' says so.
   */
  function describeCatch(rec) {
    const r = rec || {};
    const info = speciesInfo(r.species);
    const printed = normTier(r.rarity);
    return {
      species: info.name || 'Unknown',
      base: info.base,
      variant: info.variant,
      shiny: info.shiny,
      golden: info.golden,
      rarity: printed || info.rarity || 'Unknown',
      derived: !printed,
      known: info.known,
      weightKg: parseWeightKg(r.weight),
      weight: r.weight || '',
      value: r.value || '',
      quality: r.quality || '',
    };
  }

  /** Local calendar day, so 'today' matches the player's clock rather than UTC. */
  function logDay(ms) {
    const d = new Date(ms == null ? Date.now() : ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function emptyLog(t) {
    const at = t == null ? Date.now() : t;
    const rarity = {};
    for (const tier of TIER_ORDER) rarity[tier] = 0;
    return { v: 1, createdAt: at, updatedAt: at, total: 0, shiny: 0, golden: 0, species: {}, rarity, unknown: {}, days: {}, last: null };
  }

  /** Append one described catch in place and return the same ledger. */
  function addToLog(log, e, t) {
    const at = t == null ? Date.now() : t;
    const book = log && log.v === 1 ? log : emptyLog(at);
    const name = e.species || 'Unknown';
    book.total = (book.total || 0) + 1;
    book.updatedAt = at;
    const s = book.species[name] || (book.species[name] = { n: 0, best: null, bestAt: null, first: at, last: at, shiny: false, rarity: e.rarity, derived: !!e.derived });
    s.n += 1;
    s.last = at;
    s.rarity = e.rarity;
    s.derived = !!e.derived;
    if (e.shiny) s.shiny = true;
    if (typeof e.weightKg === 'number' && isFinite(e.weightKg) && (s.best == null || e.weightKg > s.best)) {
      s.best = e.weightKg;
      s.bestAt = at;
    }
    book.rarity[e.rarity] = (book.rarity[e.rarity] || 0) + 1;
    // Unknown means the card printed no tier and the catalogue does not know the species. Keep the
    // names so the gap is a worklist instead of an invisible pile of catches.
    if (e.rarity === 'Unknown') {
      if (!book.unknown) book.unknown = {};
      book.unknown[name] = (book.unknown[name] || 0) + 1;
    }
    if (e.shiny) book.shiny = (book.shiny || 0) + 1;
    if (e.golden) book.golden = (book.golden || 0) + 1;
    const key = logDay(at);
    const day = book.days[key] || (book.days[key] = { n: 0, rarity: {}, shiny: 0, golden: 0 });
    day.n += 1;
    day.rarity[e.rarity] = (day.rarity[e.rarity] || 0) + 1;
    // Variants are per-day too: "how many shinies today" must not mean "all time".
    if (e.shiny) day.shiny = (day.shiny || 0) + 1;
    if (e.golden) day.golden = (day.golden || 0) + 1;
    book.last = {
      species: name, rarity: e.rarity, derived: !!e.derived, shiny: !!e.shiny,
      weight: e.weight, weightKg: typeof e.weightKg === 'number' ? e.weightKg : null,
      value: e.value, at,
    };
    return book;
  }

  /** Keep the newest maxDays day buckets so the ledger cannot grow forever. */
  function trimLog(log, maxDays) {
    const keep = maxDays == null ? 60 : maxDays;
    const days = Object.keys(log.days || {}).sort();
    while (days.length > keep) delete log.days[days.shift()];
    return log;
  }

  /** What the panel and __fish.log() show: totals, tiers, today, best, last. */
  function logSummary(log, t) {
    const book = log && log.v === 1 ? log : emptyLog(t);
    const byRarity = TIER_ORDER.map((tier) => ({ rarity: tier, n: book.rarity[tier] || 0 }));
    for (const key of Object.keys(book.rarity)) if (TIER_ORDER.indexOf(key) < 0) byRarity.push({ rarity: key, n: book.rarity[key] });
    const names = Object.keys(book.species);
    let best = null;
    for (const name of names) {
      const s = book.species[name];
      if (s.best != null && (!best || s.best > best.weightKg)) best = { species: name, weightKg: s.best, at: s.bestAt };
    }
    const top = names
      .map((name) => ({ species: name, n: book.species[name].n }))
      .sort((a, b) => b.n - a.n || (a.species < b.species ? -1 : 1))
      .slice(0, 5);
    const key = logDay(t == null ? Date.now() : t);
    const today = book.days[key] || { n: 0, rarity: {} };
    return {
      total: book.total || 0,
      speciesCount: names.length,
      shiny: book.shiny || 0,
      golden: book.golden || 0,
      byRarity, top, best,
      unknown: book.unknown || {},
      unknownNames: Object.keys(book.unknown || {}).sort(),
      last: book.last || null,
      today: {
        day: key, n: today.n || 0, shiny: today.shiny || 0, golden: today.golden || 0,
        byRarity: TIER_ORDER.map((tier) => ({ rarity: tier, n: today.rarity[tier] || 0 })).concat(Object.keys(today.rarity || {}).filter((k) => TIER_ORDER.indexOf(k) < 0).map((k) => ({ rarity: k, n: today.rarity[k] }))),
      },
      updatedAt: book.updatedAt || null,
      since: book.createdAt || null,
      days: Object.keys(book.days || {}).length,
    };
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** One row per species, newest counts first - the thing you paste into a spreadsheet. */
  function logCsv(log) {
    const book = log && log.v === 1 ? log : emptyLog();
    const head = ['species', 'rarity', 'derived', 'shiny', 'count', 'best_kg', 'first_seen', 'last_seen'];
    const rows = Object.keys(book.species)
      .map((name) => ({ name, s: book.species[name] }))
      .sort((a, b) => b.s.n - a.s.n || (a.name < b.name ? -1 : 1))
      .map((r) => [r.name, r.s.rarity, r.s.derived ? 'yes' : 'no', r.s.shiny ? 'yes' : 'no',
        r.s.n, r.s.best == null ? '' : r.s.best,
        new Date(r.s.first).toISOString(), new Date(r.s.last).toISOString()]);
    return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  }
  /* ---- catch ledger storage --------------------------------------------
   * localStorage is the whole persistence story of the one-file userscript: a few kilobytes, one
   * write per catch, never able to break the loop. A blocked or full store just means no history.
   */
  let ledger = null;
  function loadLedger() {
    if (ledger) return ledger;
    let raw = null;
    try { raw = window.localStorage.getItem(logKey()); } catch (e) { raw = null; }
    if (!raw && logProfile === 'default') {
      // The pre-profile ledger (autofish:log:v1) belongs to whoever used this browser first.
      // Move it to the default profile once, so an upgrade never looks like lost history.
      try { raw = window.localStorage.getItem(LOG_KEY); } catch (e) { raw = null; }
      if (raw) { try { window.localStorage.setItem(logKey(), raw); } catch (e) {} }
    }
    if (!raw) return (ledger = emptyLog());
    try {
      const parsed = JSON.parse(raw);
      ledger = parsed && parsed.v === 1 && parsed.species && parsed.rarity ? parsed : emptyLog();
    } catch (e) { ledger = emptyLog(); }
    return ledger;
  }
  function saveLedger(book) {
    ledger = book;
    try { window.localStorage.setItem(logKey(), JSON.stringify(book)); return true; } catch (e) { return false; }
  }
  /** Every profile that has a ledger in this browser, newest naming first. */
  function logProfiles() {
    const out = [];
    try {
      const st = window.localStorage;
      for (let i = 0; i < (st.length || 0); i++) {
        const k = st.key(i);
        if (k && k.indexOf(LOG_PREFIX) === 0) out.push(k.slice(LOG_PREFIX.length));
      }
    } catch (e) { /* a blocked store simply has no discoverable profiles */ }
    if (out.indexOf('default') < 0) out.unshift('default');
    return out.sort();
  }

  // </catch-log>

  /* ------------------------------------------------------------- log ----- */
  F.events = [];
  function L(msg, extra) {
    F.events.push(Object.assign({ t: Math.round(now()), msg }, extra || {}));
    if (F.events.length > 600) F.events.shift();
  }

  /* -------------------------------------------------------- surfaces ----- */
  let uiCanvas = null, gameCanvas = null;
  let inkBuf = null, inkCtx = null, uiBlank = 0, uiAdopted = false, uiCheckAt = 0;
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
    F.cardCheckAt = 0; F.cardScan = 0; F.lastCard = 0; F.cardWait = null;
    F.geo = null; F.bad = 0; F.pressesThisDial = 0; F.lastLockAt = 0;
    const cw = (uiCanvas && uiCanvas.width) || window.innerWidth;
    const ch = (uiCanvas && uiCanvas.height) || window.innerHeight;
    F.hint = { x: Math.round(cw / 2), y: Math.round(ch * 0.42) };
    L('surface resized', { w: cw, h: ch });
  }
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
  // <readback-core>
  /**
   * readPixels hands back the framebuffer bottom-up, while every detector indexes a read
   * top-down from the x/y it asked for. Reverse the rows in place; `row` is supplied by the
   * caller so the flip does not allocate a buffer per read.
   */
  function flipRows(d, w, h, row) {
    const stride = w * 4;
    for (let top = 0, bot = h - 1; top < bot; top++, bot--) {
      const a = top * stride, b = bot * stride;
      row.set(d.subarray(a, a + stride));
      d.set(d.subarray(b, b + stride), a);
      d.set(row.subarray(0, stride), b);
    }
    return d;
  }
  /** GL's origin is bottom-left: the top-down row `y` starts at this framebuffer row. */
  function glRowY(bh, y, h) { return bh - (y + h); }
  // </readback-core>

  let glCanvasRef = null, glCtx = null, glBuf = null, glRow = null, glFails = 0;

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

  let ubuf = null, uctx = null;
  /** The allocating 2D read: the only reader for a plain 2D surface and the GL path's fallback. */
  function readUI2d(x, y, w, h) {
    if (!ubuf) {
      ubuf = document.createElement('canvas');
      ubuf.width = 520; ubuf.height = 520;
      uctx = ubuf.getContext('2d', { willReadFrequently: true });
    }
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
  // <prompt-box>
  /**
   * The CAST!/REEL! box was measured on a 1620x1031 surface. Read as a fixed rectangle it only
   * fits that size: the bubble floats above the play area and moves with the viewport, so in a
   * smaller window the boxed scan misses and every prompt pays a whole-surface pass. The box is
   * therefore a fraction of the LIVE surface, keeping the measured placement and aspect. The
   * minimum size keeps room for the bubble itself (108x50 at the reference size), which does not
   * shrink with the window, and every result is clamped inside the surface.
   */
  const BUBBLE_BOX_REF = { x: 690, y: 215, w: 360, h: 210, cw: 1620, ch: 1031 };
  const BUBBLE_BOX_MIN_W = 260, BUBBLE_BOX_MIN_H = 150;
  function promptBox(cw, ch) {
    const W = Math.max(1, Math.round(cw || BUBBLE_BOX_REF.cw));
    const H = Math.max(1, Math.round(ch || BUBBLE_BOX_REF.ch));
    const sx = W / BUBBLE_BOX_REF.cw, sy = H / BUBBLE_BOX_REF.ch;
    const w = Math.min(W, Math.max(BUBBLE_BOX_MIN_W, Math.round(BUBBLE_BOX_REF.w * sx)));
    const h = Math.min(H, Math.max(BUBBLE_BOX_MIN_H, Math.round(BUBBLE_BOX_REF.h * sy)));
    const x = Math.max(0, Math.min(W - w, Math.round(BUBBLE_BOX_REF.x * sx)));
    const y = Math.max(0, Math.min(H - h, Math.round(BUBBLE_BOX_REF.y * sy)));
    return { x, y, w, h };
  }
  // </prompt-box>
  function bubbleInBox() {
    const box = promptBox(uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
    const r = readUI(box.x, box.y, box.w, box.h);
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
    let s = -1, best = null;
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
  }

  /**
   * Is anything prompt-bright inside the prompt box? Pure CPU on the shared snapshot, no readback.
   * The box scan below costs a ~360x210 GPU readback, and the box is empty for most of a session,
   * so the snapshot says "maybe" first and only then is the full-resolution read spent.
   */
  const BUBBLE_GATE_PX = 10;
  function bubbleGate() {
    const box = promptBox(uiCanvas && uiCanvas.width, uiCanvas && uiCanvas.height);
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
  let sbuf = null, sctx = null, sdata = null, sw = 0, sh = 0;
  let sgl = null, sglCanvas = null, sglTex = null, sglFbo = null, sbytes = null, sglOff = false, sglChecked = false;

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
        sglOff = true; L('downscale readback', { via: '2d', why: 'context lost' }); return null;
      }
      if (sglCanvas.width !== w || sglCanvas.height !== h) {
        sglCanvas.width = w; sglCanvas.height = h;
        sbytes = null;
        if (!sglAttach(w, h)) {
          sglOff = true; L('downscale readback', { via: '2d', why: 'fbo' }); return null;
        }
      }
      const n = w * h * 4;
      if (!sbytes || sbytes.length !== n) sbytes = new Uint8Array(n);
      sgl.bindTexture(sgl.TEXTURE_2D, sglTex);
      sgl.texImage2D(sgl.TEXTURE_2D, 0, sgl.RGBA, sgl.RGBA, sgl.UNSIGNED_BYTE, sbuf);
      sgl.bindFramebuffer(sgl.FRAMEBUFFER, sglFbo);
      sgl.readPixels(0, 0, w, h, sgl.RGBA, sgl.UNSIGNED_BYTE, sbytes);
      if (sgl.getError() !== sgl.NO_ERROR) return null;
      if (!sglChecked) {
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

  // <scan-core>
  const near4 = new Int32Array(4);

  /**
   * 4-connected components over an RGBA buffer: bbox and pixel count per blob.
   *
   * Pure on purpose (buffer + scratch in, components out) so the flood fill can be tested on a
   * hand-built image. `seen` is supplied because the caller reuses one scratch buffer: this runs
   * on every shared scan tick, and a fresh 108 KB Uint8Array per call is pure garbage pressure.
   */
  function floodComponents(w, h, d, match, minPx, seen) {
    const total = w * h;
    seen.fill(0);
    const out = [];
    for (let p0 = 0; p0 < total; p0++) {
      if (seen[p0] || !match(d, p0 * 4)) continue;
      const stack = [p0];
      seen[p0] = 1;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0;
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0;
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        near4[0] = x > 0 ? p - 1 : -1;
        near4[1] = x < w - 1 ? p + 1 : -1;
        near4[2] = y > 0 ? p - w : -1;
        near4[3] = y < h - 1 ? p + w : -1;
        for (let k = 0; k < 4; k++) {
          const q = near4[k];
          if (q < 0 || seen[q] || !match(d, q * 4)) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      if (count >= minPx) out.push({ x0, y0, x1, y1, count });
    }
    return out;
  }
  // </scan-core>

  let seenBuf = null;
  function blobs(match, minPx) {
    const total = sw * sh;
    if (!seenBuf || seenBuf.length !== total) seenBuf = new Uint8Array(total);
    return floodComponents(sw, sh, sdata, match, minPx, seenBuf);
  }
  const CREAM = (c) => c[3] > 60 && c[0] > 225 && c[1] > 200 && c[2] > 130 && c[2] < 238;

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
  // <glyph-core>
  /*
   * Prompt glyphs, read off the buffer bubbleInBox already holds - no second readback.
   * Measured live against real captures (3.9.33 calibration): the prompt's 3-line text is
   * SOFT (translucent grey, alpha 40-120: 17% of the inset, ~0 opaque-dark cells), while a
   * name tag's text is OPAQUE dark (26.5% at alpha>120, lum<100). The old tall-run model was
   * built for opaque caps that do not exist, so the gate is inverted: a boxed blob may tap
   * unless it carries opaque-dark text. The inset ignores the bubble's own outline.
   * Measured margins: prompt 0.002, blank pre-text frames 0.004, tag 0.265 - the 0.05 line
   * stands 10x off both sides. Fail direction is unchanged (a refused prompt still fishes
   * on the Space rung; a tapped tag opens a profile and stalls the run).
   */
  var GLYPH_OPAQUE_MAX = 0.05; // opaque-dark share above this is tag text, never prompt text
  function glyphMetrics(d, w, s, e, y0, y1) {
    var m = { ok: false, dark: 0, soft: 0 };
    var x0 = s + 2, x1 = e - 2, t0 = y0 + 2, t1 = y1 - 2;
    if (x1 <= x0 || t1 <= t0) return m;
    var area = (x1 - x0) * (t1 - t0), dark = 0, soft = 0;
    var stride = (w - (x1 - x0)) * 4;   // consumed inset plus the untouched right margin
    for (var y = t0, i = (t0 * w + x0) * 4; y < t1; y++, i += stride) {
      for (var xx = x0; xx < x1; xx++, i += 4) {
        var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (d[i + 3] > 120 && l < 100) dark++;
        else if (d[i + 3] > 40 && l < 160) soft++;
      }
    }
    m.dark = dark / area;
    m.soft = soft / area;
    m.ok = m.dark <= GLYPH_OPAQUE_MAX;
    return m;
  }
  // </glyph-core>

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
    let hit = 0, n = 0;
    for (let y = 6; y < r.h - 6; y += 8) {
      for (let x = 6; x < r.w - 6; x += 8) {
        n++;
        if (CREAM(PX(r, x + r.x, y + r.y))) hit++;
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
    if (W * H > uiCanvas.width * uiCanvas.height * 0.7) return null;    // the layer itself is opaque, not a card
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

  // <card-text>
  const WEIGHT = /^\d+(?:\.\d+)?\s?(?:kg|g|t|lb)$/i;
  const MONEY = /^\$\s?\d[\d,]*(?:\.\d+)?$/;
  // Species names are not ASCII: the game prints `Moʻo` (U+02BB) and uses `?` in legendary
  // names such as `A Penguin?` and `Mermaid?`. Requiring letters/marks (rather than A-Z) and the
  // punctuation the card actually draws keeps those names from being consumed as the rarity word.
  const WORD = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}'’ʻ&?!.:()\- ]*$/u;

  /** Card strings drawn after `since`, minus the bubbles and the digit-at-a-time date. */
  function textSince(buf, since) {
    const raw = [];
    for (const e of buf) {
      if (!e || e.t <= since) continue;
      const s = String(e.s).trim();
      // Only the exact bubble labels are not card text. Dropping every string containing `!`
      // silently discarded any future species name with punctuation.
      if (!s || /^(cast|reel|bite)!?$/i.test(s)) continue;
      // The date is drawn one digit at a time. Keep a one-letter species word (`A`), but drop
      // bare digits and punctuation fragments.
      if (s.length < 2 && !/^\$/.test(s) && !/^\p{L}$/u.test(s)) continue;
      raw.push(s);
    }
    return raw;
  }

  /**
   * Read one card's strings. Card order is species, [rarity], weight, quality, value, then the
   * catch date drawn digit by digit. Rarity is printed only on non-common fish, so the slot is
   * resolved by position around the weight instead of by a list of tier names.
   *
   * `isKnown(name)` is the catalogue lookup. A long name is drawn in pieces when the card wraps it
   * (`Yellowstripe` + `Goatfish`, `Rocks with` + `Mussels`), so the leading pieces are joined and
   * the longest joined name the catalogue knows wins. Without a lookup the old single-word read is
   * kept, which is what the pure tests use.
   */
  function parseCard(raw, isTier, isKnown) {
    if (!raw.length) return { why: 'empty' };                  // nothing drawn since the cursor: already logged
    const wI = raw.findIndex((s) => WEIGHT.test(s));
    const vI = raw.findIndex((s) => MONEY.test(s));
    if (vI < 0) return { why: 'noprice' };                     // every card prints its price
    const rec = { species: '', rarity: '', quality: '', weight: wI >= 0 ? raw[wI] : '', value: raw[vI], raw };
    const words = [];
    for (let i = 0; i < vI; i++) {
      // A weight or price can also satisfy the broad word pattern; they are values, not names.
      if (WEIGHT.test(raw[i]) || MONEY.test(raw[i])) continue;
      if (WORD.test(raw[i])) words.push([i, raw[i]]);
    }
    if (!words.length) return { why: 'nowords' };
    let used = 1;
    rec.species = words[0][1];
    if (typeof isKnown === 'function') {
      const pre = words.filter(([i]) => wI < 0 || i < wI);
      for (let n = pre.length; n > 1; n--) {
        const name = pre.slice(0, n).map(([, s]) => s).join(' ');
        if (isKnown(name)) { rec.species = name; used = n; break; }
      }
    }
    // The slot before the weight holds the rarity on a non-common fish and the quality on a common
    // one: 'Whale Shark | Epic | 26.6t | Impressive' versus 'Lobster | Impressive | 3.36kg'. The
    // tier list is the only thing that separates them, so the caller supplies it; without one the
    // word is treated as quality, which is what the common layout needs.
    const tier = typeof isTier === 'function' ? isTier : () => false;
    for (let k = used; k < words.length; k++) {
      const [i, s] = words[k];
      if (wI >= 0 && i > wI) { if (!rec.quality) rec.quality = s; }
      else if (tier(s)) { if (!rec.rarity) rec.rarity = s; }
      else if (!rec.quality) rec.quality = s;
    }
    return { why: 'ok', rec };
  }
  // </card-text>

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
  F.recordCatch = function (card) {
    const rec = F.parseCatch();
    if (!rec) return 'pending';
    F.txtAt = now();
    const info = describeCatch(rec);
    // The card prints a rarity word only for non-common fish. Fill the blank from the catalogue
    // and carry the source, never a pixel guess.
    if (!rec.rarity) rec.rarity = info.rarity;
    const row = Object.assign({ t: Date.now(), frac: card && card.frac }, rec);
    row.rarity = info.rarity;
    row.raritySource = info.derived ? 'catalogue' : 'card';
    row.shiny = info.shiny;
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
  let rimMaskBuf = null;
  function rimMask(r) {
    const d = r.d, n = r.w * r.h;
    if (!rimMaskBuf || rimMaskBuf.length < n) rimMaskBuf = new Uint8Array(n);
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
  let scanDial = coarseScan, scanCompiled = null, scanCompileError = null;
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
    const b = [];
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
      b.push(v);
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
      tracked, runs: runs.length, pat: b.join(''), greenN, R: geo.R,
    };
  };

  /* ------------------------------------------------------- pressing ----- */
  /** Drop a pending scheduled press (dial gone, pause, stop, re-plan). */
  function cancelPend() {
    if (F.pend) { clearTimeout(F.pend.id); F.pend = null; }
  }

  /**
   * Arm a timer so the press lands BETWEEN animation frames, aimed at the computed crossing.
   * The frame loop re-evaluates every 16 ms and cancels/re-aims this, so a wrong prediction
   * never survives more than one frame.
   */
  function armPress(at, geo, s) {
    cancelPend();
    const delay = Math.max(0, at - now());
    const id = setTimeout(() => {
      if (!F.pend || F.pend.id !== id) return;
      F.pend = null;
      if (!F.running || F.paused || F.geo !== geo) return;
      doPress(s, 'timer');
    }, delay);
    F.pend = { id, at, geo };
  }

  /**
   * One press's verdict, counted once. `accepted` means the game spawned a new triangle, which is
   * the only observable a good press leaves before the fish is landed. The sweep is keyed by the
   * probe offset, so it now measures presses rather than dial closures.
   */
  function recordPressVerdict(verdict, biasMs, source) {
    if (verdict !== 'accepted' && verdict !== 'rejected') return;
    if (F.pressWait) F.pressWait.verdict = verdict;
    // The counters below are kept for compatibility; the split is what can honestly be quoted.
    const src = source === 'observed' || source === 'timing' ? source : 'assumed';
    if (!F.stats.pressVerdicts) {
      F.stats.pressVerdicts = {
        observed: { accepted: 0, rejected: 0 },
        assumed: { accepted: 0, rejected: 0 },
        timing: { accepted: 0, rejected: 0 },
      };
    }
    F.stats.pressVerdicts[src][verdict]++;
    F.stats[verdict === 'accepted' ? 'pressAccepted' : 'pressRejected']++;
    // The game spawning a new triangle is the proof newTriangle() tries to read from geometry;
    // when an accepted press cannot be seen that way on a narrow dial, this timestamp is what
    // lets the next rotation be pressed instead of skipped.
    if (verdict === 'accepted') F.acceptedAt = now();
    // Per fish, so a narrow dial has a denominator. `accepted` is the game spawning a fresh
    // triangle, i.e. the press landed inside the wedge; an unresolved press is neither.
    if (F.attempt) {
      if (verdict === 'accepted') F.attempt.pressAccepted = (F.attempt.pressAccepted || 0) + 1;
      else F.attempt.pressRejected = (F.attempt.pressRejected || 0) + 1;
    }
    const key = biasMs == null ? 0 : biasMs;
    const cell = F.sweep[key] || (F.sweep[key] = { biasMs: key, presses: 0, accepted: 0, rejected: 0 });
    cell.presses++;
    cell[verdict]++;
  }

  /** Resolve the pending press from the sample stream: no new triangle inside the grace = rejected. */
  function settlePress(s, blinks) {
    const w = F.pressWait;
    if (!w || w.verdict) return;
    const out = pressOutcome({ press: w.press, s, blinks, opts: F.opts });
    if (out.verdict !== 'accepted' && out.verdict !== 'rejected') return;
    recordPressVerdict(out.verdict, w.biasMs, 'observed');
    L('press verdict', { verdict: out.verdict, biasMs: w.biasMs, width: Math.round((w.press && w.press.width) || 0) });
    if (F.pressProbe && !F.pressProbe.via) {
      F.pressProbe.via = 'settled';
      F.pressProbe.verdict = out.verdict;
      pushPressProbe(F.pressProbe);
      F.pressProbe = null;
    }
  }

  /** Start a press probe and retire the previous one the way doPress always assumed it. */
  function probePressStart(s) {
    const prev = F.pressProbe;
    if (prev && !prev.via) {
      prev.via = 'assumed';
      prev.verdict = 'accepted';
      pushPressProbe(prev);
    }
    const p = F.planNow || {};
    F.pressProbe = {
      at: now(),
      lead: F.opts.leadMs != null ? F.opts.leadMs : 25,
      width: s && s.width != null ? Math.round(s.width) : null,
      om: s && s.omega != null ? Math.round(s.omega) : null,
      delta: s && s.delta != null ? +Number(s.delta).toFixed(1) : null,
      pred: p.pred != null ? +Number(p.pred).toFixed(1) : null,
      win: p.win != null ? +Number(p.win).toFixed(1) : null,
      inside: (p.win != null && s && s.delta != null) ? Math.abs(Number(s.delta)) <= p.win : null,
      via: null, verdict: null,
      attempt: F.attempt ? F.attempt.n : null,
      dial: F.pressesThisDial,
    };
  }

  function pushPressProbe(rec) {
    F.pressLog.push(rec);
    while (F.pressLog.length > 300) F.pressLog.shift();
  }

  function doPress(s, how) {
    if (!F.opts.press || !F.geo) return;
    probePressStart(s);
    const via = F.opts.pressWith === 'space' ? 'space' : 'pointer';
    if (via === 'space') space(F.opts.spaceTarget);
    else tap(F.geo.cx, F.geo.cy);
    F.armed = false;
    // The game answers a press by spawning a fresh triangle in the same widget, so the wedge
    // jumps. Drop the rotation history: a fit that straddles the jump would invent a wild rate.
    if (F.geo && F.geo._hist) F.geo._hist.length = 0;
    F.pressStamp = s ? { delta: s.delta, width: s.width, t: s.t != null ? s.t : now() } : null;
    F.dialBlinks = 0;
    // A second press is only possible after the re-arm gate saw a spawn, so an unresolved press
    // here was accepted by the game even though no frame managed to settle it.
    if (F.pressWait && !F.pressWait.verdict) recordPressVerdict('accepted', F.pressWait.biasMs, 'assumed');
    F.lastPress = now();
    F.pressWait = { press: F.pressStamp, at: F.lastPress, biasMs: (s && s.biasMs) || 0, verdict: null };
    F.stats.presses++; F.pressesThisDial++;
    if (F.attempt) {
      F.attempt.presses++;
      F.attempt.touched = F.lastPress;
      F.attempt.pendingLoss = null;
      const om = Math.abs((s && s.omega) || 0);
      if (om > F.attempt.maxOmega) F.attempt.maxOmega = om;
    }
    F.dialLastPress = { t: F.lastPress, via, biasMs: (s && s.biasMs) || 0, omega: s && s.omega };
    const pend = F.pend;
    cancelPend();
    L('PRESS', {
      how, via,
      delta: s ? Math.round(s.delta) : null,
      pred: s ? +s.pred.toFixed(1) : null,
      mid: s ? Math.round(s.mid) : null,
      width: s ? Math.round(s.width) : null,
      omega: s && s.omega != null ? Math.round(s.omega) : null,
      fitRms: s && s.fit ? +s.fit.rms.toFixed(1) : null,
      fitN: s && s.fit ? s.fit.n : null,
      fitSpan: s && s.fit ? Math.round(s.fit.span) : null,
      lockMs: F.geoAt ? Math.round(F.lastPress - F.geoAt) : null,
      biasMs: (s && s.biasMs) || 0,
      dialPressN: F.pressesThisDial,
      gate: F.pressesThisDial === 1 ? 'first' : 'new-triangle',
      late: pend ? Math.round(now() - pend.at) : null,
    });
  }

  /**
   * End of a dial. A press the game acts on ends the dial within ~1.5 s; a press that misses
   * leaves it spinning to its ~15.9 s timeout, and an unpressed dial just times out. That is
   * the only hit/miss signal available, so it is what the counters and the sweep score.
   */
  function closeDial(t, ring) {
    const presses = F.pressesThisDial;
    const heldMs = Math.round(t - (F.geoAt || t));
    // A zero-press dial has no current press; the previous dial's stamp is not evidence for it.
    const last = presses > 0 ? F.dialLastPress : null;
    const sincePress = last ? Math.round(t - last.t) : null;
    const width = Math.round((F.geo && F.geo.width) || 0);
    const widths = (F.geoTrace || [])
      .map((r) => Number(r.w))
      .filter((w) => isFinite(w) && w > 0);
    const widthShrink = widths.length > 1 ? Math.max(...widths) - Math.min(...widths) : 0;
    const hitMs = F.opts.hitMs || 1500;
    // The dial is gone. A press still unresolved either ended the fish (accepted) or did nothing;
    // the dial's own verdict below is about the DIAL, not about how accurate the press was.
    if (F.pressWait && !F.pressWait.verdict) {
      recordPressVerdict(presses > 0 && sincePress != null && sincePress <= hitMs ? 'accepted' : 'rejected', F.pressWait.biasMs, 'timing');
    }
    F.pressWait = null;
    // A dial the bot never pressed that stayed up long enough to be real is a LOST FISH, not the
    // ring fading after a solved one: those fade in ~100 ms.
    // A locked ring that never rotated is the fade-out of a solved dial or a ripple, not a fish:
    // its wedge sits still (omega 0) and no press is ever due. Count it apart so the loss tally
    // stays honest.
    const ghost = dialGhost({ presses, heldMs, width, widthShrink, travel: F.dialTravel }, F.opts);
    const skipped = !ghost && presses === 0 && heldMs >= (F.opts.skipMs || 300);
    const verdict = ghost ? 'ghost'
      : presses === 0 ? (skipped ? 'skipped' : 'no-press')
      : (sincePress != null && sincePress <= hitMs ? 'hit' : 'miss');
    F.stats.dialsClosed++;
    F.stats[verdict === 'hit' ? 'hits' : verdict === 'miss' ? 'misses' : verdict === 'ghost' ? 'ghosts' : verdict === 'skipped' ? 'skipped' : 'noPress']++;
    if (ghost && F.geo) {
      F.ghostGeo = {
        cx: F.geo.cx, cy: F.geo.cy, R: F.geo.R, width,
        until: t + (F.opts.ghostCooldownMs || 2000),
      };
      F.lastLockAt = 0;                       // the memo must not immediately re-lock it
    }
    if (F.attempt && verdict === 'hit') F.attempt.dialHits = (F.attempt.dialHits || 0) + 1;
    if (F.attempt && verdict === 'miss') F.attempt.dialMisses = (F.attempt.dialMisses || 0) + 1;
    if (skipped && F.attempt) F.attempt.skipped++;
    const rec = {
      heldMs, presses, verdict, sincePress,
      width,
      omega: last && last.omega != null ? Math.round(last.omega) : null,
      biasMs: last ? last.biasMs : null,
      reasons: F.geoReasons || null,
      arm: F.dialArm || null,
      trace: F.geoReasons && !(verdict === 'hit') ? F.geoTrace.slice() : null,
    };
    // Per-dial detail on the attempt: "dial locked, never pressed" was visible only as a total
    // before, and a narrow dial is exactly where that costs a fish.
    if (F.attempt) {
      if (!F.attempt.dialLog) F.attempt.dialLog = [];
      // Only the expensive case: it arrived shut AND the dial died unpressed. Arriving shut is
      // normal after a press now that the gate is opened at every lock (measured 2026-11-02: 174 of
      // 177 dials arrive shut, and almost all of them get pressed).
      if (F.geo && !F.geo._armed0 && presses === 0) F.stats.locksDisarmed = (F.stats.locksDisarmed || 0) + 1;
      F.attempt.dialLog.push({
        w: rec.width, om: rec.omega, p: presses, held: heldMs, armed0: !!(F.geo && F.geo._armed0), v: verdict,
      });
      if (F.attempt.dialLog.length > 12) F.attempt.dialLog.shift();
    }
    F.outcomes.push(rec);
    while (F.outcomes.length > 400) F.outcomes.shift();
    // A press is NOT a fish. The game grows its level bar to 100 over several triangles, so a press
    // that pays out no card immediately is the normal case - scoring it a loss is what turned five
    // healthy presses of one Flounder into five failures. Keep the press only as the record that a
    // following catch stamps with its card delay, and let the fish attempt decide the outcome.
    if (presses > 0) {
      rec.closedAt = t;
      rec.biasMs = last ? last.biasMs : null;
      clearPendingWin();
      F.pendingWin = rec;
    }
    L('dial gone', {
      ring: ring == null ? null : +ring.toFixed(2),
      presses, heldMs, verdict, sincePress, width: rec.width, omega: rec.omega,
    });
  }

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
      maxPressPerDial: 12,          // safety cap on presses per dial lock (one per rotation is normal)
      hitMs: 1500,                  // a press the game acts on ends the dial within this
      skipMs: 300,                  // an unpressed dial that lived this long lost a fish (fades are ~100 ms)
      attemptIdleMs: 25000,         // an attempt with no dial and no press this long is over
      sweep: null,                  // e.g. { min: -60, max: 60, step: 15 } - one probe per press
      ab: null,                     // { arms: [{name:'contain',trigger:'contain'},{name:'angle',trigger:'angle',midDeg:6}] } - one arm per FISH
      bubbleDebounceMs: 900,
      castRungResetMs: 10000,       // the prompt was gone this long: the recovery ladder starts over
      castRetryMs: 5000,            // nothing has happened this long: cast with the game's own keybind
      seatWatchdogMs: 45000,        // no dial, no press, no prompt this long -> the character is not seated
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
      hits: 0, misses: 0, noPress: 0,
      attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0, skipped: 0, ghosts: 0,
      frames: 0, errors: 0, cards: 0, catchSeq: 0,
      shapeHits: 0, castRetries: 0, stalls: 0, pressAccepted: 0, pressRejected: 0, textGaps: 0,
      firstPressHeld: 0, firstPressForced: 0, holdPassesMax: 0, locksDisarmed: 0,
    };
    F.arms = {}; F.dialArm = null; F.armCfg = null; F.attempt = null; F.attempts = [];
    F.bands = {}; F.widths = {}; F.rarities = {};
    F.pressLog = []; F.pressProbe = null; F.predLog = []; F.predProbe = null;
    // Opt-in only. A userscript has no local server, and a hardcoded localhost POST turns every
    // catch into a failed request. The panel passes a URL only when the user turned POST catches on.
    F.geo = null; F.ghostGeo = null; F.catches = []; F.logUrl = (opts && opts.logUrl) ? String(opts.logUrl) : null;
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
    F.txtAt = now(); F.cardWait = null;                           // only text drawn from here on counts
    F.armed = true; F.lastPress = 0; F.lastDialCheck = 0; F.bad = 0;
    F.pressStamp = null; F.dialBlinks = 0; F.pressWait = null; F.dialAnyAt = 0;
    F.pend = null; F.outcomes = []; F.sweep = {}; F.bands = {}; F.dialLastPress = null;
    F.bubbleMiss = 0; F.stallRetry = 0; F.lastSpaceTry = 0; F.lastCastTry = 0; F.needsSeat = false;
    F.bubblePrev = null; F.lastBubbleCause = null; F.lastDialCause = null; F.lastAttemptLoss = null;
    F.dialAnyFail = 0; F.dialAnyAt = 0;                       // recovery backoff starts fresh each run
    F.castHold = false;
    F.geoTrace = []; F.geoReasons = {}; F.planReason = null;
    clearPendingWin();
    F.paused = false; F.lastBubble = null; F.lastBubbleAt = 0; F.lastCardRect = null;
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
   * Forbid cast retries without stopping the loop. A seat pause deliberately keeps the core alive
   * to spot the returning prompt, and this is what stops that core from casting: a retry puts a
   * line in the water, which removes the prompt the hold is waiting for. Measured live 2026-11-02:
   * 69 retries while paused on seat, line out, no prompt, and no way back without a manual reel.
   */
  F.holdCasts = function (on) {
    F.castHold = !!on;
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
      hits: 0, misses: 0, noPress: 0,
      attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0, skipped: 0, ghosts: 0,
      frames: 0, errors: 0, cards: 0, catchSeq: 0,
      shapeHits: 0, castRetries: 0, stalls: 0, pressAccepted: 0, pressRejected: 0, textGaps: 0,
      firstPressHeld: 0, firstPressForced: 0, holdPassesMax: 0, locksDisarmed: 0,
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
      F._postRender = true;
      F._postAt = now();
      return true;
    }
    const orig = proto.render;
    const hook = { owner: F };
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
      if (this && app && (this.canvas === app.renderer.canvas || this === app.renderer)) {
        const owner = hook.owner;
        if (owner && typeof owner._postTick === 'function') owner._postTick();
      }
      return out;
    };
    wrapped.__autofishPostRender = true;
    wrapped.__autofishHook = hook;
    try { proto.render = wrapped; } catch (e) { return false; }
    if (proto.render !== wrapped) return false;   // a frozen prototype must not look installed
    F._postTick = postRenderTick;
    F._postRender = true;
    F._postAt = now();
    L('post-render hook', { canvas: !!(uiCanvas && uiCanvas.width) });
    return true;
  }

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

  function step() {
    const t = now();
    F.lastTickAt = t;                       // the watchdog's only fact: the loop got a frame
    F.stats.frames++;
    if (document.visibilityState !== 'visible') { F.hidden = true; return; }
    if (F.hidden) { F.hidden = false; F.hiddenPauses++; }
    if (F.paused) return;
    if (t - F.startedAt > F.opts.maxMinutes * 60000) { L('maxMinutes'); F.stop(); return; }
    // 0a. an open player profile swallows inputs and hides prompts. Try Escape once in a
    // while; the session pause (profile-open) holds the clock whether or not it lands.
    tryEscapeProfile(t);
    // A fish that has shown no dial and taken no press for a long time is over; the client's own
    // timer is 15-40 s, so this only fires when the flow itself stalled (a missed re-cast).
    if (F.attempt && F.attempt.pendingLoss && t - F.attempt.pendingLoss > (F.opts.lossGraceMs || 2500)) {
      resolveAttempt('lost', t, 'cast prompt');
    }
    if (F.attempt && t - (F.attempt.touched || F.attempt.startedAt) > (F.opts.attemptIdleMs || 25000)) {
      resolveAttempt('lost', t, 'idle');
    }

    // 0. a catch card blocks the next cast until it is tapped away. Its paper appears before its
    // text is drawn, so the card is held open until the catch has been read - tapping on sight
    // dismissed cards that had not printed their species yet, losing the record. Bounded, so a
    // card that never prints text still clears.
    // Only look for a card while a press is still awaiting its catch. The old unconditional scan
    // read cream world art as a card at 1920x1080 and kept the bot in a dismiss/tap loop forever.
    const awaitingCard = !!(F.pendingWin && t - (F.pendingWin.closedAt || t) < 30000);
    if (!F.geo && t - (F.lastCard || 0) > 1500 && awaitingCard) {
      const card = F.findCatch();
      if (card) {
        markShapeHit(t);
        // half-sizes measured on the 1522x954 layout; good enough to keep the panel clear
        F.lastCardRect = card.w && card.h
          ? { x: card.cx - card.w / 2, y: card.cy - card.h / 2, w: card.w, h: card.h }
          : { x: card.cx - 183, y: card.cy - 203, w: 366, h: 406 };
        const r = F.recordCatch(card);
        if (r !== 'logged') {
          if (F.cardWait == null) F.cardWait = t;
          if (t - F.cardWait < 2500) { F.stats.cardWaits = (F.stats.cardWaits || 0) + 1; return; }
          L('catch text missing', { frac: card.frac, why: F.parseWhy });
          // Move the cursor past a card that never parsed, or the NEXT card is read from this
          // card's strings too: the old card's first word becomes the new species and its weight
          // and purse win the lookups. A stale cursor is how one lost card poisons the next record.
          F.txtAt = now();
          F.stats.textGaps = (F.stats.textGaps || 0) + 1;
        }
        tap(card.cx, card.cy);
        F.lastCard = t; F.cardWait = null; F.lastCardRect = null; F.cardUntil = 0;
        F.stats.cards = (F.stats.cards || 0) + 1;
        L('catch card dismissed', { via: card.via, frac: card.frac, log: r });
        return;
      }
    }

    // 0b. A catch card that lands while the next dial is already locked used to be invisible: the
    // branch above needs !F.geo, so the card sat there until the 600 ms win window expired and the
    // press was scored a loss with no catch recorded. Worse, a tap aimed at the dial lands on the
    // paper instead. Look for the card whenever a press is awaiting its verdict, and while it is up
    // hold fire on the dial.
    // Bounded: a lost attempt must not leave a 120 ms card scan running for the whole session.
    if (F.pendingWin && t - (F.pendingWin.closedAt || t) < 30000 && t - (F.cardScan || 0) > 120) {
      F.cardScan = t;
      const c = F.findCatch();
      if (c) {
        markShapeHit(t);
        F.cardUntil = t + 2200;
        F.lastCardRect = c.w && c.h
          ? { x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h }
          : { x: c.cx - 183, y: c.cy - 203, w: 366, h: 406 };
        L('catch card over dial', { frac: c.frac, cx: c.cx, cy: c.cy, dial: !!F.geo });
      }
    }

    // 1. a bubble is always the next thing to press (CAST! or REEL!, same shape)
    const b = F.findBubble();
    if (b) {
      // The ladder counts attempts on the prompt in front of us, not the whole run: a prompt that
      // went away and came back is a new prompt, so it starts again at the first rung.
      if (F.lastBubbleAt && t - F.lastBubbleAt > (F.opts.castRungResetMs || 10000)) F.bubbleMiss = 0;
      F.lastBubble = b; F.lastBubbleAt = t;
      // The cast prompt means the minigame is over, so an attempt still open is a fish that got
      // away. But the prompt is a bubble-shaped sprite and the card of a WIN is read up to ~3 s
      // after the last press, so a loss is only declared once no card can still be on its way.
      if (F.attempt && !F.attempt.pendingLoss) {
        if (t - (F.attempt.presses ? (F.attempt.touched || 0) : 0) > (F.opts.lossGraceMs || 2500)) {
          resolveAttempt('lost', t, 'cast prompt');
        } else {
          F.attempt.pendingLoss = t;
          L('attempt loss pending', { n: F.attempt.n });
        }
      }
      // A blob that never produces a dial is not a button. Every fruitless CAST ATTEMPT walks one
      // rung up the ladder (click -> click plus keybind -> keybind), which is what stops the silent
      // 60 s stall this branch used to cause by returning before the cast retry could ever run. The
      // rung counts attempts, not frames: counting frames ran the ladder to the top in ~1 s and left
      // the bot clicking nothing (measured live 2026-10-28: rung 4567, 36 walks, 0 dials).
      if (t - F.lastPress > F.opts.bubbleDebounceMs) {
        const rung = (F.bubbleMiss = (F.bubbleMiss || 0) + 1);
        F.lastRung = rung;
        F.needsSeat = false;                                  // a prompt is up: the character is seated
        const rec = castRecovery(rung);
        // The dial appears in the widget under the prompt, so the hint follows the prompt we can
        // SEE, not the last one we happened to click: a rung that no longer taps used to freeze the
        // hint where a false bubble had been detected, and lockDial's +/-22 px search then could
        // never reach a dial 100 px away.
        // Boxed prompts steer the dial hint; an `anywhere` blob never moves it, so a
        // nearby player's name tag cannot drag the dial search off the widget.
        var isBox = b.via !== 'anywhere';
        if (isBox) {
          F.hint = { x: b.cx, y: b.cy + 53 };
          F.dialAnyFail = 0; F.dialAnyAt = 0;    // a cast is new evidence: recover promptly again
        }
        // A blob found by the whole-surface scan is only a hint: it can be a player's name tag,
        // and clicking one opens that player's profile. bubbleConfirmed is the single tap
        // gate: it never confirms an `anywhere` blob, and a boxed one only after the same
        // spot repeats. The ladder's Space rung still casts when the hint was all we had.
        var confirmed = bubbleConfirmed(b, t);
        var tapOk = !!(rec.tap && confirmed);
        if (tapOk) tap(b.cx, b.cy);
        if (tapOk) noteBubbleTap(t);
        // The press that summons the dial is decided here; the tail is too short to prove it
        // later, so the last prompt action persists until the next dial lock reads it.
        F.lastBubbleCause = { tap: tapOk, space: !!rec.space, glyph: b.glyph === true, at: t };
        F.lastPress = t;
        F.stats.bubbles++;
        L('bubble', { cx: b.cx, cy: b.cy, n: b.n, hint: F.hint.y, rung, via: b.via || 'box', tap: tapOk, space: rec.space, confirmed: confirmed, glyph: b.glyph === true, gdark: typeof b.gdark === 'number' ? b.gdark : null, gsoft: typeof b.gsoft === 'number' ? b.gsoft : null });
        if (rec.space) {
          F.lastSpaceTry = t;
          space(F.opts.spaceTarget);
        }
      }
      return;
    }

    // 2. a locked dial: play it
    if (F.geo) {
      const s = F.sample(F.geo);
      if (!s || !s.valid || s.ring < 0.7) {
        F.dialBlinks = (F.dialBlinks || 0) + 1;
        if (++F.bad > 3) {
          // A successful press animates the ring away for a few frames, then the next triangle
          // appears in the same widget. Dropping the lock there cost a re-lock scan plus a lock
          // on the fading ring, ~300 ms per press. Hold the geometry briefly instead.
          if (F.pressesThisDial > 0 && t - F.lastPress < (F.opts.relockGraceMs || 450)) return;
          // A narrow unpressed dial with a live spin estimate is blinking, not fading: ride
          // through the blind frames so the planner can take the arrival it was tracking.
          if (F.pressesThisDial === 0 && spinAlive(F.geo, t)) { F.stats.narrowHolds = (F.stats.narrowHolds || 0) + 1; return; }
          cancelPend();
          closeDial(t, s && s.ring);
          F.geo = null; F.bad = 0; F.pressesThisDial = 0;
        }
        return;
      }
      F.bad = 0;
      // Prediction error, measured without pressing. A press between the two frames invalidates the
      // sample: the game spawns a new triangle and the angle jumps for a reason that is not model
      // error - which is exactly what the first version of this measured and misreported.
      const pp = F.predProbe;
      if (pp && s.t != null && s.delta != null) {
        const dt = s.t - pp.t;
        if (dt >= 2 && dt <= 40 && !(F.lastPress && F.lastPress > pp.t)) {
          const predicted = wrap180(pp.delta + (pp.omega || 0) * dt / 1000);
          const err = wrap180(Number(s.delta) - predicted);
          F.predLog.push({ err: +err.toFixed(1), om: pp.omega != null ? Math.round(pp.omega) : null, w: Math.round(Number(s.width) || 0), dt: Math.round(dt) });
          while (F.predLog.length > 400) F.predLog.shift();
        }
      }
      F.predProbe = { t: s.t, delta: s.delta, omega: s.omega };
      settlePress(s, F.dialBlinks);
      // Arc travel since the lock, in degrees: one turn is one pass of the pin under the wedge.
      if (s.mid != null) {
        if (F.geo._pm != null) {
          const dm = Math.abs(wrap180(Number(s.mid) - F.geo._pm));
          if (dm < 180) F.geo._travel = (F.geo._travel || 0) + dm;
        }
        F.geo._pm = Number(s.mid);
      }
      s.biasMs = F.opts.biasMs || sweepBias(F.opts.sweep, F.stats.presses);
      if (F.geoReasons) F.geoReasons[F.planReason || 'none'] = (F.geoReasons[F.planReason || 'none'] || 0) + 1;
      const plan = planPress({
        t: s.t != null ? s.t : t,
        delta: s.delta, width: s.width, omega: s.omega,
        armed: F.armed && s.tracked && t - F.lastPress > (F.opts.pressGapMs || 120),
        pendingAt: F.pend ? F.pend.at : null,
      }, {
        trigger: (F.armCfg && F.armCfg.trigger) || F.opts.trigger,
        midDeg: F.armCfg && F.armCfg.midDeg != null ? F.armCfg.midDeg : F.opts.midDeg,
        marginDeg: F.opts.marginDeg,
        leadMs: F.opts.leadMs,
        biasMs: s.biasMs,
        horizonMs: F.opts.schedHorizonMs,
        replanMs: F.opts.replanMs,
      });
      F.planReason = plan.reason;
      F.planNow = { pred: plan.pred, win: plan.win };   // what the press probe compares against
      if (s.omega != null && Math.abs(s.omega) > (F.dialMaxOmega || 0)) F.dialMaxOmega = Math.abs(s.omega);
      // Total travel of the wedge since the lock: a real dial sweeps degrees every frame, a
      // fading one sits still while the rate estimate decays to zero.
      if (s.delta != null) {
        if (F.dialPrevDelta != null) F.dialTravel = (F.dialTravel || 0) + Math.abs(wrap180(Number(s.delta) - F.dialPrevDelta));
        F.dialPrevDelta = Number(s.delta);
      }
      if (F.cardUntil && t < F.cardUntil) { cancelPend(); return; }   // paper is on top of the dial
      if (s.tracked) {
        F.geoTrace.push({ t: Math.round(t - F.geoAt), d: +Number(s.delta).toFixed(1), w: Math.round(s.width || 0),
          om: s.omega == null ? null : Math.round(s.omega), r: plan.reason });
        if (F.geoTrace.length > 48) F.geoTrace.shift();
      } else {
        F.dialBlinks = (F.dialBlinks || 0) + 1;   // a blink after a press is how a new spawn shows
      }
      // A first press on a narrow or fast dial is the one with the least evidence behind it. The
      // fit becomes reliable after a few frames; until then, skip the crossing and take the next
      // one. One skipped revolution is cheap next to a miss, which subtracts the last gain and
      // zeroes the streak. Wide/slow dials keep pressing immediately - their window forgives it.
      if (F.pressesThisDial === 0 &&
          (Number(s.width) < (F.opts.firstPressMaxWidthDeg || 60) ||
           Math.abs(Number(s.omega) || 0) >= (F.opts.firstPressFastOmega || 300))) {
        const heldMs = t - (F.geoAt || t);
        const stable = fitStable(s.fit, F.opts);
        // How long the hold has lasted against one pass of the arc. Above 1 it skipped whole
        // rotations - the 3.9.9 "it did a round turn" report. 3.9.12 cannot exceed 0.4 by
        // construction, so this number is also the regression witness doctor() reads.
        // Full turns of the arc waited through so far. This is the user-visible quantity - the
        // owner reported "it does a round turn or more" - and unlike a ratio against the
        // instantaneous width/omega it does not swing when the spin estimate spikes. 3.9.12 cannot
        // pass 1 by construction; 3.9.9's fixed 2500 ms ceiling passed 2 or more on a fast dial.
        const passes = (F.geo && F.geo._travel ? F.geo._travel : 0) / 360;
        if (!(F.stats.holdPassesMax >= passes)) F.stats.holdPassesMax = passes;
        // Hold for a fraction of ONE pass, not for a fixed ceiling that is four rotations on a
        // fast dial (see firstPressBudget). A high-tier fish is exactly the narrow/fast case.
        const budget = firstPressBudget(Number(s.width) || 0, s.omega, F.opts);
        const giveUp = heldMs >= budget;
        if (!stable && !giveUp) {
          if (!F.geo._firstHeld) {
            F.geo._firstHeld = true;
            F.stats.firstPressHeld = (F.stats.firstPressHeld || 0) + 1;
            L('first press held', {
              width: Math.round(Number(s.width) || 0),
              omega: s.omega == null ? null : Math.round(s.omega),
              fitN: s.fit ? s.fit.n : 0,
              fitSpan: s.fit ? Math.round(s.fit.span) : 0,
              fitRms: s.fit ? +s.fit.rms.toFixed(1) : null,
            });
          }
          F.planReason = 'first-fit';
          cancelPend();
          return;
        }
        if (!stable && giveUp && !F.geo._firstForced) {
          F.geo._firstForced = true;
          F.stats.firstPressForced = (F.stats.firstPressForced || 0) + 1;
          L('first press forced', {
            heldMs: Math.round(heldMs),
            budget: Math.round(budget),
            width: Math.round(Number(s.width) || 0),
            omega: s.omega == null ? null : Math.round(s.omega),
            fitN: s.fit ? s.fit.n : 0,
            fitRms: s.fit ? +s.fit.rms.toFixed(1) : null,
          });
        }
      }
      // Re-arm once the wedge has left the window: one rotation gets one press, and a new
      // triangle on the same dial is pressed on its next rotation. The earlier 'one press per
      // dial' rule assumed a press solved the fish; it does not - a fish is many triangles, so
      // that rule forced a full dial close plus re-lock for every single press and starved slow
      // dials. The cap only guards against a runaway if the game stops accepting input.
      // Re-arm for the next rotation. newTriangle() reads geometry (a blink, a width jump, a jump
      // against the prediction); an accepted press is stronger evidence than any of them and it is
      // already recorded, so a narrow dial is not skipped just because its new triangle looks like
      // the old one.
      const spawnProven = newTriangle(F.pressStamp, s, F.dialBlinks, F.opts) ||
        (F.acceptedAt != null && t - F.acceptedAt <= (F.opts.rearmAcceptedMs || 600));
      if (F.pressesThisDial < (F.opts.maxPressPerDial || 12) &&
          Math.abs(plan.delta) > plan.win + 12 &&
          spawnProven) F.armed = true;
      if (plan.cancel) cancelPend();
      if (plan.armAt != null) armPress(plan.armAt, F.geo, s);
      if (plan.press) doPress(s, 'frame');
      return;
    }

    // 3. nothing on screen: look for a dial now and then (cheap enough at ~4 Hz)
    if (t - F.lastDialCheck > F.opts.dialCheckMs) {
      F.lastDialCheck = t;
      let g = F.lockDial(F.hint.x, F.hint.y);
      // Nothing has locked for a while: the hint may be wrong rather than empty. One whole-surface
      // pass (throttled inside dialAnywhere) is the only thing that can recover a blind run.
      if (!g && F.opts.dialFallbackMs && t - Math.max(F.geoAt || 0, F.startedAt) > F.opts.dialFallbackMs) {
        g = dialAnywhere();
      }
      if (g) {
        F.geo = g; F.geoAt = t; F.bad = 0; F.pressesThisDial = 0; F.pressStamp = null; F.dialBlinks = 0;
        g._travel = 0; g._pm = null;
        // A new spawn IS a new triangle, so the press gate must be open on arrival. It used to be
        // left closed from the previous dial, and on a narrow dial the re-arm test (pin more than
        // win+12 away) may never come true - measured live 2026-11-02: a lost narrow attempt locked
        // seven dials and pressed three times, with nothing rejected.
        g._armed0 = !!F.armed;
        F.armed = true;                            // arc travel for this lock
        F.geoReasons = {}; F.planReason = null; F.geoTrace = []; F.dialMaxOmega = 0; F.dialTravel = 0; F.dialPrevDelta = null;
        // Which rung summoned this dial: the last prompt action before the lock. Stale (> one
        // cast cycle old) means the dial arrived without a prompt press we saw - say so.
        var bc = F.lastBubbleCause, freshBc = bc && (t - bc.at) < (F.opts.castRungResetMs || 10000);
        F.lastDialCause = { tap: !!(freshBc && bc.tap), space: !!(freshBc && bc.space), unknown: !freshBc, at: freshBc ? bc.at : 0, dialAt: t };
        var dcCause = F.lastDialCause.unknown ? 'unknown' : (F.lastDialCause.tap && F.lastDialCause.space ? 'tap+space' : (F.lastDialCause.tap ? 'tap' : (F.lastDialCause.space ? 'space' : 'none')));
        F.bubbleMiss = 0; F.stallRetry = 0;                     // the ladder worked: back to the first rung
        F.bubblePrev = null;                                    // a dial proves the prompt was real: forget tap suspicion
        F.dialAnyFail = 0;                                      // the hint is good: recovery starts prompt
        F.stats.dials++;
        // One arm per FISH, not per dial. A fish is 5-7 dials of the same minigame, so alternating
        // dialect by dial would put both arms inside one attempt and the A/B would compare nothing.
        if (!F.attempt) startAttempt(t);
        F.attempt.dials++;
        F.attempt.touched = t;
        F.attempt.pendingLoss = null;
        F.needsSeat = false;                                    // a dial means the cast took
        L('dial locked', { cx: g.cx, cy: g.cy, R: g.R, width: Math.round(g.width), arm: F.dialArm, attempt: F.attempt.n, rung: F.lastRung || 0, cause: dcCause });
        const dialW = Number(g.width) || 0;
        if (dialW > 0) {
          F.attempt.widthSum += dialW;
          F.attempt.widthN += 1;
          F.attempt.maxWidth = Math.max(F.attempt.maxWidth || 0, dialW);
          F.attempt.minWidth = F.attempt.minWidth ? Math.min(F.attempt.minWidth, dialW) : dialW;
        }
        F.lastRung = 0;                                         // logged above: which rung did the casting
        if (!sameDial(F.lastGeo, g)) saveDialMemory(g);       // survives the next reload
        F.lastGeo = { cx: g.cx, cy: g.cy, R: g.R };              // the widget position for the next dial
      }
    }

    // 4. Cast recovery. The cast control is a small bubble, and the caught-indicator is the same
    // shape, so the shape detector sometimes taps an indicator that is not a button - after which
    // nothing at all happens and the run silently stops fishing (observed: 60+ s of no dial and no
    // press while frames kept advancing). The game's own fishing keybind casts whenever its cast
    // button is visible and is ignored while chat has focus, so it is a safe fallback.
    // ... but never while the session holds the core for a seat. The retry would cast, the prompt
    // would vanish, and only the prompt can lift the hold - a deadlock. `lastCastTry` is refreshed
    // when the hold clears, so the retry cannot fire on the first frame after a Resume.
    if (!F.castHold && F.opts.castRetryMs && t - Math.max(F.lastPress || 0, F.geoAt || 0, F.lastBubbleAt || 0, F.lastCastTry || 0, F.startedAt) > F.opts.castRetryMs) {
      F.lastCastTry = t;
      F.stats.castRetries = (F.stats.castRetries || 0) + 1;
      const tries = (F.stallRetry = (F.stallRetry || 0) + 1);
      // There is no bubble here to click, so the keybind is the only honest input: the recovery
      // ladder governs the bubble branch, where the prompt's coordinates exist. Calling it here
      // and dropping the answer only made the ladder look wired to a path that ignored it.
      const consumed = !space(F.opts.spaceTarget);
      L('cast retry', { consumed, tries });
    }

    // The game shows a cast prompt only while the character is SEATED on a seat whose raycast
    // reaches water (bundle: sit -> isRaycastHittingWater(seat.fishingReach ?? 50) -> showCastButton)
    // or right after a fish result. A standing character therefore has no prompt and nothing the bot
    // can synthesise sits it down, so say what is wrong instead of clicking forever - the old
    // 60 s silent stall is exactly this state.
    const seatWatch = F.opts.seatWatchdogMs;
    if (seatWatch && !F.geo && !F.needsSeat) {
      const idle = t - Math.max(F.lastPress || 0, F.lastBubbleAt || 0, F.geoAt || 0, F.startedAt);
      if (idle > seatWatch) {
        F.needsSeat = true;
        L('needs a seat', { idleMs: Math.round(idle), why: 'no cast prompt: sit on a waterside chair' });
      }
    }
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
      species: a.species || null, rarity: a.rarity || null,
    });
    // A lost fish must stay attributable after the 8-entry tail expires: the reason, the
    // attempt number, and the dial score persist on status until the next loss (or start).
    if (verdict === 'lost') F.lastAttemptLoss = { n: a.n, why: a.why, ms: a.ms, dials: a.dials, presses: a.presses, dialHits: a.dialHits, dialMisses: a.dialMisses, avgWidth: a.avgWidth, at: t };
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
      catchCount: s.catchSeq || 0,
      hidden: !!F.hidden,
      geo: F.geo ? { cx: F.geo.cx, cy: F.geo.cy, R: F.geo.R, width: F.geo.width && Math.round(F.geo.width) } : null,
      hint: F.hint,
      pxScale: frame && frame.cw ? +(frame.w / frame.cw).toFixed(3) : null,
      needsSeat: !!F.needsSeat,
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
        firstPressMaxRms: opts.firstPressMaxRms, firstPressMaxWaitMs: opts.firstPressMaxWaitMs,
        insideNowMs: opts.insideNowMs,
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

  /** Apply numeric timing knobs to the live run. Returns the same report as calibration(). */
  F.tune = function (patch) {
    if (!patch || typeof patch !== 'object') return F.calibration();
    if (!F.opts) F.opts = {};
    ['leadMs', 'marginDeg', 'midDeg', 'biasMs', 'pressGapMs', 'schedHorizonMs',
      'firstPressMinN', 'firstPressMinSpanMs', 'firstPressMaxRms', 'firstPressMaxWaitMs',
      'firstPressMaxWidthDeg', 'firstPressFastOmega', 'insideNowMs'].forEach((k) => {
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
  F.log = function () {
    return logSummary(loadLedger(), Date.now());
  };
  /** Which catch history the panel reads and writes. No argument reads it. */
  F.logProfile = function (name) {
    if (name === undefined) return logProfile;
    const next = String(name || '').trim().replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 24) || 'default';
    if (next !== logProfile) {
      logProfile = next;
      ledger = null;              // the cache belongs to the old profile
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
      n: a.n, v: a.verdict || null, why: a.why || null, ms: a.ms || 0,
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
      presses: pressAcceptSummary(F.pressLog),
      prediction: predictionSummary(F.predLog),
      pressLog: (F.pressLog || []).slice(-60),
      run: runSummary(asAttempts, { cut: F.cutReason || null, locksDisarmed: (F.stats && F.stats.locksDisarmed) || 0 }),
      perf: {
        fps: p.fps, p50: p.p50, p95: p.p95, worst: p.worst,
        longtasks: p.longtasks, snapshot: p.snapshot, readback: p.readback, rates: p.rates,
      },
      doctor: F.doctor ? F.doctor() : null,
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
