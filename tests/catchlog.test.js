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
  'emptyLog', 'addToLog', 'trimLog', 'logSummary', 'csvCell', 'logCsv', 'loadLedger', 'saveLedger'
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
    }
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

test('the catalogue is embedded once: 135 fish across the eight rarity tiers', () => {
  assert.equal(T.SPECIES.length, 135);
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
    Common: 23, Uncommon: 22, Rare: 19, Epic: 25, Legendary: 26, Secret: 8, Halloween: 6, Christmas: 6
  });
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
  assert.equal(first.store.data.has('autofish:log:v1'), true);

  const second = load({ seed: { 'autofish:log:v1': first.store.data.get('autofish:log:v1') } });
  const reread = second.loadLedger();
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
