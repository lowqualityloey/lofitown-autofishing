// @ts-check
/* layout.js — where the panel may sit so it never covers the fishing UI.
 * Pure geometry: no DOM. Browser global AutoFishLayout, CommonJS require('./layout.js').
 */
/**
 * @param {any} root
 * @param {() => AutoFishLayoutApi} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MARGIN = 12;

  /**
   * @param {Rect | null | undefined} rect
   * @param {number} by
   * @returns {Rect | null}
   */
  function inflate(rect, by) {
    if (!rect) return null;
    return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
  }

  /**
   * Strict overlap: rects that only share an edge do not intersect.
   * @param {Rect | null | undefined} a
   * @param {Rect | null | undefined} b
   * @returns {boolean}
   */
  function intersects(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  /**
   * @param {Array<Rect | null | undefined>} rects
   * @returns {Rect | null}
   */
  function unionRect(rects) {
    /** @type {Rect | null} */
    var out = null;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (!r) continue;
      if (!out) { out = { x: r.x, y: r.y, w: r.w, h: r.h }; continue; }
      var x2 = Math.max(out.x + out.w, r.x + r.w);
      var y2 = Math.max(out.y + out.h, r.y + r.h);
      out.x = Math.min(out.x, r.x);
      out.y = Math.min(out.y, r.y);
      out.w = x2 - out.x;
      out.h = y2 - out.y;
    }
    return out;
  }

  /**
   * @param {Point} pos
   * @param {Size} size
   * @param {Size} viewport
   * @param {number} margin
   * @returns {Rect}
   */
  function clamp(pos, size, viewport, margin) {
    var maxX = Math.max(margin, viewport.w - size.w - margin);
    var maxY = Math.max(margin, viewport.h - size.h - margin);
    return {
      x: Math.min(Math.max(pos.x, margin), maxX),
      y: Math.min(Math.max(pos.y, margin), maxY),
      w: size.w,
      h: size.h
    };
  }

  /**
   * Choose a panel position. Returns { x, y, w, h } or the string 'pill'.
   * Candidate order: the preferred spot, the four corners, then the four sides of the
   * exclusion rect — first one that fits the viewport and clears the game wins.
   * @param {PlaceOpts} opts
   * @returns {PlaceResult}
   */
  function place(opts) {
    var size = { w: opts.panel.w, h: opts.panel.h };
    var viewport = opts.viewport;
    var margin = opts.margin == null ? MARGIN : opts.margin;
    // The game draws a HUD strip along the top; corners start below it so the panel does not cover
    // controls the player still needs to click.
    var topInset = opts.topInset || 0;
    var bottomInset = opts.bottomInset || 0;
    var top = margin + topInset;
    var exclude = opts.exclude || null;

    if (size.w + margin * 2 > viewport.w || size.h + margin * 2 > viewport.h) return 'pill';

    var right = viewport.w - size.w - margin;
    var bottom = Math.max(top, viewport.h - size.h - margin - bottomInset);
    // Top-left first: the game's coin and upgrade controls live in the top-right strip, and the
    // panel swallows pointer events, so parking over them would make them unclickable.
    /** @type {Point[]} */
    var corners = [
      { x: margin, y: top },
      { x: margin, y: bottom },
      { x: right, y: bottom },
      { x: right, y: top }
    ];

    /** @type {Point[]} */
    var candidates = [];
    if (opts.preferred) candidates.push({ x: opts.preferred.x, y: opts.preferred.y });
    candidates = candidates.concat(corners);
    if (exclude) {
      candidates.push({ x: exclude.x - size.w - margin, y: exclude.y });
      candidates.push({ x: exclude.x + exclude.w + margin, y: exclude.y });
      candidates.push({ x: exclude.x, y: exclude.y - size.h - margin });
      candidates.push({ x: exclude.x, y: exclude.y + exclude.h + margin });
    }

    for (var i = 0; i < candidates.length; i++) {
      var r = clamp(candidates[i], size, viewport, margin);
      if (r.x + r.w > viewport.w || r.y + r.h > viewport.h) continue;
      if (intersects(r, exclude)) continue;
      return r;
    }
    return 'pill';
  }

  return { MARGIN: MARGIN, inflate: inflate, intersects: intersects, unionRect: unionRect, place: place };
});
