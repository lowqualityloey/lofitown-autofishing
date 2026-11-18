'use strict';
/**
 * The catch ledger ships inside autofish.js - the userscript has to stay one injectable file - so
 * the pure half is marked with sentinels and extracted here. Each test builds a FRESH instance with
 * its own stubbed localStorage, because the block caches the ledger at module level.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const OPEN = '// <catch-log>';
const CLOSE = '// </catch-log>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('catch-log sentinels are missing from autofish.js');
const CODE = SRC.slice(a + OPEN.length, b);
const EXPORTS = [
  'SPECIES', 'TIER_ORDER', 'LOG_KEY', 'TIER_BY_LOWER', 'SPECIES_BY_NAME', 'tidyName',
  'normTier', 'parseWeightKg', 'splitVariant', 'speciesInfo', 'describeCatch', 'logDay',
  'emptyLog', 'addToLog', 'trimLog', 'logSummary', 'unknownWorklist', 'csvCell', 'logCsv', 'loadLedger', 'saveLedger',
  'logProfiles', 'logKey'
].join(', ');

/** localStorage that can be pre-seeded, and can refuse reads or writes like a real blocked store. */
function store(opts) {
  const o = opts || {};
  const data = new Map(Object.entries(o.seed || {}));
  return {
    data,
    getItem(k) {
      if (o.throwRead) throw new Error('storage denied');
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (o.throwWrite) throw new Error('quota exceeded');
      data.set(k, String(v));
    },
    // the real Storage exposes these, and logProfiles() enumerates keys through them
    get length() { return data.size; },
    key(i) { return Array.from(data.keys())[i] == null ? null : Array.from(data.keys())[i]; }
  };
}

function load(opts) {
  const st = store(opts);
  const api = new Function('window', CODE + '\nreturn { ' + EXPORTS + ' };')({ localStorage: st });
  api.store = st;
  return api;
}

const T = load();

function catchOf(species, rarity, weight) {
  return T.describeCatch({ species, rarity: rarity || '', weight: weight || '', value: '' });
}

test('the block exports the catalogue and the ledger helpers', () => {
  for (const k of EXPORTS.split(', ')) assert.notEqual(T[k], undefined, k);
  assert.equal(T.LOG_KEY, 'autofish:log:v1');
});

test('the catalogue is embedded once: 232 fish across the eight rarity tiers', () => {
  assert.equal(T.SPECIES.length, 232);
  assert.deepEqual(T.TIER_ORDER, ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas']);
  const names = new Set();
  const perTier = {};
  for (const row of T.SPECIES) {
    assert.equal(row.length, 5, 'row is [name, tier, minWeight, maxWeight, baseGold]');
    const [name, tier, min, max, gold] = row;
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 0, 'a species needs a name');
    assert.ok(!names.has(name), name + ' appears twice');
    names.add(name);
    assert.ok(T.TIER_ORDER.includes(tier), name + ' has an unknown tier ' + tier);
    assert.ok(min > 0 && max >= min, name + ' has a bad weight range');
    assert.ok(gold > 0, name + ' has no base gold');
    perTier[tier] = (perTier[tier] || 0) + 1;
  }
  assert.deepEqual(perTier, {
    Common: 43, Uncommon: 41, Rare: 39, Epic: 45, Legendary: 42, Secret: 10, Halloween: 6, Christmas: 6
  });
});

test('the Volcanic zone is in the catalogue, not a pile of Unknowns', () => {
  // The old 181-row table was exactly River + Swamp + Arctic; all 51 Volcanic species were
  // absent, so every common Volcanic catch fell back to Unknown. These cover the zone's six
  // tiers, including the name whose ʻokina used to break the card parser.
  const volcanic = [
    ['Boops', 'Common'], ['Bartlett\'s Anthias', 'Common'],
    ['Yellow Tang', 'Uncommon'], ['Moon Jellyfish', 'Uncommon'],
    ['Vulcanoctopus', 'Rare'], ['Pompeii Worm', 'Rare'],
    ['Great Barracuda', 'Epic'], ['Yeti Crab', 'Epic'],
    ['Moʻo', 'Legendary'], ['Giant Clam', 'Legendary'],
    ['Flowerhorn Cichlid', 'Secret'],
  ];
  for (const [name, rarity] of volcanic) {
    const info = T.speciesInfo(name);
    assert.equal(info.known, true, name + ' must be in the catalogue');
    assert.equal(info.rarity, rarity, name);
  }
});

test('the seasonal table is part of the catalogue, not an Unknown', () => {
  // The live bundle builds the seasonal/region fish through a helper, so the old literal-object
  // scan missed all 46 of them. Tubenose Poacher was caught live and logged as Unknown because of it.
  const poacher = T.speciesInfo('Tubenose Poacher');
  assert.equal(poacher.known, true, 'the seasonal table is in the catalogue');
  assert.equal(poacher.rarity, 'Uncommon');
  assert.equal(T.speciesInfo('Arctic Cod').rarity, 'Common');
  const deep = T.speciesInfo('The Deepest Rock');
  assert.equal(deep.known, true, 'a two-argument helper row is still a species');
  assert.equal(deep.minWeight, 1, 'the helper default weight is 1');
  assert.equal(deep.maxWeight, 10, 'the helper default maximum is 10');
});

test('speciesInfo is case-insensitive and reports whether the name is known', () => {
  const blob = T.speciesInfo('Blobfish');
  assert.equal(blob.known, true);
  assert.equal(blob.rarity, 'Rare');
  assert.equal(blob.minWeight, 2);
  assert.equal(blob.maxWeight, 20);
  assert.equal(blob.baseGold, 50);
  assert.equal(T.speciesInfo('blobfish').rarity, 'Rare');
  assert.equal(T.speciesInfo('  BlobFish ').rarity, 'Rare');
  const unknown = T.speciesInfo('Not A Fish');
  assert.equal(unknown.known, false);
  assert.equal(unknown.rarity, '');
  assert.equal(T.speciesInfo('').known, false);
  assert.equal(T.speciesInfo(null).known, false);
});

test('splitVariant separates the Shiny / Golden prefix from the base species', () => {
  assert.deepEqual(T.splitVariant('Shiny Blobfish'), { variant: 'Shiny', base: 'Blobfish' });
  assert.deepEqual(T.splitVariant('Golden Tuna'), { variant: 'Golden', base: 'Tuna' });
  assert.deepEqual(T.splitVariant('Tuna'), { variant: '', base: 'Tuna' });
  // the card can print the variant and the tier together; only the prefix is a variant
  const info = T.speciesInfo('Shiny Blobfish');
  assert.equal(info.shiny, true);
  assert.equal(info.golden, false);
  assert.equal(info.rarity, 'Rare', 'a shiny still has its base species rarity');
});

test('a catalogue species whose name starts with Golden stays a species', () => {
  // These are the two catalogue names the prefix rule used to swallow. Golden Shiner is a
  // Common species, not a Golden variant of an absent "Shiner", and Golden Goldfish is its
  // own Legendary species, not a Golden Goldfish variant of Goldfish.
  const shiner = T.speciesInfo('Golden Shiner');
  assert.equal(shiner.known, true);
  assert.equal(shiner.base, 'Golden Shiner');
  assert.equal(shiner.variant, '');
  assert.equal(shiner.golden, false);
  assert.equal(shiner.rarity, 'Common');

  const goldfish = T.speciesInfo('Golden Goldfish');
  assert.equal(goldfish.known, true);
  assert.equal(goldfish.base, 'Golden Goldfish');
  assert.equal(goldfish.variant, '');
  assert.equal(goldfish.rarity, 'Legendary');

  const shinerCatch = catchOf('Golden Shiner', '', '');
  assert.equal(shinerCatch.rarity, 'Common');
  assert.equal(shinerCatch.derived, true);
  const goldfishCatch = catchOf('Golden Goldfish', '', '');
  assert.equal(goldfishCatch.rarity, 'Legendary');

  // A real Golden variant and a real Shiny variant must still take the old path.
  const tuna = T.speciesInfo('Golden Tuna');
  assert.equal(tuna.base, 'Tuna');
  assert.equal(tuna.variant, 'Golden');
  assert.equal(tuna.rarity, 'Uncommon');
  const boxfish = T.speciesInfo('Shiny Boxfish');
  assert.equal(boxfish.base, 'Boxfish');
  assert.equal(boxfish.variant, 'Shiny');
  assert.equal(boxfish.rarity, 'Common');
});

test('the two display renames in the game resolve to their catalogue rows', () => {
  // The bundle prints these names but stores them under different ones: a card that says
  // "Pharaoh Cuttlefish" is the Epic "Pharooh Cuddlefish", and a special "Pink Canny" prints as
  // "Golden Canny" rather than "Golden Pink Canny". Neither display name is a catalogue row.
  const pharaoh = T.speciesInfo('Pharaoh Cuttlefish');
  assert.equal(pharaoh.known, true);
  assert.equal(pharaoh.rarity, 'Epic');
  assert.equal(pharaoh.minWeight, 1);
  assert.equal(pharaoh.maxWeight, 10);
  assert.equal(pharaoh.baseGold, 140);
  assert.equal(pharaoh.base, 'Pharaoh Cuttlefish', 'the card name stays the species the player saw');
  assert.equal(pharaoh.variant, '');

  const canny = T.speciesInfo('Golden Canny');
  assert.equal(canny.known, true);
  assert.equal(canny.rarity, 'Legendary');
  assert.equal(canny.minWeight, 50);
  assert.equal(canny.maxWeight, 300);
  assert.equal(canny.baseGold, 60);
  assert.equal(canny.base, 'Pink Canny');
  assert.equal(canny.golden, true);
  const cannyCatch = catchOf('Golden Canny', '', '120 kg');
  assert.equal(cannyCatch.species, 'Golden Canny');
  assert.equal(cannyCatch.rarity, 'Legendary');
  assert.equal(cannyCatch.golden, true);
  assert.equal(cannyCatch.derived, true);

  // A variant of a renamed species keeps its prefix through the alias.
  const shiny = T.speciesInfo('Shiny Pharaoh Cuttlefish');
  assert.equal(shiny.shiny, true);
  assert.equal(shiny.base, 'Pharaoh Cuttlefish');
  assert.equal(shiny.rarity, 'Epic');

  // The aliases do not grow the bundle's table; the card's own name resolves to its tier.
  assert.equal(T.SPECIES.length, 232);
  assert.equal(T.SPECIES.some((r) => r[0] === 'Pharaoh Cuttlefish' || r[0] === 'Golden Canny'), false);
  assert.equal(catchOf('Pharaoh Cuttlefish', '', '9.86 kg').rarity, 'Epic');
});

// The live nepchur ledger on 2026-11-18: 356 Unknown catches across these 38 names. Kept verbatim
// so the worklist is pinned against the data it was designed for, not a tidied subset.
const LIVE_UNKNOWN = {
  'Fried Egg': 12, 'Shiny Flying': 1, Decent: 1, 'Town Key': 4, Exquisite: 1,
  'Black Seadevil': 1, Greenland: 10, 'Hawaiian Gregory': 3, Eelpouts: 5, Keeltail: 6,
  Riftia: 6, Flagtail: 7, 'Rocks with': 9, 'Goby Fish': 5, Titan: 1, 'Hawaiian Bigeye': 4,
  'Green Coral': 2, 'Sea Sponge': 5, Snailfish: 2, Boops: 1, Boxfish: 6, 'Banana Moray': 1,
  'Moon Jellyfish': 3, "Bartlett's": 4, Pharaoh: 24, 'Sea Cucumber': 2, Vulcanoctopus: 1,
  Mandarinfish: 1, 'Forceps Fish': 1, 'Longfin Batfish': 1, 'Shiny Boxfish': 1,
  'Eyeless Shrimp': 1, 'Yeti Crab': 1, 'Volcanic Rod': 1, Parrotfish: 1, Yellowstripe: 3,
  Semicircle: 1, 'Golden Shiner': 217,
};

test('the unknown worklist sorts 356 historical Unknowns into today\'s four kinds', () => {
  const book = T.emptyLog(1000);
  book.unknown = { ...LIVE_UNKNOWN };
  const w = T.unknownWorklist(book);

  assert.equal(w.names, 38);
  assert.equal(w.total, 356);
  assert.deepEqual(w.counts, { resolved: 270, fragment: 79, nonFish: 7, open: 0 });
  assert.equal(w.counts.resolved + w.counts.fragment + w.counts.nonFish + w.counts.open, w.total,
    'every unknown catch lands in exactly one kind');

  // The Golden-prefix fix resolves the biggest pile, and the display alias explains the last
  // name: 'Pharaoh' is the first line of the card's 'Pharaoh Cuttlefish'.
  assert.equal(w.resolved[0].name, 'Golden Shiner');
  assert.equal(w.resolved[0].n, 217);
  assert.deepEqual(w.open, [], 'no historical name is a gap once the display renames are known');

  // A fragment names the catalogue species the card was split across.
  const fragment = (name) => w.fragment.find((e) => e.name === name).candidates;
  assert.deepEqual(fragment('Fried Egg'), ['Fried Egg Jellyfish']);
  assert.deepEqual(fragment('Yellowstripe'), ['Yellowstripe Goatfish']);
  assert.deepEqual(fragment('Rocks with'), ['Rocks with Mussels']);
  assert.deepEqual(fragment("Bartlett's"), ["Bartlett's Anthias"]);
  assert.deepEqual(fragment('Shiny Flying'), ['Flying Fish'], 'a variant keeps its base for the match');
  assert.equal(fragment('Greenland').length, 2, 'either Greenland species explains the fragment');
  assert.deepEqual(fragment('Pharaoh'), ['Pharaoh Cuttlefish'], 'a display rename explains its first line');

  // Item and quality text is not a species.
  assert.deepEqual(w.nonFish.map((e) => e.name).sort(), ['Decent', 'Exquisite', 'Town Key', 'Volcanic Rod']);
});

test('the unknown worklist never edits the ledger it reads', () => {
  const book = T.emptyLog(1000);
  book.unknown = { ...LIVE_UNKNOWN };
  const before = JSON.stringify(book);
  T.unknownWorklist(book);
  assert.equal(JSON.stringify(book), before);
});

test('only an Unknown catch enters the worklist; a resolved species does not', () => {
  const book = T.emptyLog(1000);
  T.addToLog(book, catchOf('Golden Shiner', '', '0.2 kg'), 2000);
  T.addToLog(book, catchOf('Pharaoh', '', '9.86 kg'), 3000);
  const w = T.unknownWorklist(book);
  assert.deepEqual(Object.keys(book.unknown), ['Pharaoh'], 'the known species never adds a counter');
  assert.equal(w.total, 1);
  assert.deepEqual(w.resolved, []);
  assert.deepEqual(w.open, []);
  assert.deepEqual(w.fragment.map((e) => e.name), ['Pharaoh']);
  assert.deepEqual(w.fragment[0].candidates, ['Pharaoh Cuttlefish']);
  assert.equal(w.fragment[0].last, 3000, 'the worklist carries the ledger\'s own last-seen stamp');
});

test('an empty ledger has an empty worklist', () => {
  const w = T.unknownWorklist(T.emptyLog(1000));
  assert.deepEqual(w, {
    total: 0, names: 0, counts: { resolved: 0, fragment: 0, nonFish: 0, open: 0 },
    resolved: [], fragment: [], nonFish: [], open: [],
  });
});

test('normTier accepts the spellings the card and the bundle use', () => {
  assert.equal(T.normTier('common'), 'Common');
  assert.equal(T.normTier('LEGENDARY'), 'Legendary');
  assert.equal(T.normTier(' Epic '), 'Epic');
  assert.equal(T.normTier('Secret'), 'Secret');
  assert.equal(T.normTier(''), '');
  assert.equal(T.normTier(null), '');
  assert.equal(T.normTier('Shiny'), '');
});

test('parseWeightKg reads kg, g, t and lb, and refuses what it cannot read', () => {
  assert.equal(T.parseWeightKg('13.7 kg'), 13.7);
  assert.equal(T.parseWeightKg('13.7kg'), 13.7);
  assert.equal(T.parseWeightKg('850 g'), 0.85);
  assert.equal(T.parseWeightKg('1.2 t'), 1200);
  assert.equal(T.parseWeightKg('2 lb'), 0.907);   // rounded to 3 decimals, kg is the ledger unit
  assert.equal(T.parseWeightKg(''), null);
  assert.equal(T.parseWeightKg('??'), null);
  assert.equal(T.parseWeightKg(null), null);
});

test('describeCatch trusts a printed rarity and marks a catalogue one as derived', () => {
  const printed = catchOf('Tuna', 'Legendary', '1.2 t');
  assert.equal(printed.rarity, 'Legendary');
  assert.equal(printed.derived, false);
  assert.equal(printed.weightKg, 1200);

  const blank = catchOf('Blobfish', '', '13.7 kg');
  assert.equal(blank.rarity, 'Rare');
  assert.equal(blank.derived, true, 'a rarity filled from the catalogue is never presented as printed');

  const shiny = catchOf('Shiny Blobfish', '', '2 kg');
  assert.equal(shiny.shiny, true);
  assert.equal(shiny.rarity, 'Rare');
  assert.equal(shiny.derived, true);
});

test('describeCatch never guesses a rarity for a species it does not know', () => {
  const odd = catchOf('Mystery Fish', '', '3 kg');
  assert.equal(odd.known, false);
  assert.equal(odd.rarity, 'Unknown');
  assert.equal(odd.derived, true);
  assert.equal(catchOf('', '', '').species, 'Unknown');
});

test('addToLog keeps per-species counts, the best weight and the day bucket', () => {
  const book = T.addToLog(T.emptyLog(1000), catchOf('Blobfish', '', '3 kg'), 2000);
  T.addToLog(book, catchOf('Blobfish', '', '13.7 kg'), 3000);
  T.addToLog(book, catchOf('Shiny Blobfish', '', '2 kg'), 4000);
  assert.equal(book.total, 3);
  assert.equal(book.species.Blobfish.n, 2);
  assert.equal(book.species.Blobfish.best, 13.7);
  assert.equal(book.species.Blobfish.bestAt, 3000);
  assert.equal(book.species.Blobfish.first, 2000);
  assert.equal(book.species.Blobfish.last, 3000);
  assert.equal(book.species['Shiny Blobfish'].shiny, true);
  assert.equal(book.rarity.Rare, 3);
  assert.equal(book.shiny, 1);
  assert.equal(book.days[T.logDay(2000)].n, 3);
  assert.equal(book.last.species, 'Shiny Blobfish');
  assert.equal(book.updatedAt, 4000);
});

test('addToLog replaces a worse best weight but keeps the better one', () => {
  const book = T.addToLog(T.emptyLog(1), catchOf('Cod', 'Common', '5 kg'), 2);
  T.addToLog(book, catchOf('Cod', 'Common', '2 kg'), 3);
  assert.equal(book.species.Cod.best, 5);
  assert.equal(book.species.Cod.bestAt, 2);
  const unknownWeight = T.addToLog(T.emptyLog(1), catchOf('Cod', 'Common', ''), 4);
  assert.equal(unknownWeight.species.Cod.best, null);
});

test('logSummary ranks the top species and fills all eight tiers', () => {
  const book = T.emptyLog(1000);
  T.addToLog(book, catchOf('Sardine', '', '1 kg'), 2000);
  T.addToLog(book, catchOf('Sardine', '', '2 kg'), 2000);
  T.addToLog(book, catchOf('Tuna', '', '3 kg'), 2000);
  const s = T.logSummary(book, 2000);
  assert.equal(s.total, 3);
  assert.equal(s.speciesCount, 2);
  assert.deepEqual(s.top, [{ species: 'Sardine', n: 2 }, { species: 'Tuna', n: 1 }]);
  assert.equal(s.byRarity.length, 8);
  const tier = T.speciesInfo('Sardine').rarity;
  assert.equal(s.byRarity.find((r) => r.rarity === tier).n, 2, 'two sardines land in the sardine tier');
  assert.equal(s.byRarity.reduce((n, r) => n + r.n, 0), 3, 'every catch lands in exactly one tier');
  assert.deepEqual(s.best, { species: 'Tuna', weightKg: 3, at: 2000 });
  assert.equal(s.today.n, 3);
  assert.equal(s.days, 1);
  assert.equal(s.last.species, 'Tuna');
});

test('a day bucket counts shiny and golden variants, not only species', () => {
  const book = T.emptyLog(1000);
  T.addToLog(book, catchOf('Shiny Blobfish', 'Rare', '2 kg'), 2000);
  T.addToLog(book, catchOf('Golden Blobfish', 'Rare', '2 kg'), 2000);
  T.addToLog(book, catchOf('Blobfish', 'Rare', '2 kg'), 2000);
  const s = T.logSummary(book, 2000);
  assert.equal(s.today.n, 3);
  assert.equal(s.today.shiny, 1);
  assert.equal(s.today.golden, 1);
  assert.equal(s.shiny, 1, 'the all-time variant totals are unchanged');
  assert.equal(s.golden, 1);
  assert.equal(s.since, 1000, 'the profile knows when its history started');
});

test('logSummary of an empty ledger is a zeroed, still-renderable shape', () => {
  const s = T.logSummary(T.emptyLog(1000), 1000);
  assert.equal(s.total, 0);
  assert.equal(s.speciesCount, 0);
  assert.equal(s.best, null);
  assert.equal(s.last, null);
  assert.equal(s.byRarity.length, 8);
  assert.equal(s.byRarity.every((r) => r.n === 0), true);
  assert.equal(s.today.n, 0);
});

test('logCsv writes a header plus one escaped row per species', () => {
  const book = T.emptyLog(1000);
  T.addToLog(book, catchOf('Sardine', 'Common', '1 kg'), 2000);
  T.addToLog(book, catchOf('Sardine', 'Common', '2 kg'), 3000);
  T.addToLog(book, catchOf('Blobfish', '', '13.7 kg'), 4000);
  const csv = T.logCsv(book);
  const rows = csv.trim().split('\n');
  assert.equal(rows[0], 'species,rarity,derived,shiny,count,best_kg,first_seen,last_seen');
  assert.equal(rows.length, 3, 'one row per species');
  assert.match(rows[1], /^Sardine,Common,no,no,2,2,1970-01-01T00:00:02\.000Z,1970-01-01T00:00:03\.000Z$/);
  assert.match(rows[2], /^Blobfish,Rare,yes,no,1,13\.7,/);
  assert.equal(T.csvCell('a,b'), '"a,b"');
  assert.equal(T.csvCell('say "hi"'), '"say ""hi"""');
});

test('trimLog keeps the newest day buckets and nothing else', () => {
  const book = T.emptyLog(0);
  const stamps = [];
  for (let i = 0; i < 5; i++) {
    // local midnights, so the day keys do not depend on the machine's time zone
    const at = new Date(2026, 0, 1 + i, 12).getTime();
    stamps.push(at);
    T.addToLog(book, catchOf('Sardine', '', '1 kg'), at);
  }
  assert.equal(Object.keys(book.days).length, 5);
  T.trimLog(book, 2);
  const kept = Object.keys(book.days).sort();
  assert.equal(kept.length, 2);
  assert.deepEqual(kept, [T.logDay(stamps[3]), T.logDay(stamps[4])]);
  assert.equal(book.total, 5, 'trimming days never drops the species totals');
});

test('a saved ledger survives a JSON round trip and keeps accumulating', () => {
  const first = load();
  const book = first.loadLedger();
  assert.equal(book.total, 0);
  first.saveLedger(first.addToLog(book, catchOf('Tuna', 'Common', '4 kg'), 2000));
  assert.equal(first.store.data.has('autofish:log:v1:default'), true, 'the default profile owns the ledger key');

  // An install from before profiles existed still holds autofish:log:v1; it must be migrated, not
  // ignored, or the upgrade looks like every catch was lost.
  const second = load({ seed: { 'autofish:log:v1': first.store.data.get('autofish:log:v1:default') } });
  const reread = second.loadLedger();
  assert.equal(second.store.data.has('autofish:log:v1:default'), true, 'the legacy ledger was copied forward');
  assert.equal(reread.total, 1);
  assert.equal(reread.species.Tuna.n, 1);
  const grown = second.saveLedger(second.addToLog(reread, catchOf('Tuna', 'Common', '5 kg'), 3000));
  assert.equal(grown, true);
  const summary = second.logSummary(second.loadLedger(), 3000);
  assert.equal(summary.total, 2);
  assert.equal(summary.top[0].n, 2);
});

test('a corrupt, foreign or unreadable ledger falls back to an empty one', () => {
  const corrupt = load({ seed: { 'autofish:log:v1': '{not json' } });
  assert.equal(corrupt.loadLedger().total, 0);
  const foreign = load({ seed: { 'autofish:log:v1': JSON.stringify({ v: 2, species: {} }) } });
  assert.equal(foreign.loadLedger().v, 1, 'a different schema version is replaced, not trusted');
  const denied = load({ throwRead: true });
  assert.equal(denied.loadLedger().total, 0, 'a blocked store is an empty log, never a throw');
});

test('saveLedger reports whether the write landed', () => {
  const ok = load();
  assert.equal(ok.saveLedger(ok.emptyLog(1)), true);
  const denied = load({ throwWrite: true });
  assert.equal(denied.saveLedger(denied.emptyLog(1)), false, 'quota or a blocked store must be reportable');
});

test('a species the catalogue does not know is caught, counted, and named', () => {
  // Tubenose Poacher was the live case: caught, logged, and shown with no tier. It is in the
  // catalogue now, so this test stands in a name no bundle will ever ship.
  const info = catchOf('Uncatalogued Test Fish', '', '0.49kg');
  assert.equal(info.rarity, 'Unknown');
  assert.equal(info.derived, true);
  assert.equal(info.known, false);
  const book = T.emptyLog(1000);
  T.addToLog(book, info, 2000);
  const s = T.logSummary(book, 2000);
  assert.equal(s.total, 1);
  assert.equal(s.top[0].species, 'Uncatalogued Test Fish');
  assert.equal(s.unknown['Uncatalogued Test Fish'], 1);
  assert.deepEqual(s.unknownNames, ['Uncatalogued Test Fish']);
  assert.equal(s.byRarity.find((r) => r.rarity === 'Unknown').n, 1, 'Unknown must be reported, not dropped');
});

test('a known fish never lands in the unknown worklist', () => {
  const book = T.emptyLog(1000);
  T.addToLog(book, catchOf('Tuna', 'Common', '4 kg'), 2000);
  const s = T.logSummary(book, 2000);
  assert.deepEqual(s.unknown, {});
  assert.equal(s.byRarity.find((r) => r.rarity === 'Unknown'), undefined);
});

test('each profile has its own ledger key, and the profiles are discoverable', () => {
  const book = JSON.stringify(T.addToLog(T.emptyLog(1), catchOf('Tuna', 'Common', '4 kg'), 2));
  const multi = load({ seed: { 'autofish:log:v1:default': book, 'autofish:log:v1:alt': book } });
  assert.deepEqual(multi.logProfiles(), ['alt', 'default']);
  assert.equal(multi.logKey(), 'autofish:log:v1:default');
});
