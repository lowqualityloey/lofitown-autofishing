// ==UserScript==
// @name         lofi.town AutoFish
// @namespace    lofitown-autofishing
// @version      3.2.0
// @description  Casts, reels and presses the dial on lofi.town. Panel included; no server, no bookmarklet.
// @match        https://app.lofi.town/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
'use strict';
if (window.__autofishInstalled) return;
window.__autofishInstalled = true;

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
 * Timing: the press is dispatched by a timer aimed at the moment the pin crosses the wedge,
 * not by the frame that happens to see it - at 746 deg/s the whole +/-6 deg window is 16 ms,
 * i.e. exactly one frame. Spin rate is a least-squares fit over the last ~200 ms of distinct
 * frames (unwrapped, no deadband, no 600 deg/s clamp). The acceptance window is the measured
 * arc minus a margin unless opts.trigger === 'angle'. Presses go through the pointer path,
 * the one proven to reach the game; 'space' stays available for A/B tests.
 */
(() => {
  if (window.__fish) { try { window.__fish.stop(); } catch (e) {} }

  const F = { version: 'autofish 3.0' };
  const now = () => performance.now();

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
   * The schedule always aims at the CROSSING (pin on the midpoint) - that is the widest error
   * tolerance in both directions. Containment only widens the window used to decide that a
   * late press is still inside the drawn arc; trigger 'angle' keeps the old midpoint rule.
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
  // </timing-core>

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
  ["Anchovy","Common",0.1,0.3,5], ["Bass","Common",1,8,8], ["Bluegills","Common",0.1,2,6], ["Catfish","Common",2,20,12],
  ["Cod","Common",2,15,10], ["Flounder","Common",1,5,7], ["Golden Shiner","Common",0.05,0.5,5], ["Herring","Common",0.5,2,7],
  ["Largemouth Bass","Common",1,10,10], ["Leech","Common",0.01,0.05,5], ["Lobster","Common",0.45,5,8], ["Mackerel","Common",1,4,9],
  ["Minnow","Common",0.01,0.1,5], ["Mud Crab","Common",0.1,1,7], ["Sardine","Common",0.2,1,6], ["Sea Urchin","Common",0.5,3,8],
  ["Shrimp","Common",0.1,0.5,5], ["Snook","Common",1,15,11], ["Star Fish","Common",0.2,2,6], ["Swamp Barb","Common",0.05,0.3,6],
  ["Tadpole","Common",0.01,0.05,5], ["White Sucker","Common",0.5,3,8], ["Yellow Perch","Common",0.2,2,7], ["Alligator Gar","Uncommon",10,140,30],
  ["Asian Swamp Eel","Uncommon",0.5,5,18], ["Clown Fish","Uncommon",0.2,1,19], ["Crawfish","Uncommon",0.02,0.2,15], ["Eel","Uncommon",2,25,25],
  ["European Toad","Uncommon",0.02,0.15,16], ["Larger Mouth Bass","Uncommon",3,25,22], ["Moorish Idol","Uncommon",0.5,2,20], ["Mudfish","Uncommon",1,8,20],
  ["Mudskipper","Uncommon",0.05,0.3,17], ["Oyster","Uncommon",0.3,2,15], ["Puffer Fish","Uncommon",0.5,3,18], ["Rainbow Darter","Uncommon",0.01,0.1,19],
  ["Salmon","Uncommon",5,30,28], ["Seahorse","Uncommon",0.1,1,17], ["Squid","Uncommon",1,15,24], ["Sturgeon","Uncommon",20,350,35],
  ["Tarpon","Uncommon",15,160,28], ["Tetra","Uncommon",0.1,0.5,16], ["Trevally","Uncommon",3,25,22], ["Tuna","Uncommon",20,400,35],
  ["Walleye","Uncommon",1,10,24], ["Axolotl","Rare",0.05,0.3,55], ["Beaver","Rare",10,30,60], ["Blobfish","Rare",2,20,50],
  ["Bull Frog","Rare",0.2,0.8,48], ["Coelacanth","Rare",15,180,75], ["Flying Fish","Rare",1,5,42], ["Frog Fish","Rare",0.1,1,50],
  ["Goldfish","Rare",0.5,2,45], ["Koi Carp","Rare",2,35,55], ["Lamprey","Rare",0.5,5,52], ["Mekong Catfish","Rare",50,300,75],
  ["Nurse Shark","Rare",50,150,70], ["Plant Fish","Rare",0.1,0.5,42], ["Platypus","Rare",1,3,65], ["Ribbon Moray","Rare",5,40,60],
  ["Snapping Turtle","Rare",5,35,58], ["Softshell Turtle","Rare",3,25,55], ["Stingray","Rare",10,800,65], ["Thats A Huge Mouth Bass","Rare",5,50,68],
  ["American Alligator","Epic",200,1000,200], ["Arowana","Epic",3,20,110], ["Betta","Epic",0.01,0.05,45], ["Blue Lobster","Epic",1,9,120],
  ["Fried Egg Jellyfish","Epic",5,35,95], ["Goliath Tigerfish","Epic",15,70,150], ["Hammer Shark","Epic",500,1200,165], ["Horseshoe Crab","Epic",2,10,100],
  ["Lais Tembiring","Epic",5,50,120], ["Lion Fish","Epic",1,5,85], ["Manta Ray","Epic",600,5000,200], ["Marlin","Epic",100,1800,175],
  ["Mushroom Jellyfish","Epic",10,60,95], ["Octopus","Epic",5,150,110], ["Ogre Fish","Epic",20,100,130], ["Paddle Fish","Epic",25,200,165],
  ["Pike","Epic",5,55,100], ["Piranha","Epic",0.5,4,85], ["Sun Fish","Epic",500,5000,190], ["Swamp Chimera","Epic",50,500,180],
  ["Swamp Pupper","Epic",5,30,90], ["The Largest Mouth Bass","Epic",10,100,175], ["Tiger Shark","Epic",200,1400,180], ["Wels Catfish","Epic",50,300,190],
  ["Whale Shark","Epic",15000,40000,220], ["Anaconda","Legendary",100,550,500], ["Arapaima","Legendary",100,440,600], ["Cthulhu","Legendary",50000,200000,1000],
  ["Definitely not Catfish","Legendary",50,300,750], ["Dipterus","Legendary",5,40,800], ["Giant Squid","Legendary",600,1500,750], ["Golden Goldfish","Legendary",2,8,500],
  ["Kappa","Legendary",50,200,900], ["Kelpie","Legendary",200,1000,850], ["Lofee Bean Can","Legendary",50,300,18], ["Lush Witch","Legendary",30,150,950],
  ["Marlin's Boot","Legendary",50,300,20], ["Megalodon","Legendary",50000,120000,900], ["Mermaid","Legendary",110,170,900], ["Mermaid?","Legendary",100,180,800],
  ["Nyarlathotep","Legendary",1000,50000,1000], ["Ocean Man","Legendary",150,250,750], ["Ogre King","Legendary",500,3000,900], ["Oh Boy Thats A Big Bass","Legendary",100,500,750],
  ["Phantom Jellyfish","Legendary",10,100,500], ["Pink Canny","Legendary",50,300,60], ["Snapping Dragon","Legendary",200,2000,850], ["Sperm Whale","Legendary",25000,125000,800],
  ["Swamp Monster","Legendary",5000,50000,950], ["White Lobster","Legendary",1,15,400], ["White Steel Eel","Legendary",10,100,700], ["Barreleye Fish","Secret",1,5,1500],
  ["Billy Bass","Secret",1,5,2500], ["Black Seadevil Anglerfish","Secret",0.05,1,1500], ["Devil's Hole Pupfish","Secret",0.01,0.02,2000], ["Ghost Shark","Secret",1,16,1750],
  ["Goblin Shark","Secret",23,210,1500], ["Gulper Eel","Secret",2,10,1500], ["Red Handfish","Secret",0.04,0.1,1500], ["Bobbit Worm","Halloween",10,100,100],
  ["Nessie","Halloween",1000,10000,180], ["Siren","Halloween",100,200,150], ["Skeleton Fish","Halloween",1,10,60], ["The Great Angler","Halloween",500,5000,200],
  ["Vampire Squid","Halloween",5,30,75], ["Fish-Deer","Christmas",50,200,180], ["Garden Eel","Christmas",2,15,100], ["Narwhal","Christmas",800,3500,250],
  ["Ornated Jelly Fish","Christmas",5,30,150], ["Pinecone Fish","Christmas",1,5,75], ["Walrus","Christmas",500,1500,200]
];
  // </species-catalogue>

  const TIER_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas'];
  const LOG_KEY = 'autofish:log:v1';
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
    return { v: 1, createdAt: at, updatedAt: at, total: 0, shiny: 0, golden: 0, species: {}, rarity, days: {}, last: null };
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
    if (e.shiny) book.shiny = (book.shiny || 0) + 1;
    if (e.golden) book.golden = (book.golden || 0) + 1;
    const key = logDay(at);
    const day = book.days[key] || (book.days[key] = { n: 0, rarity: {} });
    day.n += 1;
    day.rarity[e.rarity] = (day.rarity[e.rarity] || 0) + 1;
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
      last: book.last || null,
      today: { day: key, n: today.n || 0, byRarity: TIER_ORDER.map((tier) => ({ rarity: tier, n: today.rarity[tier] || 0 })) },
      updatedAt: book.updatedAt || null,
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
    try { raw = window.localStorage.getItem(LOG_KEY); } catch (e) { raw = null; }
    if (!raw) return (ledger = emptyLog());
    try {
      const parsed = JSON.parse(raw);
      ledger = parsed && parsed.v === 1 && parsed.species && parsed.rarity ? parsed : emptyLog();
    } catch (e) { ledger = emptyLog(); }
    return ledger;
  }
  function saveLedger(book) {
    ledger = book;
    try { window.localStorage.setItem(LOG_KEY, JSON.stringify(book)); return true; } catch (e) { return false; }
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
  function surfaces() {
    const cans = [...document.querySelectorAll('canvas')];
    const app = window.__PIXI_DEVTOOLS__ && window.__PIXI_DEVTOOLS__.app;
    gameCanvas = app ? app.renderer.canvas : cans[0];
    uiCanvas = cans.find((c) => c !== gameCanvas) || cans[1] || cans[0];
  }

  let ubuf = null, uctx = null;
  /** Read the UI layer. Must be called from inside a rAF callback. */
  function readUI(x, y, w, h) {
    if (!uiCanvas || !uiCanvas.width || !uiCanvas.isConnected) surfaces();
    // The SPA can drop its canvases for a moment (route change, soft reload). Reporting "nothing
    // drawn" is correct there; touching a missing canvas would throw on every frame and the
    // panel would read a burst of errors as a broken session and stop it.
    if (!uiCanvas || !uiCanvas.width) return null;
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
  /** The CAST!/REEL! bubble: a white rounded prompt, clearly wider than it is tall. */
  const BOX_BUBBLE = { x: 690, y: 215, w: 360, h: 210 };
  function bubbleInBox() {
    const r = readUI(BOX_BUBBLE.x, BOX_BUBBLE.y, BOX_BUBBLE.w, BOX_BUBBLE.h);
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
  }

  /* -------------------------------------------------- adaptive search ---- */
  /**
   * The prompts hang off the play area, not the window: the bubble floats above the player and
   * slides with the camera, so a fixed box only fits the window and camera position it was
   * measured at. When the box misses, look for the same shapes anywhere on the UI layer, using a
   * single 1/4-scale read of the whole surface. Both searches stop at "not found" and return null,
   * so a resized window degrades to doing nothing rather than tapping blind.
   */
  const SDOWN = 4;
  let sbuf = null, sctx = null, sdata = null, sw = 0, sh = 0;

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
    sdata = sctx.getImageData(0, 0, w, h).data;
    sw = w; sh = h;
    return true;
  }

  function spx(p) {
    const i = p * 4;
    return [sdata[i], sdata[i + 1], sdata[i + 2], sdata[i + 3]];
  }

  /** 4-connected components on the downscaled surface: bbox and pixel count per blob. */
  function blobs(match, minPx) {
    const total = sw * sh, seen = new Uint8Array(total), out = [];
    for (let p0 = 0; p0 < total; p0++) {
      if (seen[p0] || !match(spx(p0))) continue;
      const stack = [p0];
      seen[p0] = 1;
      let x0 = sw, y0 = sh, x1 = 0, y1 = 0, count = 0;
      while (stack.length) {
        const p = stack.pop(), x = p % sw, y = (p / sw) | 0;
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        const near = [x > 0 ? p - 1 : -1, x < sw - 1 ? p + 1 : -1, y > 0 ? p - sw : -1, y < sh - 1 ? p + sw : -1];
        for (let k = 0; k < 4; k++) {
          const q = near[k];
          if (q < 0 || seen[q] || !match(spx(q))) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      if (count >= minPx) out.push({ x0, y0, x1, y1, count });
    }
    return out;
  }

  const WHT_S = (c) => c[3] > 120 && c[0] >= 225 && c[1] >= 225 && c[2] >= 225;
  const CREAM = (c) => c[3] > 60 && c[0] > 225 && c[1] > 200 && c[2] > 130 && c[2] < 238;

  /** Dark glyphs on a white field — what separates a prompt from any other white blob. */
  function inkMix(r) {
    let dark = 0, white = 0, n = 0;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const c = PX(r, x + r.x, y + r.y);
        n++;
        if (c[3] > 120 && LU(c) < 150) dark++;
        if (WHT(c)) white++;
      }
    }
    return n ? { dark: dark / n, white: white / n } : { dark: 0, white: 0 };
  }

  let promptAt = 0;
  function bubbleAnywhere() {
    const t = now();
    if (t - promptAt < 200) return null;          // the scan is throttled; between runs report nothing
    promptAt = t;
    if (F.geo) return null;                       // a dial on screen means the prompt is already gone
    if (!downscale()) return null;
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
      const cand = { cx: Math.round(x + W / 2), cy: Math.round(y + H / 2), w: W, h: H, n: b.count * SDOWN * SDOWN };
      if (!best || cand.n > best.n) best = cand;
    }
    if (best) L('bubble anywhere', { cx: best.cx, cy: best.cy, w: best.w, h: best.h });
    return best;
  }

  F.findBubble = function () {
    return bubbleInBox() || bubbleAnywhere();
  };

  /**
   * The catch card: a parchment panel that blocks the next cast until it is tapped away.
   * It is drawn on the same UI layer, so it is found by colour and area - a cream fill over a
   * wide centre rect. The dial cannot trip this: it covers well under the 45% threshold.
   */
  const BOX_CARD = { x: 620, y: 315, w: 365, h: 405 };
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
    const r = readUI(BOX_CARD.x, BOX_CARD.y, BOX_CARD.w, BOX_CARD.h);
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
  function cardByShape() {
    const t = now();
    if (t - shapeAt < 400) return null;
    shapeAt = t;
    if (!downscale()) return null;
    const stride = sw + 1;
    const I = new Int32Array(stride * (sh + 1));
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

  F.findCatch = function () {
    return cardInBox() || cardByShape();
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
    const info = describeCatch(rec);
    // The card prints a rarity word only for non-common fish. Fill the blank from the catalogue
    // and carry the source, never a pixel guess.
    if (!rec.rarity) rec.rarity = info.rarity;
    const row = Object.assign({ t: Date.now(), frac: card && card.frac }, rec);
    row.rarity = info.rarity;
    row.raritySource = info.derived ? 'catalogue' : 'card';
    row.shiny = info.shiny;
    F.catches.push(row);
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
    const omega = fit ? fit.omega : null;
    geo._mid = mid; geo._mt = tNow; geo._om = omega; geo._fit = fit;

    // Signed distance from the wedge midpoint to the pin: 0 means aligned.
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

  function doPress(s, how) {
    if (!F.opts.press || !F.geo) return;
    const via = F.opts.pressWith === 'space' ? 'space' : 'pointer';
    if (via === 'space') space(F.opts.spaceTarget);
    else tap(F.geo.cx, F.geo.cy);
    F.armed = false;
    // The game answers a press by spawning a fresh triangle in the same widget, so the wedge
    // jumps. Drop the rotation history: a fit that straddles the jump would invent a wild rate.
    if (F.geo && F.geo._hist) F.geo._hist.length = 0;
    F.pressStamp = s ? { delta: s.delta, width: s.width, t: s.t != null ? s.t : now() } : null;
    F.dialBlinks = 0;
    F.lastPress = now();
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
    const last = F.dialLastPress;
    const sincePress = last ? Math.round(t - last.t) : null;
    const hitMs = F.opts.hitMs || 1500;
    // A dial the bot never pressed that stayed up long enough to be real is a LOST FISH, not the
    // ring fading after a solved one: those fade in ~100 ms.
    // A locked ring that never rotated is the fade-out of a solved dial or a ripple, not a fish:
    // its wedge sits still (omega 0) and no press is ever due. Count it apart so the loss tally
    // stays honest.
    const ghost = presses === 0 && (F.dialTravel || 0) < 15;
    const skipped = !ghost && presses === 0 && heldMs >= (F.opts.skipMs || 300);
    const verdict = ghost ? 'ghost'
      : presses === 0 ? (skipped ? 'skipped' : 'no-press')
      : (sincePress != null && sincePress <= hitMs ? 'hit' : 'miss');
    F.stats.dialsClosed++;
    F.stats[verdict === 'hit' ? 'hits' : verdict === 'miss' ? 'misses' : verdict === 'ghost' ? 'ghosts' : verdict === 'skipped' ? 'skipped' : 'noPress']++;
    if (skipped && F.attempt) F.attempt.skipped++;
    const rec = {
      heldMs, presses, verdict, sincePress,
      width: Math.round((F.geo && F.geo.width) || 0),
      omega: last && last.omega != null ? Math.round(last.omega) : null,
      biasMs: last ? last.biasMs : null,
      reasons: F.geoReasons || null,
      arm: F.dialArm || null,
      trace: F.geoReasons && !(verdict === 'hit') ? F.geoTrace.slice() : null,
    };
    if (last && last.omega != null) rec.omega = Math.round(last.omega);
    F.outcomes.push(rec);
    while (F.outcomes.length > 400) F.outcomes.shift();
    if (verdict !== 'no-press' && last && last.biasMs != null) {
      const key = last.biasMs;
      const cell = F.sweep[key] || (F.sweep[key] = { biasMs: key, presses: 0, hits: 0, misses: 0, wins: 0, losses: 0 });
      cell.presses++;
      if (verdict === 'hit') cell.hits++; else cell.misses++;
    }
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
    if (F.pendingWin && F.pendingWin.timer) clearTimeout(F.pendingWin.timer);
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
      relockGraceMs: 450,           // hold a dial's geometry this long after a press (the ring blinks)
      maxPressPerDial: 12,          // safety cap on presses per dial lock (one per rotation is normal)
      hitMs: 1500,                  // a press the game acts on ends the dial within this
      skipMs: 300,                  // an unpressed dial that lived this long lost a fish (fades are ~100 ms)
      attemptIdleMs: 25000,         // an attempt with no dial and no press this long is over
      sweep: null,                  // e.g. { min: -60, max: 60, step: 15 } - one probe per press
      ab: null,                     // { arms: [{name:'contain',trigger:'contain'},{name:'angle',trigger:'angle',midDeg:6}] } - one arm per FISH
      bubbleDebounceMs: 900,
      castRetryMs: 5000,            // nothing has happened this long: cast with the game's own keybind
      lossGraceMs: 2500,            // a cast prompt right after a press may still be a win landing
      dialCheckMs: 120,
      maxMinutes: 240,
    }, opts || {});
    surfaces();
    F.stats = {
      bubbles: 0, dials: 0, presses: 0, dialsClosed: 0,
      hits: 0, misses: 0, noPress: 0,
      attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0, skipped: 0, ghosts: 0,
      frames: 0, errors: 0, cards: 0,
      shapeHits: 0,
    };
    F.arms = {}; F.dialArm = null; F.armCfg = null; F.attempt = null; F.attempts = [];
    F.geo = null; F.hint = { x: 861, y: 372 }; F.catches = []; F.logUrl = (opts && opts.logUrl) || 'http://127.0.0.1:8731/catch';
    F.txtAt = now(); F.cardWait = null;                        // only text drawn from here on counts
    F.armed = true; F.lastPress = 0; F.lastDialCheck = 0; F.bad = 0;
    F.pressStamp = null; F.dialBlinks = 0;
    F.pend = null; F.outcomes = []; F.sweep = {}; F.bands = {}; F.dialLastPress = null;
    F.geoTrace = []; F.geoReasons = {}; F.planReason = null;
    clearPendingWin();
    F.paused = false; F.lastBubble = null; F.lastCardRect = null;
    F.pressesThisDial = 0; F.pressesAtThisDial = 0;
    F.running = true; F.startedAt = now(); F.hiddenPauses = 0;
    L('start', { opts: F.opts, ui: !!uiCanvas, game: !!gameCanvas });
    if (!F._raf) F._raf = requestAnimationFrame(loop);
    return F.status();
  };

  F.stop = function () {
    F.running = false;
    cancelPend();
    clearPendingWin();
    if (F.attempt) { L('attempt abandoned', { n: F.attempt.n, presses: F.attempt.presses }); F.attempt = null; }
    if (F._raf) cancelAnimationFrame(F._raf);
    F._raf = null;
    L('stop', { stats: F.stats });
    return F.status();
  };

  /** Hold the loop where it is without ending the session: no presses until resume(). */
  F.pause = function () {
    F.paused = true;
    cancelPend();
    clearPendingWin();
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
    F.stats = {
      bubbles: 0, dials: 0, presses: 0, dialsClosed: 0,
      hits: 0, misses: 0, noPress: 0,
      attempts: 0, caught: 0, lost: 0, wins: 0, losses: 0, skipped: 0, ghosts: 0,
      frames: 0, errors: 0, cards: 0,
      shapeHits: 0,
    };
    F.arms = {}; F.dialArm = null; F.armCfg = null; F.attempt = null; F.attempts = [];
    F.sweep = {};
    F.bands = {};
    clearPendingWin();
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

  /**
   * Ask for one PNG of the UI layer on the next animation frame. The panel posts it to fishserve so
   * a run that never sees a prompt can be diagnosed from the pixels the bot actually looked at,
   * instead of from guesses about what went wrong.
   */
  F.captureUI = function () { F._shot = null; F._shotWanted = true; return true; };

  function loop() {
    if (!F.running) { F._raf = null; return; }
    F._raf = requestAnimationFrame(loop);
    // Inside rAF, before compositing, is the only moment the UI layer's buffer is still readable.
    if (F._shotWanted && uiCanvas) {
      F._shotWanted = false;
      try { F._shot = uiCanvas.toDataURL('image/png'); } catch (e) { F._shot = 'ERR ' + ((e && e.message) || e); }
    }
    try { step(); } catch (e) { F.stats.errors++; L('error', { e: String((e && e.message) || e) }); }
  }

  function step() {
    const t = now();
    F.stats.frames++;
    if (document.visibilityState !== 'visible') { F.hidden = true; return; }
    if (F.hidden) { F.hidden = false; F.hiddenPauses++; }
    if (F.paused) return;
    if (t - F.startedAt > F.opts.maxMinutes * 60000) { L('maxMinutes'); F.stop(); return; }
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
    if (!F.geo && t - (F.lastCard || 0) > 1500) {
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
    if (F.pendingWin && t - (F.cardScan || 0) > 120) {
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
        F.dialBlinks = (F.dialBlinks || 0) + 1;
        if (++F.bad > 3) {
          // A successful press animates the ring away for a few frames, then the next triangle
          // appears in the same widget. Dropping the lock there cost a re-lock scan plus a lock
          // on the fading ring, ~300 ms per press. Hold the geometry briefly instead.
          if (F.pressesThisDial > 0 && t - F.lastPress < (F.opts.relockGraceMs || 450)) return;
          cancelPend();
          closeDial(t, s && s.ring);
          F.geo = null; F.bad = 0; F.pressesThisDial = 0;
        }
        return;
      }
      F.bad = 0;
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
      // Re-arm once the wedge has left the window: one rotation gets one press, and a new
      // triangle on the same dial is pressed on its next rotation. The earlier 'one press per
      // dial' rule assumed a press solved the fish; it does not - a fish is many triangles, so
      // that rule forced a full dial close plus re-lock for every single press and starved slow
      // dials. The cap only guards against a runaway if the game stops accepting input.
      if (F.pressesThisDial < (F.opts.maxPressPerDial || 12) &&
          Math.abs(plan.delta) > plan.win + 12 &&
          newTriangle(F.pressStamp, s, F.dialBlinks, F.opts)) F.armed = true;
      if (plan.cancel) cancelPend();
      if (plan.armAt != null) armPress(plan.armAt, F.geo, s);
      if (plan.press) doPress(s, 'frame');
      return;
    }

    // 3. nothing on screen: look for a dial now and then (cheap enough at ~4 Hz)
    if (t - F.lastDialCheck > F.opts.dialCheckMs) {
      F.lastDialCheck = t;
      const g = F.lockDial(F.hint.x, F.hint.y);
      if (g) {
        F.geo = g; F.geoAt = t; F.bad = 0; F.pressesThisDial = 0; F.pressStamp = null; F.dialBlinks = 0;
        F.geoReasons = {}; F.planReason = null; F.geoTrace = []; F.dialMaxOmega = 0; F.dialTravel = 0; F.dialPrevDelta = null;
        F.stats.dials++;
        // One arm per FISH, not per dial. A fish is 5-7 dials of the same minigame, so alternating
        // dialect by dial would put both arms inside one attempt and the A/B would compare nothing.
        if (!F.attempt) startAttempt(t);
        F.attempt.dials++;
        F.attempt.touched = t;
        F.attempt.pendingLoss = null;
        L('dial locked', { cx: g.cx, cy: g.cy, R: g.R, width: Math.round(g.width), arm: F.dialArm, attempt: F.attempt.n });
      }
    }

    // 4. Cast recovery. The cast control is a small bubble, and the caught-indicator is the same
    // shape, so the shape detector sometimes taps an indicator that is not a button - after which
    // nothing at all happens and the run silently stops fishing (observed: 60+ s of no dial and no
    // press while frames kept advancing). The game's own fishing keybind casts whenever its cast
    // button is visible and is ignored while chat has focus, so it is a safe fallback.
    if (F.opts.castRetryMs && t - Math.max(F.lastPress || 0, F.geoAt || 0, F.lastBubbleAt || 0, F.lastCastTry || 0, F.startedAt) > F.opts.castRetryMs) {
      F.lastCastTry = t;
      F.stats.castRetries = (F.stats.castRetries || 0) + 1;
      const consumed = !space(F.opts.spaceTarget);
      L('cast retry', { consumed });
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
    const band = omegaBand(a.maxOmega || null);
    const b = F.bands[band] || (F.bands[band] = { band, attempts: 0, caught: 0, lost: 0, presses: 0 });
    b.attempts++; b[key]++; b.presses += a.presses;
    if (a.arm) {
      const c = F.arms[a.arm] || (F.arms[a.arm] = { arm: a.arm, attempts: 0, caught: 0, lost: 0, presses: 0, dials: 0 });
      c.attempts++; c[key]++; c.presses += a.presses; c.dials += a.dials;
    }
    F.attempts.push(a);
    while (F.attempts.length > 200) F.attempts.shift();
    L(verdict === 'caught' ? 'attempt caught' : 'attempt lost', {
      n: a.n, ms: a.ms, presses: a.presses, dials: a.dials, skipped: a.skipped,
      arm: a.arm, band, why: a.why, species: a.species || null,
    });
    return a;
  }

  /* ------------------------------------------------------- reporting ----- */
  F.status = function () {
    const book = loadLedger();
    // Callable before the first start(): the panel and the chip both poll it while idle, and a
    // status() that throws blanks the whole HUD.
    const s = F.stats || {};
    return {
      running: !!F.running,
      paused: !!F.paused,
      catchCount: F.catches ? F.catches.length : 0,
      hidden: !!F.hidden,
      geo: F.geo ? { cx: F.geo.cx, cy: F.geo.cy, R: F.geo.R, width: F.geo.width && Math.round(F.geo.width) } : null,
      hint: F.hint,
      stats: F.stats || {},
      accuracy: {
        attempts: s.attempts || 0, caught: s.caught || 0, lost: s.lost || 0,
        presses: s.presses || 0, shapeHits: s.shapeHits || 0,
        openAttempt: F.attempt ? { n: F.attempt.n, presses: F.attempt.presses } : null,
      },
      pressesThisDial: F.pressesThisDial,
      pendingMs: F.pend ? Math.round(F.pend.at - now()) : null,
      ledger: { total: book.total || 0, species: Object.keys(book.species || {}).length, shiny: book.shiny || 0 },
      logTail: F.events.slice(-8),
    };
  };

  /**
   * Hit rate per probe offset. A miss costs the dial - it spins out its ~15.9 s timeout - so
   * a sweep is a slow calibration pass, not a normal mode. Run it with press:true only.
   */
  F.sweepReport = function () {
    return Object.keys(F.sweep)
      .map((k) => F.sweep[k])
      .sort((a, b) => a.biasMs - b.biasMs)
      .map((r) => ({
        biasMs: r.biasMs, presses: r.presses, hits: r.hits, misses: r.misses,
        wins: r.wins || 0, losses: r.losses || 0,
        hitRate: r.presses ? +(r.hits / r.presses).toFixed(2) : null,
        winRate: r.wins + (r.losses || 0) ? +((r.wins || 0) / (r.wins + (r.losses || 0))).toFixed(2) : null,
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

  /**
   * The honesty layer. A "win" here means a parsed catch card, nothing else: shape hits are
   * counted separately because they were once mistaken for wins and produced a 100% hit rate
   * against 2 real fish.
   */
  F.accuracy = function () {
    const s = F.stats || {};
    const presses = s.presses || 0;
    const caught = (F.attempts || []).filter((a) => a.verdict === 'caught').length;
    const lost = (F.attempts || []).filter((a) => a.verdict === 'lost').length;
    return {
      attempts: (F.attempts || []).length, caught, lost,
      catchRate: caught + lost ? +(caught / (caught + lost)).toFixed(3) : null,
      presses, pressesPerCatch: caught ? +(presses / caught).toFixed(2) : null,
      openAttempt: F.attempt ? { n: F.attempt.n, presses: F.attempt.presses, dials: F.attempt.dials, ms: Math.round(now() - F.attempt.startedAt) } : null,
      shapeHits: s.shapeHits || 0,
      byBand: F.bandReport(), byArm: F.armReport(),
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
  /** The same ledger as one CSV row per species (paste it anywhere). */
  F.logCsv = function () {
    return logCsv(loadLedger());
  };
  /** Wipe the local catch history. fishserve's own CSVs are untouched. */
  F.logReset = function () {
    saveLedger(emptyLog());
    return true;
  };

  F.report = function () {
    return {
      version: F.version, accuracy: F.accuracy(), stats: F.stats, opts: F.opts,
      sweep: F.sweepReport(), bands: F.bandReport(), outcomes: F.outcomes.slice(-60),
      attempts: (F.attempts || []).slice(-40),
      log: F.events.slice(-250),
      catchLog: F.log(),
    };
  };

  /** The timing maths, exposed so a live console can re-plan against a captured dial. */
  F.timing = { wrap180, fitOmega, planPress, sweepBias, omegaBand, cardShapeOk, newTriangle };

  /** The embedded species table, for a console that wants to check a rarity by hand. */
  F.catalogue = { count: SPECIES.length, tiers: TIER_ORDER.slice(), info: speciesInfo, describe: describeCatch };

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

/* session.js — pure session state machine for the AutoFish panel.
 * No DOM, no timers, no I/O: the panel feeds facts in and executes the actions out.
 * Browser global: AutoFishSession. CommonJS: require('./session.js').
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    durationMs: 60 * 60 * 1000,
    cooldownMs: 30 * 60 * 1000,
    dailyCapMs: 4 * 60 * 60 * 1000,
    window: { on: false, start: '21:00', stop: '23:00' }
  };

  function createState(overrides) {
    var s = {
      phase: 'idle',
      durationMs: DEFAULTS.durationMs,
      cooldownMs: DEFAULTS.cooldownMs,
      dailyCapMs: DEFAULTS.dailyCapMs,
      window: { on: DEFAULTS.window.on, start: DEFAULTS.window.start, stop: DEFAULTS.window.stop },
      fishingMs: 0,
      todayMs: 0,
      startedAt: null,
      lastTickAt: null,
      pauseReason: null,
      hiddenSince: null,
      visibleSince: null,
      retryAt: null,
      retries: 0,
      cooldownUntil: null,
      lastCatchAt: null,
      catchCount: 0,
      errWindowAt: null,
      errCount: 0,
      errTotal: 0,
      stopReason: null
    };
    if (overrides) {
      for (var k in overrides) {
        if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
        if (k === 'window') {
          s.window = { on: !!overrides.window.on, start: overrides.window.start, stop: overrides.window.stop };
        } else {
          s[k] = overrides[k];
        }
      }
    }
    return s;
  }

  function clone(state) {
    var s = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) s[k] = state[k];
    s.window = { on: state.window.on, start: state.window.start, stop: state.window.stop };
    return s;
  }

  function minutesOfDay(at) {
    var d = new Date(at);
    return d.getHours() * 60 + d.getMinutes();
  }

  function parseClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    if (!m) return 0;
    return (Number(m[1]) % 24) * 60 + Number(m[2]);
  }

  /** Is 'at' inside the configured clock window (local time)? A stop before start crosses midnight. */
  function withinWindow(win, at) {
    if (!win || !win.on) return true;
    var start = parseClock(win.start);
    var stop = parseClock(win.stop);
    var now = minutesOfDay(at);
    if (start === stop) return true;              // a 24h window, not an empty one
    if (start < stop) return now >= start && now < stop;
    return now >= start || now < stop;            // crosses midnight
  }

  function isActive(phase) {
    return phase === 'running' || phase === 'paused' || phase === 'waiting';
  }

  function stopSession(s, at, reason) {
    if (s.phase === 'running' && s.lastTickAt != null) s.fishingMs += Math.max(0, at - s.lastTickAt);
    s.phase = 'cooldown';
    s.cooldownUntil = at + s.cooldownMs;
    s.stopReason = reason || 'user';
    s.pauseReason = null;
    s.retryAt = null;
    s.lastTickAt = null;
    return [
      { type: 'stopCore' },
      { type: 'releaseWakeLock' },
      { type: 'sessionRow', reason: s.stopReason, minutes: Math.round(s.fishingMs / 60000), catches: s.catchCount },
      { type: 'persist' }
    ];
  }

  var NO_CATCH_MS = 10 * 60 * 1000;   // nothing bites for this long -> check the page
  var RETRY_DELAY_MS = 60 * 1000;
  var MAX_RETRIES = 3;
  var HIDDEN_PAUSE_MS = 5000;         // the game freezes while the tab is hidden
  var HIDDEN_STOP_MS = 120 * 1000;
  var RESUME_AFTER_MS = 3000;         // stay back this long before trusting the tab again
  var ERR_WINDOW_MS = 60 * 1000;
  var ERR_LIMIT = 20;

  function paused(s, at, reason) {
    s.phase = 'paused';
    s.pauseReason = reason;
    s.lastTickAt = null;
    s.visibleSince = null;
    if (reason === 'no-catch') s.retryAt = at + RETRY_DELAY_MS;
    var actions = [{ type: 'pauseCore' }];
    if (reason === 'hidden') actions.push({ type: 'releaseWakeLock' });
    actions.push({ type: 'persist' });
    return { state: s, actions: actions };
  }

  function runningAgain(s, at) {
    s.phase = 'running';
    s.pauseReason = null;
    s.retryAt = null;
    s.visibleSince = null;
    s.hiddenSince = null;
    s.lastTickAt = at;
    return { state: s, actions: [{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }] };
  }

  function tickPaused(s, at, fact) {
    if (typeof fact.todayMs === 'number') s.todayMs = fact.todayMs;
    var visible = fact.visible !== false;
    if (s.pauseReason === 'hidden') {
      if (!visible) {
        if (s.hiddenSince == null) s.hiddenSince = at;
        if (at - s.hiddenSince > HIDDEN_STOP_MS) return { state: s, actions: stopSession(s, at, 'hidden') };
        return { state: s, actions: [] };
      }
      if (s.visibleSince == null) { s.visibleSince = at; return { state: s, actions: [] }; }
      if (at - s.visibleSince >= RESUME_AFTER_MS) return runningAgain(s, at);
      return { state: s, actions: [] };
    }
    if (s.pauseReason === 'no-catch') {
      if (s.retryAt != null && at >= s.retryAt) {
        if (s.retries >= MAX_RETRIES) return { state: s, actions: stopSession(s, at, 'no-catch') };
        s.retries += 1;
        s.lastCatchAt = at;
        return runningAgain(s, at);
      }
    }
    return { state: s, actions: [] };
  }

  function reduce(state, fact) {
    var s = clone(state);
    var actions = [];
    // A fact without an explicit clock used to fall back to 0, which made the next real tick credit
    // (now - 0) milliseconds of fishing time and stop the session as a daily-cap hit. Fall back to
    // the wall clock instead; every caller that cares passes its own at.
    var at = Number(fact.at) || Date.now();

    if (fact.type === 'config') {
      var patch = fact.patch || {};
      for (var k in patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
        if (k === 'window') {
          s.window = {
            on: patch.window.on === undefined ? s.window.on : !!patch.window.on,
            start: patch.window.start === undefined ? s.window.start : patch.window.start,
            stop: patch.window.stop === undefined ? s.window.stop : patch.window.stop
          };
        } else {
          s[k] = patch[k];
        }
      }
      return { state: s, actions: [{ type: 'persist' }] };
    }

    if (fact.type === 'start') {
      if (isActive(s.phase)) return { state: s, actions: [] };
      if (s.cooldownUntil != null && at < s.cooldownUntil) {
        return { state: s, actions: [{ type: 'refuse', reason: 'cooldown' }] };
      }
      if (s.todayMs >= s.dailyCapMs) {
        return { state: s, actions: [{ type: 'refuse', reason: 'daily-cap' }] };
      }
      s.fishingMs = 0;
      s.catchCount = 0;
      s.retries = 0;
      s.retryAt = null;
      s.errCount = 0;
      s.errWindowAt = null;
      s.errTotal = 0;
      s.pauseReason = null;
      s.hiddenSince = null;
      s.visibleSince = null;
      s.stopReason = null;
      s.startedAt = at;
      s.lastTickAt = at;
      s.lastCatchAt = at;
      if (!withinWindow(s.window, at)) {
        s.phase = 'waiting';
        return { state: s, actions: [{ type: 'persist' }] };
      }
      s.phase = 'running';
      return {
        state: s,
        actions: [
          { type: 'startCore', maxMinutes: Math.ceil(s.durationMs / 60000) + 2 },
          { type: 'wakeLock' },
          { type: 'persist' }
        ]
      };
    }

    if (fact.type === 'stop') {
      if (!isActive(s.phase)) return { state: s, actions: [] };
      return { state: s, actions: stopSession(s, at, fact.reason) };
    }

    if (fact.type === 'resume') {
      if (s.phase !== 'paused') return { state: s, actions: [] };
      s.phase = 'running';
      s.pauseReason = null;
      s.lastTickAt = at;
      return { state: s, actions: [{ type: 'resumeCore' }, { type: 'wakeLock' }, { type: 'persist' }] };
    }

    if (fact.type === 'tick') {
      if (s.phase === 'cooldown') {
        if (s.cooldownUntil != null && at >= s.cooldownUntil) {
          s.phase = 'idle';
          s.cooldownUntil = null;
          return { state: s, actions: [{ type: 'persist' }] };
        }
        return { state: s, actions: [] };
      }
      if (s.phase === 'waiting') {
        if (withinWindow(s.window, at)) {
          s.phase = 'running';
          s.startedAt = at;
          s.lastTickAt = at;
          return {
            state: s,
            actions: [
              { type: 'startCore', maxMinutes: Math.ceil(s.durationMs / 60000) + 2 },
              { type: 'wakeLock' },
              { type: 'persist' }
            ]
          };
        }
        return { state: s, actions: [] };
      }
      if (s.phase === 'paused') return tickPaused(s, at, fact);
      if (s.phase !== 'running') return { state: s, actions: [] };

      var visible = fact.visible !== false;
      if (typeof fact.todayMs === 'number') s.todayMs = fact.todayMs;

      // 1. the game only runs while the tab is visible: a hidden stretch is not fishing time
      if (!visible) {
        if (s.hiddenSince == null) s.hiddenSince = at;
        s.lastTickAt = at;
        if (at - s.hiddenSince > HIDDEN_STOP_MS) return { state: s, actions: stopSession(s, at, 'hidden') };
        if (at - s.hiddenSince > HIDDEN_PAUSE_MS) return paused(s, at, 'hidden');
        return { state: s, actions: [] };
      }
      s.hiddenSince = null;

      if (s.lastTickAt != null) s.fishingMs += Math.max(0, at - s.lastTickAt);
      s.lastTickAt = at;

      // 2. catches (also the no-catch clock)
      if (typeof fact.catches === 'number') {
        if (fact.catches > s.catchCount) s.lastCatchAt = at;
        s.catchCount = fact.catches;
      }

      // 3. an error burst means the page changed under us
      if (typeof fact.errors === 'number') {
        var prevErr = s.errTotal || 0;
        if (fact.errors > prevErr) {
          if (s.errWindowAt == null || at - s.errWindowAt > ERR_WINDOW_MS) {
            s.errWindowAt = at;
            s.errCount = 0;
          }
          s.errCount += fact.errors - prevErr;
          if (s.errCount > ERR_LIMIT) return { state: s, actions: stopSession(s, at, 'errors') };
        }
        s.errTotal = fact.errors;
      }

      // 4. the clock window closing ends the session; 5. so does the daily cap
      if (s.window.on && !withinWindow(s.window, at)) {
        return { state: s, actions: stopSession(s, at, 'window') };
      }
      if (typeof fact.todayMs === 'number' && s.todayMs + s.fishingMs >= s.dailyCapMs) {
        return { state: s, actions: stopSession(s, at, 'daily-cap') };
      }

      // 6. duration
      if (s.fishingMs >= s.durationMs) {
        return { state: s, actions: stopSession(s, at, 'duration') };
      }

      // 7. nothing has bitten in a while
      var sinceCatch = at - (s.lastCatchAt == null ? s.startedAt : s.lastCatchAt);
      if (sinceCatch > NO_CATCH_MS) {
        if (s.retries >= MAX_RETRIES) return { state: s, actions: stopSession(s, at, 'no-catch') };
        return paused(s, at, 'no-catch');
      }
      return { state: s, actions: [] };
    }

    return { state: s, actions: [] };
  }

  return { DEFAULTS: DEFAULTS, createState: createState, reduce: reduce, withinWindow: withinWindow, parseClock: parseClock };
});

/* layout.js — where the panel may sit so it never covers the fishing UI.
 * Pure geometry: no DOM. Browser global AutoFishLayout, CommonJS require('./layout.js').
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MARGIN = 12;

  function inflate(rect, by) {
    if (!rect) return null;
    return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
  }

  /** Strict overlap: rects that only share an edge do not intersect. */
  function intersects(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function unionRect(rects) {
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
   */
  function place(opts) {
    var size = { w: opts.panel.w, h: opts.panel.h };
    var viewport = opts.viewport;
    var margin = opts.margin == null ? MARGIN : opts.margin;
    // The game draws a HUD strip along the top; corners start below it so the panel does not cover
    // controls the player still needs to click.
    var topInset = opts.topInset || 0;
    var top = margin + topInset;
    var exclude = opts.exclude || null;

    if (size.w + margin * 2 > viewport.w || size.h + margin * 2 > viewport.h) return 'pill';

    var right = viewport.w - size.w - margin;
    var bottom = viewport.h - size.h - margin;
    // Top-left first: the game's coin and upgrade controls live in the top-right strip, and the
    // panel swallows pointer events, so parking over them would make them unclickable.
    var corners = [
      { x: margin, y: top },
      { x: margin, y: bottom },
      { x: right, y: bottom },
      { x: right, y: top }
    ];

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

/* panel.js — the AutoFish control panel, injected into the lofi.town page.
 *
 * Loaded by the bookmarklet (or the userscript) from fishserve. It pulls autofish.js, session.js
 * and layout.js from the same server if they are not already on the page, then renders a
 * shadow-DOM HUD that owns the session: start/stop, length, clock window, guards, wake lock.
 *
 * Nothing here talks to the game except through window.__fish.
 */
(function () {
  'use strict';

  if (window.__panel && window.__panel.mounted) return;

  // The server that served this file is the server we talk to. Deriving it from our own
  // <script src> means the bookmarklet can point at any port (WSL forwards Windows localhost
  // into the distro, and 8731 may already be taken on the Windows side).
  var BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) { try { return new URL(s.src).origin; } catch (e) { /* fall through */ } }
    return 'http://127.0.0.1:8731';
  })();
  var PREF_KEY = 'autofish.prefs';
  var POS_KEY = 'autofish.panel';
  var LIVE_KEY = 'autofish.live';
  var TICK_MS = 1000;

  var state = null;
  var baseTodayMs = 0;        // fishing minutes already logged today before this session
  var banner = '';
  var tickTimer = null;
  var placeTimer = null;
  var heartbeatAt = 0;
  var diagSent = false;       // one UI frame per session, when a run never sees a prompt
  var diagAt = 0;
  var wakeSentinel = null;
  var dragged = null;         // {x, y} once the user moved the panel
  var dragging = null;
  var collapsed = false;
  var host = null;
  var root = null;
  var ui = {};

  /* ------------------------------------------------------------- deps ----- */

  function loadScript(name, url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = BASE + url + '?t=' + Date.now();
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('cannot load ' + url)); };
      document.head.appendChild(s);
    });
  }

  async function deps() {
    if (!window.__fish) await loadScript('autofish', '/autofish.js');
    if (!window.AutoFishSession) await loadScript('session', '/session.js');
    if (!window.AutoFishLayout) await loadScript('layout', '/layout.js');
  }

  /* ------------------------------------------------------------ prefs ----- */

  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function loadPrefs() {
    var p = readJSON(PREF_KEY, {});
    var prefs = {};
    ['durationMs', 'cooldownMs', 'dailyCapMs'].forEach(function (k) {
      if (typeof p[k] === 'number') prefs[k] = p[k];
    });
    if (p.window && p.window.start && p.window.stop) {
      prefs.window = { on: !!p.window.on, start: p.window.start, stop: p.window.stop };
    }
    prefs.resumeAfterReload = !!p.resumeAfterReload;
    return prefs;
  }

  function savePrefs() {
    writeJSON(PREF_KEY, {
      durationMs: state.durationMs,
      cooldownMs: state.cooldownMs,
      dailyCapMs: state.dailyCapMs,
      window: state.window,
      resumeAfterReload: !!window.__panel.resumeAfterReload
    });
  }

  /* ------------------------------------------------------------ server ---- */

  function dayKey(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    d = d || new Date();
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  async function loadToday() {
    try {
      var r = await fetch(BASE + '/sessions?day=' + dayKey(), { cache: 'no-store' });
      var j = await r.json();
      baseTodayMs = (j.minutes || 0) * 60000;
    } catch (e) { baseTodayMs = 0; }
  }

  function postSessionRow(reason, minutes, catches) {
    try {
      fetch(BASE + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ started_at: new Date(state.startedAt || Date.now()).toISOString(), minutes: minutes, catches: catches, reason: reason })
      }).then(function (r) { if (!r.ok) banner = 'session log rejected the row'; }).catch(function () { banner = 'session log offline — the session still works'; });
    } catch (e) { banner = 'session log offline — the session still works'; }
  }

  /**
   * Send one PNG of the game's UI layer to the local server. A run that pastes in the game but never
   * reacts is almost always looking at the wrong pixels; with the frame on disk the detector can be
   * corrected from what the game actually drew instead of from guesses.
   */
  function captureDiag(note) {
    try {
      var f = fish();
      if (!f || !f.captureUI) { banner = 'this core cannot grab a frame'; return; }
      f.captureUI();
      setTimeout(function () {
        var shot = f._shot;
        if (typeof shot !== 'string' || shot.indexOf('data:image') !== 0) { banner = 'could not grab a frame to send'; return; }
        fetch(BASE + '/diag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: note, png: shot, stats: f.stats, viewport: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio })
        }).then(function (r) { banner = r.ok ? 'sent a game frame to ' + BASE + ' for diagnosis' : 'diagnosis upload was rejected'; })
          .catch(function () { banner = 'diagnosis upload failed (fishserve offline?)'; });
      }, 400);
    } catch (e) { banner = 'diagnosis failed: ' + ((e && e.message) || e); }
  }

  /* ---------------------------------------------------------- actions ----- */

  function fish() { return window.__fish; }

  var RUNNERS = {
    startCore: function (a) { fish().start({ maxMinutes: a.maxMinutes }); },
    stopCore: function () { try { fish().stop(); } catch (e) {} },
    pauseCore: function () { try { fish().pause(); } catch (e) {} },
    resumeCore: function () { try { fish().resume(); } catch (e) {} },
    wakeLock: function () { acquireWakeLock(); },
    releaseWakeLock: function () { releaseWakeLock(); },
    persist: function () { savePrefs(); writeHeartbeat(); },
    sessionRow: function (a) { postSessionRow(a.reason, a.minutes, a.catches); },
    refuse: function (a) {
      banner = a.reason === 'cooldown' ? 'cooling down — wait for the timer' : 'daily cap reached — no more fishing today';
    }
  };

  function apply(actions) {
    (actions || []).forEach(function (a) {
      var run = RUNNERS[a.type];
      if (run) { try { run(a); } catch (e) { banner = 'action ' + a.type + ' failed: ' + e.message; } }
    });
    render();
  }

  function dispatch(fact) {
    var out = window.AutoFishSession.reduce(state, fact);
    state = out.state;
    apply(out.actions);
    return out;
  }

  /* -------------------------------------------------------- wake lock ----- */

  async function acquireWakeLock() {
    if (!navigator.wakeLock) { banner = 'this browser cannot hold the screen awake'; return; }
    try {
      wakeSentinel = await navigator.wakeLock.request('screen');
      wakeSentinel.addEventListener('release', function () { wakeSentinel = null; });
    } catch (e) {
      wakeSentinel = null;
      banner = 'screen may sleep — the game freezes when it does';
    }
  }

  function releaseWakeLock() {
    if (wakeSentinel) { try { wakeSentinel.release(); } catch (e) {} wakeSentinel = null; }
  }

  /* --------------------------------------------------------- heartbeat ---- */

  function writeHeartbeat() {
    if (state.phase === 'running' || state.phase === 'paused' || state.phase === 'waiting') {
      writeJSON(LIVE_KEY, { startedAt: state.startedAt, phase: state.phase, minutes: Math.round(state.fishingMs / 60000), at: Date.now() });
    } else {
      try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
    }
  }

  function checkInterrupted() {
    var live = readJSON(LIVE_KEY, null);
    if (!live) return '';
    try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
    var minutes = typeof live.minutes === 'number' ? live.minutes : 0;
    postSessionRow('reload', minutes, 0);
    var resume = loadPrefs().resumeAfterReload;
    if (resume && state.window.on && window.AutoFishSession.withinWindow(state.window, Date.now())) {
      dispatch({ type: 'start', at: Date.now() });
      return 'session resumed after the reload';
    }
    return 'session interrupted by a reload — not resumed';
  }

  /* -------------------------------------------------------------- DOM ----- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  var CSS = [
    ':host{all:initial}',
    '.wrap{position:relative;font:12px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8ecef;user-select:none;-webkit-user-select:none}',
    '.card{width:264px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.45);backdrop-filter:blur(10px);overflow:hidden}',
    '.head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:rgba(255,255,255,.04);cursor:grab}',
    '.head:active{cursor:grabbing}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#5a6470;flex:none}',
    '.dot.running{background:#5ad18b;box-shadow:0 0 0 3px rgba(90,209,139,.18)}',
    '.dot.waiting{background:#f2c14e}.dot.paused{background:#f08a4b}.dot.cooldown{background:#7aa2f7}',
    '.title{font-weight:600;letter-spacing:.2px;flex:1}',
    '.chip{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#aab4bf;border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:1px 7px}',
    '.icon{border:0;background:transparent;color:#9aa4ae;font-size:14px;cursor:pointer;padding:2px 4px;border-radius:6px}',
    '.icon:hover{background:rgba(255,255,255,.08);color:#e8ecef}',
    '.body{padding:10px;display:flex;flex-direction:column;gap:9px}',
    '.row{display:flex;align-items:center;gap:6px}',
    '.label{flex:1;color:#aab4bf}',
    '.step{display:flex;align-items:center;gap:2px;background:rgba(255,255,255,.05);border-radius:9px;padding:2px}',
    '.step button{border:0;background:transparent;color:#cfd6dd;width:24px;height:22px;border-radius:7px;cursor:pointer;font-size:14px;line-height:1}',
    '.step button:hover{background:rgba(255,255,255,.10)}',
    '.step button:disabled{opacity:.3;cursor:default}',
    '.val{min-width:64px;text-align:center;font-variant-numeric:tabular-nums}',
    '.meters{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding-top:2px;border-top:1px solid rgba(255,255,255,.08)}',
    '.m{display:flex;justify-content:space-between;color:#9aa4ae}',
    '.m b{color:#e8ecef;font-weight:600;font-variant-numeric:tabular-nums}',
    '.primary{width:100%;border:0;border-radius:10px;padding:9px;font:inherit;font-weight:600;cursor:pointer;background:#2f7d5a;color:#eafff2}',
    '.primary.stop{background:#a33a3a;color:#ffecec}',
    '.primary:disabled{opacity:.45;cursor:default}',
    '.banner{font-size:11px;color:#f2c14e;background:rgba(242,193,78,.10);border-top:1px solid rgba(242,193,78,.22);padding:6px 10px}',
    '.banner:empty{display:none}',
    '.logbox{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}',
    '.strip{display:flex;gap:4px}',
    '.tier{flex:1;display:flex;flex-direction:column;align-items:center;line-height:1.25}',
    '.tier b{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}',
    '.tier span{font-size:8px;letter-spacing:.4px;text-transform:uppercase;color:#8b95a0}',
    '.last{font-size:10.5px;color:#9aa4ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pill{width:48px;height:48px;border-radius:14px;background:rgba(18,22,28,.94);border:1px solid rgba(255,255,255,.10);box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}',
    '.hide{display:none}'
  ].join('\n');

  // The eight rarity tiers the game uses, in ascending order. The strip shows all of them so an
  // empty tier reads as "none yet" instead of vanishing.
  var TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas'];
  var TIER_COLORS = {
    Common: '#aab4bf', Uncommon: '#7fd6a1', Rare: '#6cb6ff', Epic: '#b58cff',
    Legendary: '#f2c14e', Secret: '#ff8fa3', Halloween: '#ff9f5a', Christmas: '#8fe3e0'
  };

  function build() {
    ui = {};
    host = document.createElement('div');
    host.id = 'autofish-panel';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var wrap = el('div', 'wrap');
    var card = el('div', 'card');

    var head = el('div', 'head');
    var dot = el('div', 'dot');
    var title = el('div', 'title', 'AutoFish');
    var chip = el('div', 'chip', 'idle');
    var min = el('button', 'icon', '–');
    min.title = 'collapse';
    head.append(dot, title, chip, min);

    var body = el('div', 'body');

    body.append(
      stepperRow('Session', 'dur', 5, 240),
      stepperRow('Cooldown', 'cool', 5, 120),
      stepperRow('Daily cap', 'cap', 30, 480)
    );

    // clock window
    var winRow = el('div', 'row');
    var winLabel = el('div', 'label', 'Clock window');
    var winToggle = el('button', 'icon', 'off');
    winToggle.title = 'run only between two times';
    winRow.append(winLabel, winToggle);
    body.appendChild(winRow);

    var timeRow = el('div', 'row');
    timeRow.appendChild(stepper('from', 15));
    timeRow.appendChild(stepper('to', 15));
    body.appendChild(timeRow);

    var meters = el('div', 'meters');
    meters.append(
      meter('left'), meter('catches'), meter('presses'), meter('today')
    );
    body.appendChild(meters);

    // Catch history. The core writes it on every parsed catch; the panel only reads it, so a
    // reload of the game still shows yesterday's ledger.
    var logBox = el('div', 'logbox');
    var strip = el('div', 'strip');
    var tierCells = TIER_NAMES.map(function (name) {
      var cell = el('div', 'tier');
      var num = el('b', null, '0');
      var tag = el('span', null, name.slice(0, 3));
      cell.title = name + ' caught';
      cell.style.color = TIER_COLORS[name];
      cell.append(num, tag);
      strip.appendChild(cell);
      return { name: name, num: num };
    });
    var lastCatch = el('div', 'last', 'no catches yet');
    logBox.append(strip, lastCatch);
    body.appendChild(logBox);

    var primary = el('button', 'primary', 'Start');
    body.appendChild(primary);

    var bannerEl = el('div', 'banner');

    card.append(head, body, bannerEl);
    var pill = el('div', 'pill hide', '🎣');
    wrap.append(card, pill);
    root.appendChild(wrap);

    document.documentElement.appendChild(host);

    // stepperRow()/stepper()/meter() registered their pieces on ui as they built the DOM;
    // merge rather than replace, or every one of those references is lost.
    Object.assign(ui, {
      wrap: wrap, card: card, head: head, dot: dot, chip: chip, minBtn: min,
      winToggle: winToggle, timeRow: timeRow, primary: primary, banner: bannerEl, pill: pill,
      tierCells: tierCells, lastCatch: lastCatch
    });

    // stop the game seeing our clicks (bubble phase: our handlers already ran)
    ['pointerdown', 'pointerup', 'click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel'].forEach(function (type) {
      host.addEventListener(type, function (e) { e.stopPropagation(); }, false);
    });
    host.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    min.addEventListener('click', function () { setCollapsed(true); });
    pill.addEventListener('click', function () { setCollapsed(false); });
    primary.addEventListener('click', function () {
      if (state.phase === 'idle' || state.phase === 'cooldown') dispatch({ type: 'start', at: Date.now() });
      else dispatch({ type: 'stop', at: Date.now(), reason: 'user' });
    });
    winToggle.addEventListener('click', function () {
      dispatch({ type: 'config', at: Date.now(), patch: { window: { on: !state.window.on } } });
      savePrefs();
    });
    head.addEventListener('pointerdown', startDrag);

    restorePosition();
    render();
  }

  function meter(name) {
    var row = el('div', 'm');
    var label = el('span', null, name);
    var value = el('b', null, '—');
    row.append(label, value);
    ui['m' + name.charAt(0).toUpperCase() + name.slice(1)] = value;
    return row;
  }

  function stepperRow(labelText, key, min, max) {
    var row = el('div', 'row');
    var label = el('div', 'label', labelText);
    var box = el('div', 'step');
    var minus = el('button', null, '−');
    var val = el('div', 'val', '');
    var plus = el('button', null, '+');
    box.append(minus, val, plus);
    row.append(label, box);
    ui[key] = { val: val, minus: minus, plus: plus, min: min, max: max, key: key };
    bindStep(minus, plus, key, -1, 1);
    return row;
  }

  function stepper(labelText, minutes) {
    var label = el('div', 'val', '');
    var box = el('div', 'step');
    var minus = el('button', null, '−');
    var plus = el('button', null, '+');
    box.style.flex = '1';
    box.append(minus, label, plus);
    ui['time_' + labelText] = { val: label, minus: minus, plus: plus, which: labelText, step: minutes };
    bindClock(minus, plus, labelText, minutes);
    return box;
  }

  /** Press-and-hold with acceleration, so 5-minute steps can still cross an hour. */
  function bindStep(minus, plus, key, dl, dr) {
    var timer = null;
    var speed = 0;
    function apply(delta) {
      var conf = keyConf(key);
      var next = clamp(state[conf.field] + delta * conf.unit, conf.min, conf.max);
      if (next === state[conf.field]) return;
      var patch = {};
      patch[conf.field] = next;
      dispatch({ type: 'config', at: Date.now(), patch: patch });
      savePrefs();
    }
    function hold(delta) {
      apply(delta);
      speed = 0;
      timer = setInterval(function () {
        speed++;
        if (speed % 4 === 0) apply(delta);          // ~4x after a second of holding
      }, 60);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    [[minus, dl], [plus, dr]].forEach(function (pair) {
      var btn = pair[0], delta = pair[1];
      btn.addEventListener('pointerdown', function (e) { e.preventDefault(); hold(delta); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { btn.addEventListener(t, stop); });
    });
    // a release outside the button must stop the repeat too, or the value keeps climbing
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('pointercancel', stop, true);
  }

  // Ranges are for people who want to leave it fishing overnight: a 12 h session and a
  // 24 h daily cap are reachable, and the cooldown can go down to one minute. The cap is
  // still the thing that stops an abandoned tab from fishing for days.
  function keyConf(key) {
    if (key === 'dur') return { field: 'durationMs', min: 5 * 60000, max: 720 * 60000, unit: 5 * 60000 };
    if (key === 'cool') return { field: 'cooldownMs', min: 1 * 60000, max: 120 * 60000, unit: 1 * 60000 };
    return { field: 'dailyCapMs', min: 30 * 60000, max: 1440 * 60000, unit: 60 * 60000 };
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function parseClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : 0;
  }
  function clockText(minutesOfDay) {
    var m = ((minutesOfDay % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function bindClock(minus, plus, which, stepMinutes) {
    function nudge(delta) {
      var key = which === 'from' ? 'start' : 'stop';
      var next = clockText(parseClock(state.window[key]) + delta * stepMinutes);
      var patch = { window: { on: state.window.on, start: state.window.start, stop: state.window.stop } };
      patch.window[key] = next;
      dispatch({ type: 'config', at: Date.now(), patch: patch });
      savePrefs();
    }
    minus.addEventListener('click', function () { nudge(-1); });
    plus.addEventListener('click', function () { nudge(1); });
  }

  /* ------------------------------------------------------------ render ---- */

  function minutesText(ms) {
    var total = Math.max(0, Math.round(ms / 60000));
    if (total >= 60) return Math.floor(total / 60) + 'h ' + String(total % 60).padStart(2, '0');
    return total + ' min';
  }

  /**
   * The ledger is the panel's only real history: fill the rarity strip and the last-catch line.
   * Everything here is a read - a broken ledger must never make the panel throw.
   */
  function renderLog() {
    if (!ui.tierCells) return;
    var book = null;
    try { book = (fish() && fish().log) ? fish().log() : null; } catch (e) { book = null; }
    var byTier = {};
    (book && book.byRarity || []).forEach(function (r) { byTier[r.rarity] = r.n || 0; });
    ui.tierCells.forEach(function (cell) {
      var n = byTier[cell.name] || 0;
      cell.num.textContent = String(n);
      cell.num.style.opacity = n ? '1' : '.35';
    });
    var last = book && book.last;
    if (!last) {
      ui.lastCatch.textContent = 'no catches yet';
      ui.lastCatch.title = 'the ledger fills as the bot lands fish';
      return;
    }
    var bits = [last.species];
    if (last.weight) bits.push(last.weight);
    if (last.rarity && last.rarity !== 'Unknown') bits.push((last.derived ? '~' : '') + last.rarity);
    if (last.at) bits.push(new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    ui.lastCatch.textContent = bits.join(' · ');
    ui.lastCatch.title = 'last catch' + (last.derived ? ' — rarity from the built-in catalogue, the card printed none' : '');
  }

  function render() {
    if (!ui.card) return;
    var phase = state.phase;
    ui.chip.textContent = phase;
    ui.dot.className = 'dot ' + phase;
    ui.winToggle.textContent = state.window.on ? 'on' : 'off';
    ui.winToggle.style.color = state.window.on ? '#5ad18b' : '#9aa4ae';
    ui.timeRow.style.display = state.window.on ? '' : 'none';

    ui.dur.val.textContent = minutesText(state.durationMs);
    ui.cool.val.textContent = minutesText(state.cooldownMs);
    ui.cap.val.textContent = minutesText(state.dailyCapMs);
    ui.time_from.val.textContent = state.window.start;
    ui.time_to.val.textContent = state.window.stop;

    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}
    var stats = (status && status.stats) || {};

    if (phase === 'running') ui.mLeft.textContent = minutesText(state.durationMs - state.fishingMs) + ' left';
    else if (phase === 'cooldown' && state.cooldownUntil) ui.mLeft.textContent = minutesText(state.cooldownUntil - Date.now()) + ' cool';
    else if (phase === 'waiting') ui.mLeft.textContent = 'at ' + state.window.start;
    else ui.mLeft.textContent = minutesText(state.durationMs);
    ui.mCatches.textContent = String((stats.cards || state.catchCount || 0));
    ui.mPresses.textContent = String(stats.presses || 0);
    ui.mToday.textContent = minutesText(baseTodayMs + state.fishingMs) + ' / ' + minutesText(state.dailyCapMs);
    renderLog();

    var primary = ui.primary;
    if (phase === 'running' || phase === 'paused' || phase === 'waiting') {
      primary.textContent = 'Stop';
      primary.className = 'primary stop';
      primary.disabled = false;
    } else if (phase === 'cooldown') {
      var left = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
      primary.textContent = left > 0 ? 'Cooling down ' + minutesText(left) : 'Start';
      primary.className = 'primary';
      primary.disabled = left > 0;
    } else {
      primary.textContent = 'Start';
      primary.className = 'primary';
      primary.disabled = false;
    }

    ui.banner.textContent = banner;
    ui.banner.style.display = banner ? '' : 'none';

    // Observable from the outside even though the shadow root is closed.
    if (host) {
      host.dataset.phase = phase;
      host.dataset.catches = String(stats.cards || state.catchCount || 0);
    }

    place();
  }

  /* ------------------------------------------------------------ layout ---- */

  function zoneRect() {
    var f = fish();
    if (!f || !f.zones) return null;
    try {
      var z = f.zones();
      return window.AutoFishLayout.unionRect([z.bubble, z.dial, z.card, z.hintZone]);
    } catch (e) { return null; }
  }

  function place() {
    if (!host || dragging) return;
    var L = window.AutoFishLayout;
    if (!L) return;
    var size = collapsed ? { w: 48, h: 48 } : { w: 264, h: ui.card.getBoundingClientRect().height || 300 };
    var zone = zoneRect();
    var exclude = zone ? L.inflate(zone, 12) : null;
    var res = L.place({
      panel: size,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      exclude: exclude,
      topInset: 72,
      preferred: dragged || null
    });
    if (res === 'pill') {
      if (!collapsed) { setCollapsed(true); return; }
      res = { x: window.innerWidth - 60, y: 12, w: 48, h: 48 };
    }
    host.style.left = Math.round(res.x) + 'px';
    host.style.top = Math.round(res.y) + 'px';
    ui.wrap.className = 'wrap';
  }

  function restorePosition() {
    var pos = readJSON(POS_KEY, null);
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') dragged = { x: pos.x, y: pos.y };
    if (pos && pos.collapsed) setCollapsed(true);
  }

  function setCollapsed(next) {
    collapsed = next;
    ui.card.classList.toggle('hide', collapsed);
    ui.pill.classList.toggle('hide', !collapsed);
    var pos = readJSON(POS_KEY, {}) || {};
    pos.collapsed = collapsed;
    writeJSON(POS_KEY, pos);
    place();
  }

  function startDrag(e) {
    if (e.button != null && e.button !== 0) return;
    // The head is the drag handle AND the home of the collapse button. setPointerCapture(host)
    // retargets the later pointerup to the host, so the browser computes the click against the host
    // and the button's own click handler never runs - a dead button that looks alive. Leave
    // interactive children alone: no drag, no capture, and their click lands normally.
    if (e.target && e.target.closest && e.target.closest('button')) return;
    var r = host.getBoundingClientRect();
    dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { host.setPointerCapture(e.pointerId); } catch (ignored) {}
    // Capture phase on purpose: the host swallows pointerup in the bubble phase so the game never
    // sees it, and a bubble-phase window listener here would never run — the drag would follow the
    // pointer forever. Capture runs before the host handler.
    window.addEventListener('pointermove', onDrag, true);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
    window.addEventListener('blur', endDrag, true);
  }

  function onDrag(e) {
    if (!dragging) return;
    var x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragging.dx));
    var y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragging.dy));
    dragged = { x: x, y: y };
    host.style.left = Math.round(x) + 'px';
    host.style.top = Math.round(y) + 'px';
  }

  function endDrag() {
    window.removeEventListener('pointermove', onDrag, true);
    window.removeEventListener('pointerup', endDrag, true);
    window.removeEventListener('pointercancel', endDrag, true);
    window.removeEventListener('blur', endDrag, true);
    if (dragging && dragged) writeJSON(POS_KEY, { x: Math.round(dragged.x), y: Math.round(dragged.y), collapsed: collapsed });
    dragging = null;
    place();
  }

  /* -------------------------------------------------------------- loop ---- */

  function tick() {
    var status = null;
    try { status = fish() && fish().status ? fish().status() : null; } catch (e) {}

    if (state.phase === 'idle' || state.phase === 'cooldown') {
      // keep wall clocks honest and let a cooldown end on its own
      if (state.phase === 'cooldown' && state.cooldownUntil && Date.now() >= state.cooldownUntil) {
        dispatch({ type: 'tick', at: Date.now(), visible: document.visibilityState === 'visible', catches: 0, errors: 0, todayMs: baseTodayMs });
        banner = '';
      } else {
        render();
      }
      return;
    }

    dispatch({
      type: 'tick',
      at: Date.now(),
      visible: document.visibilityState === 'visible',
      catches: status ? status.catchCount || 0 : 0,
      errors: status && status.stats ? status.stats.errors || 0 : 0,
      todayMs: baseTodayMs
    });

    // 20 s running with zero prompts found means the detector is blind; grab one frame so the
    // shape of the real bubble can be measured rather than guessed. Once per session.
    if (!diagSent && state.phase === 'running' && status && status.stats && !status.stats.bubbles) {
      if (!diagAt) diagAt = Date.now();
      if (Date.now() - diagAt > 20000) { diagSent = true; captureDiag('no-prompt-after-20s'); }
    }

    if (Date.now() - heartbeatAt > 30000) { heartbeatAt = Date.now(); writeHeartbeat(); }
    if (banner && state.phase === 'running' && banner.indexOf('offline') === -1) { /* keep guard text visible */ }

    render();
  }

  /* ------------------------------------------------------------- mount ---- */

  async function mount() {
    try {
      await mountInner();
    } catch (e) {
      // Never fail silently: a half-built panel is worse than none, and the game keeps running.
      window.__panel = window.__panel || {};
      window.__panel.mountError = String((e && e.stack) || e);
      console.error('AutoFish: panel failed to mount —', e);
      try { if (host && host.parentNode) host.parentNode.removeChild(host); } catch (ignored) {}
    }
  }

  async function mountInner() {
    try { await deps(); } catch (e) {
      alert('AutoFish: start fishserve first (node fishserve.js), then click the bookmarklet again.');
      throw e;
    }

    var S = window.AutoFishSession;
    var prefs = loadPrefs();
    state = S.createState(prefs.window ? { window: prefs.window, durationMs: prefs.durationMs, cooldownMs: prefs.cooldownMs, dailyCapMs: prefs.dailyCapMs } : prefs);
    window.__panel = window.__panel || {};
    window.__panel.resumeAfterReload = !!prefs.resumeAfterReload;

    await loadToday();

    // A core already running from a previous session is not ours to guess about.
    var before = null;
    try { before = fish().status ? fish().status() : null; } catch (e) {}
    if (before && before.running) { try { fish().stop(); } catch (e) {} banner = 'stopped a session that was already running'; }

    build();
    mountAdoption();
    banner = checkInterrupted() || banner;

    tickTimer = setInterval(tick, TICK_MS);
    placeTimer = setInterval(place, 250);
    window.addEventListener('resize', place);
    document.addEventListener('visibilitychange', onVisible);

    window.__panel.mounted = true;
    window.__panel.state = function () { return state; };
    window.__panel.dispatch = dispatch;
    window.__panel.unmount = unmount;
    window.__panel.captureDiag = captureDiag;
    tick();
  }

  function onVisible() {
    if (document.visibilityState === 'visible' && (state.phase === 'running' || state.phase === 'waiting')) acquireWakeLock();
  }

  function mountAdoption() {
    // The page can drop our host on navigation inside the SPA; put it back.
    if (mount.timer) clearInterval(mount.timer);
    mount.timer = setInterval(function () {
      if (!host || !document.documentElement.contains(host)) {
        try { document.documentElement.appendChild(host); } catch (e) {}
      }
    }, 2000);
  }

  function unmount() {
    if (tickTimer) clearInterval(tickTimer);
    if (placeTimer) clearInterval(placeTimer);
    if (mount.timer) clearInterval(mount.timer);
    window.removeEventListener('resize', place);
    document.removeEventListener('visibilitychange', onVisible);
    releaseWakeLock();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (window.__panel) window.__panel.mounted = false;
  }

  mount();
})();


(function () {
  'use strict';
  var KEY = 'autofish:on';
  function remembered() {
    try { return localStorage.getItem(KEY) === 'on'; } catch (e) { return false; }
  }
  function remember(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
  }
  function panelUp() { return !!(window.__panel && window.__panel.mounted); }

  var el = null;
  function paint() {
    if (!el) return;
    if (panelUp()) { try { el.remove(); } catch (e) {} el = null; return; }
    // A chip that goes blank because one status() read threw is worse than a stale label.
    try {
      var Api = window.__fish;
      if (!Api) { el.textContent = '🐟 AutoFish · waiting for the game'; return; }
      var st = Api.status();
      var acc = st.accuracy || {};
      var label = st.running ? 'on' : 'off';
      el.textContent = '🐟 AutoFish · ' + label + ' · ' + (acc.caught || 0) + ' caught';
      el.style.background = st.running ? '#b9f6c9' : '#f1e6c9';
    } catch (e) {
      el.textContent = '🐟 AutoFish · ready';
    }
  }

  function makeChip() {
    var node = document.createElement('div');
    node.id = 'autofish-chip';
    node.style.cssText = [
      'position:fixed', 'left:14px', 'bottom:54px', 'z-index:2147483647',
      'font:600 12px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif',
      'color:#0f2f1c', 'background:#f1e6c9', 'border:1px solid rgba(15,47,28,.25)',
      'border-radius:999px', 'padding:7px 12px', 'cursor:pointer',
      '-webkit-user-select:none', 'user-select:none', 'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      'white-space:nowrap'
    ].join(';');
    node.title = 'AutoFish: click to start or stop';
    (document.body || document.documentElement).appendChild(node);
    return node;
  }

  function toggle() {
    var Api = window.__fish;
    if (!Api) return;
    if (Api.running) { Api.stop(); remember(false); }
    else { Api.start(); remember(true); }
    paint();
  }

  function showChip() {
    if (el || panelUp()) return;
    el = makeChip();
    el.addEventListener('click', toggle);
    setInterval(paint, 1000);
    if (remembered()) { try { window.__fish.start(); } catch (e) {} }
    paint();
  }

  // The panel's mount is async (it reads prefs and today's minutes), so give it a moment before
  // deciding it failed. These timers are the only thing the chip waits on.
  [800, 2000, 4000].forEach(function (ms) {
    setTimeout(function () { if (!panelUp()) showChip(); }, ms);
  });
})();

})();
