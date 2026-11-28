// @ts-check
/* src/vision.js — coordinate mapping, GL row flip, prompt boxes, connected-component flood fill,
 * prompt glyph classification, and catch-card text parsing.
 * UMD: browser global AutoFishVision, CommonJS require('./src/vision.js').
 */
/**
 * @param {any} root
 * @param {() => Record<string, any>} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishVision = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Convert UI canvas backing-store coordinates to CSS pixel coordinates.
   * @param {number} x
   * @param {number} y
   * @param {{ left: number, top: number, w: number, h: number, cw?: number, ch?: number } | null | undefined} frame
   */
  function cssPoint(x, y, frame) {
    if (!frame) return { x: x, y: y };
    const kx = frame.cw ? frame.w / frame.cw : 1;
    const ky = frame.ch ? frame.h / frame.ch : 1;
    return { x: frame.left + x * kx, y: frame.top + y * ky };
  }

  /**
   * readPixels hands back the framebuffer bottom-up, while every detector indexes a read
   * top-down from the x/y it asked for. Reverse the rows in place; `row` is supplied by the
   * caller so the flip does not allocate a buffer per read.
   * @template {Uint8Array | Uint8ClampedArray} T
   * @param {T} d
   * @param {number} w
   * @param {number} h
   * @param {Uint8Array | Uint8ClampedArray} row
   * @returns {T}
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

  /**
   * GL's origin is bottom-left: the top-down row `y` starts at this framebuffer row.
   * @param {number} bh
   * @param {number} y
   * @param {number} h
   */
  function glRowY(bh, y, h) { return bh - (y + h); }

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

  /**
   * Compute the normalized prompt search box for a given canvas size.
   * @param {number | null} [cw]
   * @param {number | null} [ch]
   */
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

  /**
   * Off-center pier seats render their prompt at (cx, cy - 53) above the locked dial.
   * @param {{ cx: number, cy: number, [k: string]: any } | null | undefined} geo
   * @param {number | null} [cw]
   * @param {number | null} [ch]
   */
  function seatPromptBox(geo, cw, ch) {
    if (!geo || !isFinite(geo.cx) || !isFinite(geo.cy)) return null;
    const W = Math.max(1, Math.round(cw || BUBBLE_BOX_REF.cw));
    const H = Math.max(1, Math.round(ch || BUBBLE_BOX_REF.ch));
    const w = Math.min(W, BUBBLE_BOX_MIN_W);
    const h = Math.min(H, BUBBLE_BOX_MIN_H);
    const x = Math.max(0, Math.min(W - w, Math.round(geo.cx - w / 2)));
    const y = Math.max(0, Math.min(H - h, Math.round((geo.cy - 53) - h / 2)));
    return { x, y, w, h };
  }

  const near4 = new Int32Array(4);

  /**
   * 4-connected components over an RGBA buffer: bbox and pixel count per blob.
   *
   * Pure on purpose (buffer + scratch in, components out) so the flood fill can be tested on a
   * hand-built image. `seen` is supplied because the caller reuses one scratch buffer: this runs
   * on every shared scan tick, and a fresh 108 KB Uint8Array per call is pure garbage pressure.
   * @param {number} w
   * @param {number} h
   * @param {Uint8Array | Uint8ClampedArray} d
   * @param {(d: Uint8Array | Uint8ClampedArray, idx: number) => boolean} match
   * @param {number} minPx
   * @param {Uint8Array} seen
   */
  function floodComponents(w, h, d, match, minPx, seen) {
    const total = w * h;
    seen.fill(0);
    /** @type {Array<{ x0: number, y0: number, x1: number, y1: number, count: number }>} */
    const out = [];
    for (let p0 = 0; p0 < total; p0++) {
      if (seen[p0] || !match(d, p0 * 4)) continue;
      const stack = [p0];
      seen[p0] = 1;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0;
      while (stack.length) {
        const p = stack.pop();
        if (p === undefined) continue;
        const x = p % w, y = (p / w) | 0;
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

  /**
   * Classify whether a boxed white bubble holds prompt glyphs or an opaque player name tag.
   * @param {Uint8Array | Uint8ClampedArray} d
   * @param {number} w
   * @param {number} s
   * @param {number} e
   * @param {number} y0
   * @param {number} y1
   */
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

  const WEIGHT = /^\d+(?:\.\d+)?\s?(?:kg|g|t|lb)$/i;
  const MONEY = /^\$\s?\d[\d,]*(?:\.\d+)?$/;
  // Species names are not ASCII: the game prints `Moʻo` (U+02BB) and uses `?` in legendary
  // names such as `A Penguin?` and `Mermaid?`. Requiring letters/marks (rather than A-Z) and the
  // punctuation the card actually draws keeps those names from being consumed as the rarity word.
  const WORD = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}'’ʻ&?!.:()\- ]*$/u;

  /**
   * Card strings drawn after `since`, minus the bubbles and the digit-at-a-time date.
   * @param {Array<{ t: number, s: unknown } | null | undefined>} buf
   * @param {number} since
   */
  function textSince(buf, since) {
    /** @type {string[]} */
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
   * @param {string[]} raw
   * @param {((s: string) => boolean) | null} [isTier]
   * @param {((s: string) => boolean) | null} [isKnown]
   */
  function parseCard(raw, isTier, isKnown) {
    if (!raw.length) return { why: 'empty' };                  // nothing drawn since the cursor: already logged
    let lastV = -1, prevV = -1;
    for (let i = 0; i < raw.length; i++) {
      if (MONEY.test(raw[i])) { prevV = lastV; lastV = i; }
    }
    if (lastV < 0) return { why: 'noprice' };                  // every card prints its price
    // If multiple cards piled up since F.txtAt, isolate the most recent complete card slice.
    const slice = prevV >= 0 && raw.slice(prevV + 1, lastV).some((s) => WORD.test(s) && !WEIGHT.test(s))
      ? raw.slice(prevV + 1)
      : raw;
    const wI = slice.findIndex((s) => WEIGHT.test(s));
    const vI = slice.findIndex((s) => MONEY.test(s));
    if (vI < 0) return { why: 'noprice' };
    const rec = { species: '', rarity: '', quality: '', weight: wI >= 0 ? slice[wI] : '', value: slice[vI], raw: slice };
    /** @type {Array<[number, string]>} */
    const words = [];
    for (let i = 0; i < vI; i++) {
      // A weight or price can also satisfy the broad word pattern; they are values, not names.
      if (WEIGHT.test(slice[i]) || MONEY.test(slice[i])) continue;
      if (WORD.test(slice[i])) words.push([i, slice[i]]);
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

  return {
    cssPoint,
    flipRows,
    glRowY,
    BUBBLE_BOX_REF,
    BUBBLE_BOX_MIN_W,
    BUBBLE_BOX_MIN_H,
    promptBox,
    seatPromptBox,
    floodComponents,
    GLYPH_OPAQUE_MAX,
    glyphMetrics,
    WEIGHT,
    MONEY,
    WORD,
    textSince,
    parseCard,
  };
});
