// @ts-check
/* src/timing.js — pure dial spin regression, press planning, ghost/stall gates, and recovery math.
 * UMD: browser global AutoFishTiming, CommonJS require('./src/timing.js').
 */
/**
 * @param {any} root
 * @param {() => Record<string, any>} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishTiming = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Fold an angle into (-180, 180].
   * @param {number} a
   */
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
   * @param {Array<{ t: number, mid: number } | null | undefined> | null | undefined} pts
   * @param {Record<string, any>} [opts]
   */
  function fitOmega(pts, opts) {
    const o = opts || {};
    const maxAge = o.maxAgeMs != null ? o.maxAgeMs : 200;
    const minN = o.minN != null ? o.minN : 2;
    const minSpan = o.minSpanMs != null ? o.minSpanMs : 8;
    const limit = o.limit != null ? o.limit : 1500;
    if (!pts || pts.length < minN) return null;
    const last = pts[pts.length - 1];
    if (!last) return null;
    const nowMs = o.now != null ? o.now : last.t;
    /** @type {Array<{ t: number, mid: number }>} */
    const live = [];
    for (const p of pts) {
      if (p && isFinite(p.mid) && isFinite(p.t) && nowMs - p.t <= maxAge) live.push(p);
    }
    if (live.length < minN) return null;
    if (live[live.length - 1].t - live[0].t < minSpan) return null;

    /** @param {Array<{ t: number, m: number }>} rows */
    const slope = (rows) => {
      let st = 0, sm = 0;
      for (const r of rows) { st += r.t; sm += r.m; }
      const mt = st / rows.length, mm = sm / rows.length;
      let num = 0, den = 0;
      for (const r of rows) { const d = r.t - mt; num += d * (r.m - mm); den += d * d; }
      return den > 0 ? (num / den) * 1000 : null;      // deg per ms -> deg per s
    };
    /** @param {Array<{ t: number, mid: number }>} rows */
    const unroll = (rows) => {
      const out = [{ t: rows[0].t, m: rows[0].mid }];
      for (let i = 1; i < rows.length; i++) {
        out.push({ t: rows[i].t, m: out[i - 1].m + wrap180(rows[i].mid - rows[i - 1].mid) });
      }
      return out;
    };
    /**
     * @param {Array<{ t: number, m: number }>} rows
     * @param {number} omega
     */
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
   * @param {{ omega?: number | null, clamped?: boolean, rms?: number | null, n?: number, span?: number } | null | undefined} fit
   * @param {Record<string, any>} [o]
   */
  function fitStable(fit, o) {
    const cfg = o || {};
    if (!fit || fit.omega == null || !isFinite(fit.omega)) return false;
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
   * @param {number | null | undefined} midOmega
   */
  function deltaOmega(midOmega) {
    if (midOmega == null || !isFinite(midOmega)) return null;
    return midOmega === 0 ? 0 : -midOmega;
  }

  /**
   * Does the first press on this dial need the stable-fit hold?
   *
   * The default is deliberately conservative: a narrow or fast dial has the least evidence at
   * lock time and the most to lose from a noisy fit. `fastFirstPress` is the opt-in escape hatch
   * for a player who would rather tap the first pass: it bypasses the hold without changing the
   * crossing planner or any later press. That trade is explicit and off by default.
   * @param {number | null | undefined} width
   * @param {number | null | undefined} omega
   * @param {Record<string, any>} [o]
   */
  function firstPressGate(width, omega, o) {
    const cfg = o || {};
    if (cfg.fastFirstPress) return false;
    return Number(width) < (cfg.firstPressMaxWidthDeg || 60) ||
      Math.abs(Number(omega) || 0) >= (cfg.firstPressFastOmega || 300);
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
   * @param {number | null | undefined} width
   * @param {number | null | undefined} omega
   * @param {Record<string, any>} [o]
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
   * Can the first-press hold possibly mature before its budget runs out?
   *
   * The gate only clears once the fit has firstPressMinSpanMs (150 ms) of history. A budget
   * shorter than that can never reach it: the hold would expire and press on the same two-point
   * fit it had at the lock, having only delayed the press. Measured live 2026-11-18: 37 dials
   * held and 37 forced - every hold was wasted - so a budget that cannot fit the fit is skipped.
   * @param {number} budgetMs
   * @param {Record<string, any>} [o]
   */
  function firstPressCanMature(budgetMs, o) {
    const need = o && o.firstPressMinSpanMs != null ? o.firstPressMinSpanMs : 150;
    return budgetMs >= need;
  }

  /**
   * Record the dial's single force event. `firstPressForced` counts all forced first presses;
   * `firstPressHeldForced` is the subset the first-press gate had held first. A held dial that
   * matures never reaches this marker and stays counted by `firstPressHeld` alone.
   * @param {Record<string, any> | null | undefined} stats
   * @param {Record<string, any> | null | undefined} geo
   */
  function markFirstPressForced(stats, geo) {
    if (!stats || !geo || geo._firstForced) return false;
    geo._firstForced = true;
    stats.firstPressForced = (stats.firstPressForced || 0) + 1;
    if (geo._firstHeld) stats.firstPressHeldForced = (stats.firstPressHeldForced || 0) + 1;
    return true;
  }

  /**
   * Read-only snapshot of a cast-prompt loss. Deliberately does not call bubbleConfirmed():
   * that helper updates F.bubblePrev, and logging must not change what the next tap sees.
   * `promptChannel` is the detector channel (box/anywhere), not the CAST!/REEL! text.
   * @param {Record<string, any> | null | undefined} b
   * @param {number} t
   * @param {Record<string, any> | null | undefined} [prev]
   * @param {boolean} [cardPending]
   */
  function lossDiagnostics(b, t, prev, cardPending) {
    if (!b) return { promptChannel: null, glyph: null, confirmed: false, x: null, y: null, w: null, h: null, catchCardPending: !!cardPending };
    const p = prev || null;
    // Same 12 px / 2 s window as bubbleConfirmed().
    const same = !!p && Math.abs(p.x - b.cx) <= 12 && Math.abs(p.y - b.cy) <= 12 && (t - p.at) <= 2000;
    const confirmed = b.via !== "anywhere" && b.glyph !== false && same &&
      !(p.blockedUntil && t < p.blockedUntil) && (p.n || 0) + 1 >= 2;
    return {
      promptChannel: b.via === "anywhere" ? "anywhere" : "box",
      glyph: b.glyph === true,
      confirmed: !!confirmed,
      x: b.cx != null ? b.cx : null,
      y: b.cy != null ? b.cy : null,
      w: b.w != null ? b.w : null,
      h: b.h != null ? b.h : null,
      catchCardPending: !!cardPending,
    };
  }

  /**
   * How long to wait before the next whole-surface dial recovery pass, in ms.
   *
   * Measured live 2026-11-02 (3.9.10): one recovery pass is a ~257k-test annulus sweep costing
   * 250-300 ms, and it ran every 900 ms whenever nothing was locked - i.e. every second while the
   * character simply waited for a bite. Pausing the core made the stalls disappear entirely
   * (143.8 fps, 0 long tasks), which is how it was attributed. A wrong hint is a per-CAST problem,
   * not a per-second one: the cadence doubles after each fruitless pass and a cast resets it.
   * @param {number} fail
   * @param {Record<string, any>} [o]
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
   * @param {Record<string, any> | null | undefined} st
   * @param {Record<string, any>} [o]
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
   * Is this close a stalled ring rather than a press miss or a fade?
   *
   * A stuck waiting-for-result ring stays up for 10-13 s after a press the game never settled, and
   * closeDial used to score it as a miss (press older than hitMs) or a ghost (no spin measured,
   * travel < 15). Opt-in stallDialMs names that ring instead. Narrow only: a genuinely missed wide
   * dial reaches its 15.9 s timeout in the same shape. 0 (the default) keeps the old verdicts.
   * @param {Record<string, any> | null | undefined} st
   * @param {Record<string, any>} [o]
   */
  function dialStalled(st, o) {
    const s = st || {};
    const cfg = o || {};
    const stallMs = Number(cfg.stallDialMs) || 0;
    if (!(stallMs > 0)) return false;
    const width = Number(s.width) || 0;
    if (!(width > 0 && width < (cfg.ghostMaxWidthDeg || 60))) return false;   // narrow only
    const held = Number(s.heldMs);
    if (!(held >= stallMs)) return false;
    const presses = Number(s.presses) || 0;
    if (presses === 0) return !!s.ghost;          // only a fade-shaped ring can be rescued from 'ghost'
    const since = s.sincePress;
    return since != null && since > (cfg.hitMs || 1500);
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
   * @param {Record<string, any> | null | undefined} geo
   * @param {number} t
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
   * @param {Record<string, any> | null | undefined} g
   * @param {number | null | undefined} width
   * @param {number} at
   * @param {Record<string, any> | null | undefined} ghost
   * @param {Record<string, any>} [o]
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
   * @param {Record<string, any>} st
   * @param {Record<string, any>} [o]
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
    /** @type {{ delta: number, pred: number, win: number, press: boolean, armAt: number | null, at: number | null, cancel: boolean, reason: string }} */
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
    const insideNowMs = cfg.insideNowMs != null ? cfg.insideNowMs : 60;
    if (cfg.trigger !== 'angle' && st.armed && toJudge > insideNowMs &&
        Math.abs(delta) <= win && Math.abs(pred) <= win) {
      out.reason = 'inside-now';
      out.cancel = true;
      out.press = true;
      return out;
    }
    if (wait <= 0) {
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

  /**
   * Next probe offset (ms) from a bias-sweep config; 0 when the sweep is off.
   * @param {Record<string, any> | null | undefined} cfg
   * @param {number} i
   */
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

  /**
   * Detect whether a newly measured wedge indicates a freshly spawned triangle after a press.
   * @param {Record<string, any> | null | undefined} press
   * @param {Record<string, any>} s
   * @param {number | null | undefined} [blinks]
   * @param {Record<string, any>} [o]
   */
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
   * May this frame re-arm the press gate?
   * @param {unknown} proven
   * @param {number} presses
   * @param {number} [max]
   */
  function rearmReady(proven, presses, max) {
    return !!proven && presses < (max || 12);
  }

  /**
   * Speed band a press is scored in.
   * @param {number | null | undefined} omega
   */
  function omegaBand(omega) {
    const a = Math.abs(omega || 0);
    if (a < 150) return 'slow';
    if (a < 300) return 'mid';
    if (a < 500) return 'fast';
    return 'blur';
  }

  /**
   * Dial-width bands.
   * @param {number | null | undefined} width
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
   * @param {{ w: number, ink: number } | null | undefined} m
   * @param {Record<string, any>} [o]
   */
  function cardShapeOk(m, o) {
    const cfg = o || {};
    const minW = cfg.minW != null ? cfg.minW : 260;
    const maxInk = cfg.maxInk != null ? cfg.maxInk : 0.46;
    if (!m) return { card: false, why: 'none' };
    if (!(m.w >= minW)) return { card: false, why: 'narrow' };
    if (!(m.ink < maxInk)) return { card: false, why: 'inky' };
    return { card: true, why: 'ok' };
  }

  /**
   * Measure opaque dark-ink and bright-white ratios on a card RGBA snapshot so we can tell
   * a white pop-in flash frame apart from a settled catch card.
   * @param {{ w: number, h: number, d: Uint8Array | Uint8ClampedArray } | null | undefined} r
   */
  function cardInkMetrics(r) {
    if (!r || !r.d || !r.w || !r.h) return null;
    const d = r.d, n = r.w * r.h;
    if (!n || d.length < n * 4) return null;
    let dark = 0, white = 0, cream = 0, opaque = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (d[i + 3] > 120) {
        opaque++;
        const rr = d[i], gg = d[i + 1], bb = d[i + 2];
        if (0.299 * rr + 0.587 * gg + 0.114 * bb < 150) dark++;
        if (rr >= 225 && gg >= 225 && bb >= 225) white++;
        if (rr >= 215 && gg >= 195 && bb >= 150 && bb <= 230 && (rr - bb) >= 12) cream++;
      }
    }
    if (!opaque) return { dark: 0, white: 0, cream: 0, opaqueFrac: 0 };
    return { dark: dark / opaque, white: white / opaque, cream: cream / opaque, opaqueFrac: opaque / n };
  }

  /**
   * Wait until the catch card exits lofi.town's initial white-flash and mid-flip frames
   * (requiring opaque surface, low white flash, dark ink/art, and card parchment cream)
   * before taking a trophy screenshot.
   * @param {{ w?: number, h?: number, d?: Uint8Array | Uint8ClampedArray, dark?: number, white?: number, cream?: number, opaqueFrac?: number } | null | undefined} input
   * @param {{ minOpaque?: number, maxWhite?: number, minDark?: number, minCream?: number }} [o]
   */
  function isCardSettled(input, o) {
    const m = input && input.d ? cardInkMetrics(/** @type {any} */ (input)) : input;
    if (!m || typeof m.opaqueFrac !== 'number') return false;
    const cfg = o || {};
    const minOpaque = cfg.minOpaque != null ? cfg.minOpaque : 0.20;
    const maxWhite = cfg.maxWhite != null ? cfg.maxWhite : 0.25;
    const minDark = cfg.minDark != null ? cfg.minDark : 0.06;
    const minCream = cfg.minCream != null ? cfg.minCream : 0.15;
    if (m.opaqueFrac < minOpaque) return false;
    if ((m.white || 0) >= maxWhite) return false;
    if ((m.dark || 0) < minDark) return false;
    if (m.cream != null && m.cream < minCream) return false;
    return true;
  }

  function innerCardBox(box, frac) {
    if (!box || !box.w || !box.h) return null;
    const f = Math.max(0.1, Math.min(1, frac != null ? frac : 0.6));
    const w = Math.max(1, Math.round(box.w * f));
    const h = Math.max(1, Math.round(box.h * f));
    const x = Math.round(box.x + (box.w - w) * 0.5);
    const y = Math.round(box.y + (box.h - h) * 0.5);
    return { x, y, w, h };
  }

  function stripCardScrim(r, o) {
    if (!r || !r.d || !r.w || !r.h) return null;
    const w = r.w | 0, h = r.h | 0, n = w * h;
    if (n <= 0 || r.d.length < n * 4) return null;
    const cfg = o || {};
    const maxAlpha = cfg.maxAlpha != null ? cfg.maxAlpha : 235;
    const maxRgb = cfg.maxRgb != null ? cfg.maxRgb : 24;
    const pad = Math.max(0, (cfg.pad != null ? cfg.pad : 8) | 0);
    const out = new Uint8ClampedArray(n * 4);
    out.set(r.d.length === n * 4 ? r.d : r.d.subarray(0, n * 4));
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;

    function isScrim(p) {
      const i = p * 4;
      const a = out[i + 3];
      if (a <= 8) return true;
      return a < maxAlpha && out[i] < maxRgb && out[i + 1] < maxRgb && out[i + 2] < maxRgb;
    }

    function push(p) {
      if (seen[p] || !isScrim(p)) return;
      seen[p] = 1;
      queue[tail++] = p;
    }

    for (let x = 0; x < w; x++) {
      push(x);
      if (h > 1) push((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      push(y * w);
      if (w > 1) push(y * w + (w - 1));
    }

    while (head < tail) {
      const p = queue[head++];
      const i = p * 4;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      const x = p % w, y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x + 1 < w) push(p + 1);
      if (y > 0) push(p - w);
      if (y + 1 < h) push(p + w);
    }

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (out[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;

    const cx = Math.max(0, minX - pad);
    const cy = Math.max(0, minY - pad);
    const cr = Math.min(w, maxX + 1 + pad);
    const cb = Math.min(h, maxY + 1 + pad);
    const cw = cr - cx, ch = cb - cy;
    const trimmed = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const srcStart = ((cy + y) * w + cx) * 4;
      trimmed.set(out.subarray(srcStart, srcStart + cw * 4), y * cw * 4);
    }
    return { d: trimmed, w: cw, h: ch, crop: { x: cx, y: cy, w: cw, h: ch } };
  }

  /**
   * Expand a detected catch-card rect with asymmetrical headroom so oversized Legendary/Secret
   * artwork (fins, wings, tails) is captured intact without exceeding canvas bounds.
   * @param {Rect | null | undefined} box
   * @param {number} cw
   * @param {number} ch
   */
  function padCardBox(box, cw, ch) {
    if (!box || !cw || !ch) return null;
    const px = Math.round(box.w * 0.30);
    const pt = Math.round(box.h * 0.36);
    const pb = Math.round(box.h * 0.12);
    const x = Math.max(0, Math.round(box.x - px));
    const y = Math.max(0, Math.round(box.y - pt));
    const right = Math.min(cw, Math.round(box.x + box.w + px));
    const bottom = Math.min(ch, Math.round(box.y + box.h + pb));
    const w = right - x;
    const h = bottom - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  /**
   * Did the game accept that press?
   * st: { press, s, blinks, opts, graceMs } -> { verdict: 'none'|'pending'|'accepted'|'rejected' }
   * @param {Record<string, any> | null | undefined} st
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

  /**
   * What to do on the N-th fruitless attempt to make a cast happen (N counts from 1).
   * @param {number} n
   */
  function castRecovery(n) {
    const i = Math.floor(n) || 0;
    if (i <= 1) return { tap: true, space: false, walk: false };   // the normal path: click the bubble
    return { tap: true, space: true, walk: false };                // click and the keybind together
  }

  /**
   * Cumulative counters -> rates, so the perf probe reports ms/s and frame share.
   * @param {Record<string, number>} calls
   * @param {Record<string, number>} totals
   * @param {number} uptimeMs
   */
  function perfRates(calls, totals, uptimeMs) {
    const secs = uptimeMs > 0 ? uptimeMs / 1000 : 0;
    /** @type {Record<string, any>} */
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

  return {
    wrap180,
    fitOmega,
    fitStable,
    deltaOmega,
    firstPressGate,
    firstPressBudget,
    firstPressCanMature,
    markFirstPressForced,
    lossDiagnostics,
    dialFallbackWait,
    dialGhost,
    dialStalled,
    spinAlive,
    ghostBlocked,
    planPress,
    sweepBias,
    newTriangle,
    rearmReady,
    omegaBand,
    widthBand,
    cardShapeOk,
    cardInkMetrics,
    isCardSettled,
    innerCardBox,
    stripCardScrim,
    padCardBox,
    pressOutcome,
    castRecovery,
    perfRates,
  };
});
