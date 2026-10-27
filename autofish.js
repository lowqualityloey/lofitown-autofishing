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
 *  - The minigame is NOT in the game's own canvas. `app.render()` produces the world only;
 *    the CAST!/REEL! bubbles and the dial are drawn on the SECOND canvas (the UI layer).
 *  - That second canvas must be read from inside a requestAnimationFrame callback: its
 *    buffer is discarded after compositing, so a read from a normal task returns nothing.
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
 * A press outside the wedge loses the fish, so the loop presses at most once per
 * rotation, when the MIDPOINT of the wedge is predicted to be on the pin, and never
 * clicks anything except a validated bubble.
 */
(() => {
  if (window.__fish) { try { window.__fish.stop(); } catch (e) {} }

  const F = { version: 'autofish 3.0' };
  const now = () => performance.now();

  /* ------------------------------------------------------------- log ----- */
  F.log = [];
  function L(msg, extra) {
    F.log.push(Object.assign({ t: Math.round(now()), msg }, extra || {}));
    if (F.log.length > 600) F.log.shift();
  }

  /* -------------------------------------------------------- surfaces ----- */
  let uiCanvas = null, gameCanvas = null;
  function surfaces() {
    const cans = [...document.querySelectorAll('canvas')];
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    gameCanvas = app ? app.renderer.canvas : cans[0];
    uiCanvas = cans.find((c) => c !== gameCanvas) || cans[1] || cans[0];
  }

  let ubuf = null, uctx = null;
  /** Read the UI layer. Must be called from inside a rAF callback. */
  function readUI(x, y, w, h) {
    if (!uiCanvas) surfaces();
    if (!ubuf) {
      ubuf = document.createElement('canvas');
      ubuf.width = 520; ubuf.height = 520;
      uctx = ubuf.getContext('2d', { willReadFrequently: true });
    }
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(uiCanvas.width - x, Math.round(w));
    h = Math.min(uiCanvas.height - y, Math.round(h));
    if (w <= 0 || h <= 0) return null;
    if (ubuf.width < w || ubuf.height < h) {
      ubuf.width = Math.max(ubuf.width, w);
      ubuf.height = Math.max(ubuf.height, h);
    }
    uctx.clearRect(0, 0, w, h);
    try { uctx.drawImage(uiCanvas, x, y, w, h, 0, 0, w, h); } catch (e) { return null; }
    return { d: uctx.getImageData(0, 0, w, h).data, w, h, x, y };
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
  /** The CAST!/REEL! bubble: the only large white shape near the player. */
  F.findBubble = function () {
    const B = { x: 690, y: 215, w: 360, h: 210 };
    const r = readUI(B.x, B.y, B.w, B.h);
    if (!r) return null;
    const cols = [];
    for (let x = 0; x < r.w; x++) {
      let c = 0;
      for (let y = 0; y < r.h; y++) if (WHT(PX(r, x + r.x, y + r.y))) c++;
      cols.push(c);
    }
    let s = -1, best = null;
    for (let x = 0; x <= r.w; x++) {
      const on = x < r.w && cols[x] > 3;
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        const w = x - s;
        if (w > 45 && w < 150) {
          let y0 = 1e9, y1 = -1, n = 0;
          for (let xx = s; xx < x; xx++) {
            for (let y = 0; y < r.h; y++) {
              if (WHT(PX(r, xx + r.x, y + r.y))) { n++; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            }
          }
          const h = y1 - y0;
          if (h > 25 && h < 95 && (!best || n > best.n)) {
            best = { cx: Math.round((s + x - 1) / 2 + r.x), cy: Math.round((y0 + y1) / 2 + r.y), w, h, n };
          }
        }
        s = -1;
      }
    }
    return best;
  };

  /**
   * The catch card: a parchment panel that blocks the next cast until it is tapped away.
   * It is drawn on the same UI layer, so it is found by colour and area - a cream fill over a
   * wide centre rect. The dial cannot trip this: it covers well under the 45% threshold.
   */
  F.findCatch = function () {
    const B = { x: 620, y: 315, w: 365, h: 405 };
    const r = readUI(B.x, B.y, B.w, B.h);
    if (!r) return null;
    let hit = 0, n = 0;
    for (let y = 6; y < r.h - 6; y += 8) {
      for (let x = 6; x < r.w - 6; x += 8) {
        const c = PX(r, x + r.x, y + r.y);
        n++;
        if (c[3] > 60 && c[0] > 225 && c[1] > 200 && c[2] > 130 && c[2] < 238) hit++;
      }
    }
    const frac = n ? hit / n : 0;
    if (frac < 0.2) return null;      // paper is 249,238,208 and covers ~28% once art and frame are excluded
    return { cx: Math.round(r.x + r.w / 2), cy: Math.round(r.y + r.h / 2), frac: +frac.toFixed(2) };
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

  const WEIGHT = /^\d+(?:\.\d+)?\s?(?:kg|g|t|lb)$/i;
  const MONEY = /^\$ ?\d[\d,]*$/;
  const WORD = /^[A-Za-z][A-Za-z'.\-]*(?: [A-Za-z'.\-]+)*$/;

  /**
   * Read one catch off the captured text. Card order is species, [rarity], weight, quality,
   * value, then the catch date drawn digit by digit. Rarity is printed only on non-common fish,
   * so the slot is resolved by position around the weight instead of by a list of tier names.
   */
  F.parseCatch = function () {
    const buf = hookText();
    const since = F.txtAt || 0;
    const raw = [];
    for (const e of buf) {
      if (e.t <= since) continue;
      const s = String(e.s).trim();
      if (!s || /!|^(cast|reel|bite)$/i.test(s)) continue;      // bubbles are not card text
      if (s.length < 2 && !/^\$/.test(s)) continue;             // the date is drawn one digit at a time
      raw.push(s);
    }
    if (!raw.length) { F.parseWhy = 'empty'; return null; }    // nothing drawn since the last card: already logged
    const wI = raw.findIndex((s) => WEIGHT.test(s));
    const vI = raw.findIndex((s) => MONEY.test(s));
    if (vI < 0) { F.parseWhy = 'noprice'; return null; }     // every card prints its price
    const rec = { species: '', rarity: '', quality: '', weight: wI >= 0 ? raw[wI] : '', value: raw[vI], raw };
    const words = [];
    for (let i = 0; i < vI; i++) if (WORD.test(raw[i])) words.push([i, raw[i]]);
    if (!words.length) { F.parseWhy = 'nowords'; return null; }
    rec.species = words[0][1];
    for (let k = 1; k < words.length; k++) {
      if (wI < 0 || words[k][0] > wI) rec.quality = words[k][1];
      else rec.rarity = words[k][1];
    }
    F.parseWhy = 'ok';
    return rec;
  };

  /**
   * Catch log. One row per fish, POSTed to the local logger which appends it to catches.csv.
   * Species, rarity, weight and value are read from the card's own text, never inferred.
   */
  F.recordCatch = function (card) {
    const rec = F.parseCatch();
    if (!rec) return 'pending';
    F.txtAt = now();
    const row = Object.assign({ t: Date.now(), frac: card && card.frac }, rec);
    F.catches.push(row);
    if (F.catches.length > 400) F.catches.shift();
    L('catch logged', { species: row.species, rarity: row.rarity, quality: row.quality, weight: row.weight, value: row.value });
    try {
      fetch(F.logUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(row) }).catch(function () {});
    } catch (e) {}
    if (typeof F.onCatch === 'function') { try { F.onCatch(row); } catch (e) {} }
    return 'logged';
  };


  /* ------------------------------------------------------------ dial ----- */
  /** Find the dial near a hint: grey annulus + two-tone interior, else null. */
  F.lockDial = function (hintX, hintY) {
    const S = 240, hw = S / 2;
    const r = readUI(hintX - hw, hintY - hw, S, S);
    if (!r) return null;
    let best = null;
    for (let dy = -22; dy <= 22; dy += 3) {
      for (let dx = -22; dx <= 22; dx += 3) {
        const cx = Math.round(hintX + dx), cy = Math.round(hintY + dy);
        for (let R = 78; R <= 120; R += 2) {
          let hit = 0;
          for (let k = 0; k < 20; k++) {
            const a = k * Math.PI / 10;
            if (RIM(PX(r, Math.round(cx + R * Math.cos(a)), Math.round(cy + R * Math.sin(a))))) hit++;
          }
          if (hit >= 17 && (!best || hit > best.score)) best = { cx, cy, R, score: hit };
        }
      }
    }
    if (!best) return null;
    let bestR = best.R, bestN = -1;
    for (let R = Math.max(74, best.R - 8); R <= best.R + 8; R++) {
      let n = 0;
      for (let k = 0; k < 40; k++) {
        const a = k * Math.PI / 20;
        if (RIM(PX(r, Math.round(best.cx + R * Math.cos(a)), Math.round(best.cy + R * Math.sin(a))))) n++;
      }
      if (n > bestN) { bestN = n; bestR = R; }
    }
    const geo = { cx: best.cx, cy: best.cy, R: bestR };
    const s = F.sample(geo);
    if (!s || !s.valid || s.ring < 0.8) return null;
    geo.width = s.width;
    return geo;
  };

  /**
   * One frame of dial state. Re-tests the rim over a small radius band so the dial's
   * fade-in / scale-in cannot drop the lock, then reads the wedge at 0.62R.
   */
  F.sample = function (geo) {
    const pad = 14, half = Math.round(Math.max(geo.R, 100) + pad);
    const r = readUI(geo.cx - half, geo.cy - half, half * 2, half * 2);
    if (!r) return null;

    let bestR = geo.R, bestHit = -1;
    for (let dR = -6; dR <= 8; dR += 2) {
      const R = geo.R + dR;
      let hit = 0;
      for (let k = 0; k < 20; k++) {
        const a = k * Math.PI / 10;
        if (RIM(PX(r, Math.round(geo.cx + R * Math.cos(a)), Math.round(geo.cy + R * Math.sin(a))))) hit++;
      }
      if (hit > bestHit) { bestHit = hit; bestR = R; }
    }
    const ring = bestHit / 20;
    if (bestHit >= 15) geo.R = bestR;

    const n = 72, rr = Math.round(geo.R * 0.69);            // 63px at the measured R~91
    const b = [];
    let greenN = 0;
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n;                        // 0 = 12 oclock, clockwise
      const c = PX(r, Math.round(geo.cx + rr * Math.sin(a)), Math.round(geo.cy - rr * Math.cos(a)));
      // 1 = wedge, 2 = pin (wildcard), 0 = disc base. Only the pin own +-10 deg band is
      // blanked; a stray orange elsewhere must not manufacture a phantom arc.
      const nearPin = k <= 2 || k >= n - 2;
      const v = GRN(c) ? 1 : (nearPin ? 2 : 0);            // the whole pin band is unknown
      if (v === 1) greenN++;
      b.push(v);
    }
    // The pin is fixed at 12 oclock and always painted, so it doubles as a geometry check:
    // if no orange appears anywhere in that band, this circle is not the dial.
    let pinN = 0;
    for (let f = 0.58; f <= 0.881; f += 0.075) {
      const pr = geo.R * f;
      for (let deg = -9; deg <= 9.1; deg += 4.5) {
        const a = deg * Math.PI / 180;
        if (PIN(PX(r, Math.round(geo.cx + pr * Math.sin(a)), Math.round(geo.cy - pr * Math.cos(a))))) pinN++;
      }
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

    let omega = geo._om == null ? null : geo._om;
    if (tracked) {
      let d = mid - geo._mid;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) >= 0.5 && dt > 0 && dt < 300) {
        const w = d / dt * 1000;
        if (Math.abs(w) <= 600) omega = w;
      }
    }
    geo._mid = mid; geo._mt = now(); geo._om = omega;

    // Signed distance from the wedge midpoint to the pin: 0 means aligned.
    let delta = (0 - mid) % 360;
    if (delta > 180) delta -= 360;
    if (delta <= -180) delta += 360;

    // Lead: where the midpoint will be when a dispatched event is processed.
    const lead = ((F.opts && F.opts.leadMs) || 0) / 1000;
    const pred = omega == null ? delta : delta + omega * lead;

    return { ring, valid: true, start, width, mid, delta, pred, omega, tracked, runs: runs.length, pat: b.join(''), greenN, R: geo.R };
  };

  /* ----------------------------------------------------------- input ----- */
  function tap(x, y) {
    let el = document.elementFromPoint(x, y) || gameCanvas;
    // The panel sits above the game; if it covers the press point, aim at the canvas instead.
    if (el && el.closest && el.closest('#autofish-panel')) el = gameCanvas;
    if (!el) return false;
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

  /* ------------------------------------------------------------ loop ----- */
  F.start = function (opts) {
    F.opts = Object.assign({
      press: true,
      pressWith: 'space',           // 'space' | 'pointer'
      spaceTarget: 'window',
      midDeg: 6,                    // press when the wedge midpoint is this close to the pin
      leadMs: 25,                   // fire early by the event travel (~3 deg at 130 deg/s)
      bubbleDebounceMs: 900,
      dialCheckMs: 250,
      maxMinutes: 240,
    }, opts || {});
    surfaces();
    F.stats = { bubbles: 0, dials: 0, presses: 0, dialsClosed: 0, frames: 0, errors: 0, cards: 0 };
    F.geo = null; F.hint = { x: 861, y: 372 }; F.catches = []; F.logUrl = (opts && opts.logUrl) || 'http://127.0.0.1:8731/catch';
    F.txtAt = now(); F.cardWait = null;                        // only text drawn from here on counts
    F.armed = true; F.lastPress = 0; F.lastDialCheck = 0; F.bad = 0;
    F.paused = false; F.lastBubble = null; F.lastCardRect = null;
    F.pressesThisDial = 0; F.pressesAtThisDial = 0;
    F.running = true; F.startedAt = now(); F.hiddenPauses = 0;
    L('start', { opts: F.opts, ui: !!uiCanvas, game: !!gameCanvas });
    if (!F._raf) F._raf = requestAnimationFrame(loop);
    return F.status();
  };

  F.stop = function () {
    F.running = false;
    if (F._raf) cancelAnimationFrame(F._raf);
    F._raf = null;
    L('stop', { stats: F.stats });
    return F.status();
  };

  /** Hold the loop where it is without ending the session: no presses until resume(). */
  F.pause = function () {
    F.paused = true;
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

  /** Fresh counters without restarting: used when a panel session begins on a live loop. */
  F.resetStats = function () {
    F.stats = { bubbles: 0, dials: 0, presses: 0, dialsClosed: 0, frames: 0, errors: 0, cards: 0 };
    F.catches = [];
    return F.status();
  };

  /** Where the game is drawing right now, so overlays can keep clear of it. Rects are {x,y,w,h}. */
  F.zones = function () {
    const bubble = F.lastBubble
      ? { x: F.lastBubble.cx - F.lastBubble.w / 2, y: F.lastBubble.cy - F.lastBubble.h / 2, w: F.lastBubble.w, h: F.lastBubble.h }
      : null;
    const dial = F.geo ? { x: F.geo.cx - F.geo.R, y: F.geo.cy - F.geo.R, w: F.geo.R * 2, h: F.geo.R * 2 } : null;
    const hintZone = (!bubble && !dial && F.hint) ? { x: F.hint.x - 90, y: F.hint.y - 90, w: 180, h: 180 } : null;
    return { bubble, dial, card: F.lastCardRect || null, hintZone };
  };

  function loop() {
    if (!F.running) { F._raf = null; return; }
    F._raf = requestAnimationFrame(loop);
    try { step(); } catch (e) { F.stats.errors++; L('error', { e: String((e && e.message) || e) }); }
  }

  function step() {
    const t = now();
    F.stats.frames++;
    if (document.visibilityState !== 'visible') { F.hidden = true; return; }
    if (F.hidden) { F.hidden = false; F.hiddenPauses++; }
    if (F.paused) return;
    if (t - F.startedAt > F.opts.maxMinutes * 60000) { L('maxMinutes'); F.stop(); return; }

    // 0. a catch card blocks the next cast until it is tapped away. Its paper appears before its
    // text is drawn, so the card is held open until the catch has been read - tapping on sight
    // dismissed cards that had not printed their species yet, losing the record. Bounded, so a
    // card that never prints text still clears.
    if (!F.geo && t - (F.lastCard || 0) > 1500) {
      const card = F.findCatch();
      if (card) {
        // half-sizes measured on the 1522x954 layout; good enough to keep the panel clear
        F.lastCardRect = { x: card.cx - 183, y: card.cy - 203, w: 366, h: 406 };
        const r = F.recordCatch(card);
        if (r !== 'logged') {
          if (F.cardWait == null) F.cardWait = t;
          if (t - F.cardWait < 2500) { F.stats.cardWaits = (F.stats.cardWaits || 0) + 1; return; }
          L('catch text missing', { frac: card.frac, why: F.parseWhy });
        }
        tap(card.cx, card.cy);
        F.lastCard = t; F.cardWait = null; F.lastCardRect = null;
        F.stats.cards = (F.stats.cards || 0) + 1;
        L('catch card dismissed', { frac: card.frac, log: r });
        return;
      }
    }

    // 1. a bubble is always the next thing to press (CAST! or REEL!, same shape)
    const b = F.findBubble();
    if (b) {
      F.lastBubble = b;
      if (t - F.lastPress > F.opts.bubbleDebounceMs) {
        tap(b.cx, b.cy);
        F.lastPress = t;
        F.stats.bubbles++;
        F.hint = { x: b.cx, y: b.cy + 53 };
        L('bubble', { cx: b.cx, cy: b.cy, n: b.n, hint: F.hint.y });
      }
      return;
    }

    // 2. a locked dial: play it
    if (F.geo) {
      const s = F.sample(F.geo);
      if (!s || !s.valid || s.ring < 0.7) {
        if (++F.bad > 3) {
          const presses = F.pressesThisDial;
          F.stats.dialsClosed++;
          L('dial gone', { ring: s && +s.ring.toFixed(2), presses, heldMs: Math.round(t - (F.geoAt || t)) });
          F.geo = null; F.bad = 0; F.pressesThisDial = 0;
        }
        return;
      }
      F.bad = 0;
      const win = F.opts.midDeg == null ? 6 : F.opts.midDeg;
      if (Math.abs(s.pred) > 30) F.armed = true;             // one press per rotation
      if (F.opts.press && F.armed && s.tracked && Math.abs(s.pred) <= win && t - F.lastPress > 120) {
        if (F.opts.pressWith === 'space') space(F.opts.spaceTarget);
        else tap(F.geo.cx, F.geo.cy);
        F.armed = false; F.lastPress = t;
        F.stats.presses++; F.pressesThisDial++;
        L('PRESS', {
          delta: Math.round(s.delta), pred: +s.pred.toFixed(1),
          mid: Math.round(s.mid), width: Math.round(s.width),
          omega: s.omega && Math.round(s.omega),
          via: F.opts.pressWith, dialPressN: F.pressesThisDial,
        });
      }
      return;
    }

    // 3. nothing on screen: look for a dial now and then (cheap enough at ~4 Hz)
    if (t - F.lastDialCheck > F.opts.dialCheckMs) {
      F.lastDialCheck = t;
      const g = F.lockDial(F.hint.x, F.hint.y);
      if (g) {
        F.geo = g; F.geoAt = t; F.bad = 0; F.pressesThisDial = 0;
        F.stats.dials++;
        L('dial locked', { cx: g.cx, cy: g.cy, R: g.R, width: Math.round(g.width) });
      }
    }
  }

  /* ------------------------------------------------------- reporting ----- */
  F.status = function () {
    return {
      running: !!F.running,
      paused: !!F.paused,
      catchCount: F.catches ? F.catches.length : 0,
      hidden: !!F.hidden,
      geo: F.geo ? { cx: F.geo.cx, cy: F.geo.cy, R: F.geo.R, width: F.geo.width && Math.round(F.geo.width) } : null,
      hint: F.hint,
      stats: F.stats,
      pressesThisDial: F.pressesThisDial,
      logTail: F.log.slice(-8),
    };
  };
  F.report = function () { return { version: F.version, stats: F.stats, log: F.log.slice(-250) }; };

  /** One-shot probes, safe to call from a normal task. */
  F.probeBubble = () => new Promise((res) => requestAnimationFrame(() => res(F.findBubble())));
  F.probeDial = (x, y) => new Promise((res) => requestAnimationFrame(() => res(F.lockDial(x, y))));
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

  surfaces();
  window.__fish = F;
  return { installed: F.version, ui: !!uiCanvas, game: !!gameCanvas };
})();
