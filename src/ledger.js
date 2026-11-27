// @ts-check
/* src/ledger.js — species catalogue, localStorage catch ledger, and dial memory persistence.
 * UMD: browser global AutoFishLedger, CommonJS require('./src/ledger.js').
 */
/**
 * @param {any} root
 * @param {() => Record<string, any>} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIAL_KEY = 'autofish:dial:v1';
  const DIAL_R_MIN = 60, DIAL_R_MAX = 140;

  const finite = (n) => typeof n === 'number' && isFinite(n);
  const finitePositive = (n) => finite(n) && n > 0;

  /**
   * Validate a stored circle against the canvas it will be used on. Same canvas -> unchanged; a
   * proportionally bigger/smaller canvas -> scaled; anything else -> null.
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

  function sameDial(a, b) {
    return !!a && !!b && Math.abs(a.cx - b.cx) <= 2 && Math.abs(a.cy - b.cy) <= 2 && Math.abs(a.R - b.R) <= 2;
  }

  /**
   * Bind dial memory helpers to an injected `window`-like object and canvas getter.
   * @param {any} win
   * @param {() => ({ width?: number, height?: number } | null)} getCanvas
   */
  function createDialMemory(win, getCanvas) {
    return {
      loadDialMemory: function () {
        /** @type {string | null} */
        let raw = null;
        try { raw = win.localStorage.getItem(DIAL_KEY); } catch (e) { return null; }
        if (!raw) return null;
        try {
          const p = JSON.parse(raw);
          if (!p || p.v !== 1) return null;
          return { cx: p.cx, cy: p.cy, R: p.R, cw: p.cw, ch: p.ch };
        } catch (e) { return null; }
      },
      saveDialMemory: function (g) {
        const uiCanvas = getCanvas ? getCanvas() : null;
        if (!g || !uiCanvas || !uiCanvas.width) return false;
        try {
          win.localStorage.setItem(DIAL_KEY, JSON.stringify({
            v: 1, cx: Math.round(g.cx), cy: Math.round(g.cy), R: Math.round(g.R),
            cw: uiCanvas.width, ch: uiCanvas.height,
          }));
          return true;
        } catch (e) { return false; }
      },
    };
  }

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
  const TIER_BY_LOWER = {};
  for (const tier of TIER_ORDER) TIER_BY_LOWER[tier.toLowerCase()] = tier;
  const SPECIES_BY_NAME = {};
  for (const row of SPECIES) SPECIES_BY_NAME[String(row[0]).toLowerCase()] = row;

  const DISPLAY_ALIASES = [
    { name: 'Pharaoh Cuttlefish', base: 'Pharaoh Cuttlefish', row: 'Pharooh Cuddlefish', variant: '' },
    { name: 'Golden Canny', base: 'Pink Canny', row: 'Pink Canny', variant: 'Golden' },
  ];
  const DISPLAY_ALIASES_BY_LOWER = {};
  for (const alias of DISPLAY_ALIASES) DISPLAY_ALIASES_BY_LOWER[alias.name.toLowerCase()] = alias;
  /** @type {string[]} */
  const KNOWN_NAMES = SPECIES.map((row) => String(row[0])).concat(DISPLAY_ALIASES.map((alias) => alias.name));

  function tidyName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /** 'COMMON' / 'common' / ' Common ' -> 'Common'; anything else -> ''. */
  function normTier(s) {
    return TIER_BY_LOWER[tidyName(s).toLowerCase()] || '';
  }

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

  function splitVariant(name) {
    const full = tidyName(name);
    const m = /^(Shiny|Golden)\s+(.+)$/i.exec(full);
    if (m) return { variant: m[1].toLowerCase() === 'shiny' ? 'Shiny' : 'Golden', base: tidyName(m[2]) };
    return { variant: '', base: full };
  }

  function speciesInfo(name) {
    const full = tidyName(name);
    const lower = full.toLowerCase();
    const exact = SPECIES_BY_NAME[lower] || null;
    let parts = exact ? { variant: '', base: full } : splitVariant(full);
    const alias = exact ? null
      : DISPLAY_ALIASES_BY_LOWER[lower] || DISPLAY_ALIASES_BY_LOWER[parts.base.toLowerCase()] || null;
    if (alias) parts = { variant: parts.variant || alias.variant, base: alias.base };
    const row = exact || (alias ? SPECIES_BY_NAME[alias.row.toLowerCase()] : null) ||
      SPECIES_BY_NAME[parts.base.toLowerCase()] || null;
    return {
      name: full,
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
    if (e.shiny) day.shiny = (day.shiny || 0) + 1;
    if (e.golden) day.golden = (day.golden || 0) + 1;
    book.last = {
      species: name, rarity: e.rarity, derived: !!e.derived, shiny: !!e.shiny,
      weight: e.weight, weightKg: typeof e.weightKg === 'number' ? e.weightKg : null,
      value: e.value, at,
    };
    return book;
  }

  function trimLog(log, maxDays) {
    const keep = maxDays == null ? 60 : maxDays;
    const days = Object.keys(log.days || {}).sort();
    while (days.length > keep) {
      const oldest = days.shift();
      if (oldest !== undefined) delete log.days[oldest];
    }
    return log;
  }

  function logSummary(log, t) {
    const book = log && log.v === 1 ? log : emptyLog(t);
    const byRarity = TIER_ORDER.map((tier) => ({ rarity: tier, n: book.rarity[tier] || 0 }));
    for (const key of Object.keys(book.rarity)) if (TIER_ORDER.indexOf(key) < 0) byRarity.push({ rarity: key, n: book.rarity[key] });
    const names = Object.keys(book.species);
    /** @type {{ species: string, weightKg: number, at: number } | null} */
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

  const NON_SPECIES_TEXT = ['town key', 'volcanic rod', 'decent', 'exquisite'];

  function unknownWorklist(book, t) {
    const log = book && book.v === 1 ? book : emptyLog(t);
    const unknown = log.unknown || {};
    const seen = log.species || {};
    const names = Object.keys(unknown);
    /** @type {Record<string, any[]>} */
    const kinds = { resolved: [], fragment: [], nonFish: [], open: [] };
    for (const name of names) {
      const info = speciesInfo(name);
      const base = tidyName(info.base || name);
      const lower = base.toLowerCase();
      /** @type {string[]} */
      const candidates = [];
      if (!info.known && lower) {
        for (const row of KNOWN_NAMES) {
          const low = String(row).toLowerCase();
          if (low.indexOf(lower + ' ') === 0 || low.slice(-(lower.length + 1)) === ' ' + lower) {
            candidates.push(row);
          }
        }
      }
      const kind = info.known ? 'resolved'
        : NON_SPECIES_TEXT.indexOf(lower) >= 0 ? 'nonFish'
          : candidates.length ? 'fragment'
            : 'open';
      const record = seen[name] || {};
      kinds[kind].push({
        name, n: unknown[name] || 0,
        last: record.last || null,
        candidates,
      });
    }
    const sort = (a, b) => b.n - a.n || (a.name < b.name ? -1 : 1);
    const counts = {};
    for (const kind of ['resolved', 'fragment', 'nonFish', 'open']) {
      kinds[kind].sort(sort);
      counts[kind] = kinds[kind].reduce((sum, e) => sum + e.n, 0);
    }
    return {
      total: counts.resolved + counts.fragment + counts.nonFish + counts.open,
      names: names.length,
      counts,
      resolved: kinds.resolved,
      fragment: kinds.fragment,
      nonFish: kinds.nonFish,
      open: kinds.open,
    };
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

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

  /**
   * Bind profile-scoped catch ledger persistence to an injected `window`-like object.
   * @param {any} win
   */
  function createLedger(win) {
    let profile = 'default';
    /** @type {any} */
    let ledger = null;
    let epoch = 0;
    function logKey() { return LOG_PREFIX + profile; }
    function loadLedger() {
      if (ledger) return ledger;
      /** @type {string | null} */
      let raw = null;
      try { raw = win.localStorage.getItem(logKey()); } catch (e) { raw = null; }
      if (!raw && profile === 'default') {
        try { raw = win.localStorage.getItem(LOG_KEY); } catch (e) { raw = null; }
        if (raw) { try { win.localStorage.setItem(logKey(), raw); } catch (e) {} }
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
      epoch++;
      try { win.localStorage.setItem(logKey(), JSON.stringify(book)); return true; } catch (e) { return false; }
    }
    function logProfiles() {
      const out = [];
      try {
        const st = win.localStorage;
        for (let i = 0; i < (st.length || 0); i++) {
          const k = st.key(i);
          if (k && k.indexOf(LOG_PREFIX) === 0) out.push(k.slice(LOG_PREFIX.length));
        }
      } catch (e) {}
      if (out.indexOf('default') < 0) out.unshift('default');
      return out.sort();
    }
    function setProfile(next) {
      const changed = next !== profile;
      profile = next;
      if (changed) { ledger = null; epoch++; }
      return changed;
    }
    function getProfile() { return profile; }
    function getEpoch() { return epoch; }
    return { logKey, loadLedger, saveLedger, logProfiles, setProfile, getProfile, getEpoch };
  }

  return {
    DIAL_KEY, DIAL_R_MIN, DIAL_R_MAX, dialGeoFit, sameDial, createDialMemory,
    SPECIES, TIER_ORDER, LOG_KEY, LOG_PREFIX, TIER_BY_LOWER, SPECIES_BY_NAME,
    tidyName, normTier, parseWeightKg, splitVariant, speciesInfo, describeCatch,
    logDay, emptyLog, addToLog, trimLog, logSummary, unknownWorklist, csvCell, logCsv,
    createLedger,
  };
});
