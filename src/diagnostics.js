// @ts-check
/* src/diagnostics.js — pure bot health verdict, run summary statistics, and result-missing latch.
 * UMD: browser global AutoFishDiagnostics, CommonJS require('./src/diagnostics.js').
 */
/**
 * @param {any} root
 * @param {() => Record<string, any>} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishDiagnostics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Diagnose why fishing is or is not happening from a status snapshot.
   * @param {Record<string, any>} [s]
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
    if (st.resultMissing) return o('result-missing', 'high', 'reload the game tab: the game is waiting for a fishing result it never received', { resultMissing: true });
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

  /**
   * Wilson score interval for k successes out of n. Returns null for an empty sample rather than a
   * NaN that would make the exported JSON invalid.
   * @param {number} k
   * @param {number} n
   * @param {number} [z]
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
   * @param {any[]} attempts
   * @param {Record<string, any>} [o]
   */
  function runSummary(attempts, o) {
    const list = Array.isArray(attempts) ? attempts : [];
    const cfg = o || {};
    /** @type {Record<string, any>} */
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
      locksDisarmed: cfg.locksDisarmed != null ? cfg.locksDisarmed : null,
      firstPressHeld: cfg.firstPressHeld != null ? cfg.firstPressHeld : null,
      firstPressForced: cfg.firstPressForced != null ? cfg.firstPressForced : null,
      firstPressHeldForced: cfg.firstPressHeldForced != null ? cfg.firstPressHeldForced : null,
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
   * How well (delta, omega) predicts the next frame's delta, in degrees and in milliseconds.
   * @param {any[]} log
   */
  function predictionSummary(log) {
    const rows = Array.isArray(log) ? log.filter(Boolean) : [];
    const deg = rows.map((r) => Math.abs(r.err)).filter((v) => isFinite(v)).sort((a, b) => a - b);
    const ms = rows.map((r) => (r.om ? (Math.abs(r.err) / Math.abs(r.om)) * 1000 : null))
      .filter(/** @param {number | null} v @returns {v is number} */ (v) => v != null && isFinite(v)).sort((a, b) => a - b);
    const q = (arr, p) => (arr.length ? +arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(1) : null);
    const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const mDeg = mean(deg);
    const mMs = mean(ms);
    return {
      samples: rows.length,
      meanAbsDeg: mDeg != null ? +mDeg.toFixed(1) : null,
      p50Deg: q(deg, 0.5),
      p95Deg: q(deg, 0.95),
      maxDeg: deg.length ? +deg[deg.length - 1].toFixed(1) : null,
      meanAbsMs: mMs != null ? +mMs.toFixed(1) : null,
      p50Ms: q(ms, 0.5),
      p95Ms: q(ms, 0.95),
      maxMs: ms.length ? +ms[ms.length - 1].toFixed(1) : null,
      over50ms: ms.filter((v) => v > 50).length,
      over50msRate: ms.length ? +(ms.filter((v) => v > 50).length / ms.length).toFixed(3) : null,
    };
  }

  /**
   * Press acceptance, and how much of it was observed rather than assumed.
   * @param {any[]} log
   */
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
   * Press verdicts by their evidence (`observed`, `assumed`, `timing`).
   * @param {Record<string, any> | null | undefined} t
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

  /**
   * Pure check for the client's stuck `waiting-for-result` state.
   * @param {Record<string, any> | null | undefined} f
   * @param {number} t
   */
  function resultMissingDue(f, t) {
    const p = f && f.pendingWin;
    const a = f && f.attempt;
    if (!f || f.resultMissing || f.geo || !p || !a) return false;
    if (p.verdict !== 'hit' || p.shapeSeen || p.landed || p.closedAt == null) return false;
    if (!(a.presses > 0 && a.dialHits > 0)) return false;
    const threshold = (f.opts && f.opts.resultMissingMs) || 8000;
    return t - p.closedAt > threshold;
  }

  /**
   * Bound controller around `F` + logger `L` for clearing/latching missing results.
   * @param {Record<string, any>} F
   * @param {(msg: string, extra?: Record<string, any>) => void} L
   */
  function createResultMissing(F, L) {
    return {
      /** @param {number} t */
      due: function (t) { return resultMissingDue(F, t); },
      /** @param {string | null} [why] */
      clear: function (why) {
        if (!F.resultMissing) return false;
        F.resultMissing = false;
        F.resultMissingAt = 0;
        F.resultMissingAttempt = null;
        L('result missing cleared', { why: why || null });
        return true;
      },
      /** @param {number} t @param {string | null} [why] */
      mark: function (t, why) {
        if (F.resultMissing) return false;
        F.resultMissing = true;
        F.resultMissingAt = t;
        const a = F.attempt;
        F.resultMissingAttempt = a ? { n: a.n, presses: a.presses, dials: a.dials, dialHits: a.dialHits } : null;
        if (F.stats) F.stats.resultMissing = (F.stats.resultMissing || 0) + 1;
        L('result missing', {
          why: why || null,
          attempt: a ? a.n : null,
          presses: a ? a.presses : 0,
          dialHits: a ? a.dialHits : 0,
          sinceDialCloseMs: F.pendingWin && F.pendingWin.closedAt != null ? Math.round(t - F.pendingWin.closedAt) : null,
        });
        return true;
      },
    };
  }

  return {
    doctor,
    wilson,
    runSummary,
    predictionSummary,
    pressAcceptSummary,
    pressVerdictReport,
    resultMissingDue,
    createResultMissing,
  };
});
