#!/usr/bin/env node
// @ts-check
'use strict';
/**
 * Regenerate the species catalogue embedded in autofish.js.
 *
 * The game ships its fish tables in its own JS chunks; the bot only needs the part that names a
 * rarity. This script pulls the current table out and rewrites the block between the catalogue
 * sentinels, so a game update is one command instead of hand-editing 200+ rows.
 *
 * The table has appeared in three shapes:
 *   - base fish as literal objects: {name:"...",rarityTier:"...",minWeight,...,baseGold...}
 *   - the older helper: n("Tubenose Poacher","Uncommon",.1,1)
 *   - the current size helper: x("Boops","Common","Tiny"), where the size maps to a weight range
 *     and the tier maps to gold.
 *
 * The current chunks also only carry the zones the page has loaded. Rows already in autofish.js
 * are therefore the base of the merge: current rows win, and an old row is kept when no current
 * chunk repeats it. That is how a live Volcanic table is added without dropping a seasonal or
 * legacy fish that lives in a chunk we did not fetch.
 *
 *   node scripts/gen-catalogue.js [paths...] [--write] [--fresh]
 *
 * Default input is the shots/diag/chunks directory; a path may be a file or a directory. Without
 * --write it prints the table. --fresh ignores the existing catalogue and refuses to write unless
 * the current chunks look complete enough (100+ rows).
 *
 * The chunk hash changes with every game build. Take the current paths from the page's <script
 * src> list; a fish the catalogue does not know is logged as Unknown and listed in the ledger's
 * `unknown` map, which is the worklist this script exists to clear.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OPEN = '// <species-catalogue>';
const CLOSE = '// </species-catalogue>';
const TIER_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas'];
const TIERS = TIER_ORDER.join('|');
const SIZE_ORDER = ['Tiny', 'Small', 'Medium', 'Big', 'Enormous'];
const DEFAULT_SIZES = {
  Tiny: { min: 0.01, max: 0.1 },
  Small: { min: 0.1, max: 1 },
  Medium: { min: 1, max: 10 },
  Big: { min: 100, max: 1000 },
  Enormous: { min: 1000, max: 10000 },
};

function extract(src) {
  // Weights and gold in the bundle are sometimes exponential (1e3, 5e4), hence the e-notation.
  const re = /\{name:"([^"]+)",rarityTier:"([^"]+)",minWeight:([0-9.eE+-]+),maxWeight:([0-9.eE+-]+),baseGold:([0-9.eE+-]+)\}/g;
  const seen = new Set();
  const rows = [];
  let m;
  while ((m = re.exec(src))) {
    const row = [m[1], m[2], Number(m[3]), Number(m[4]), Number(m[5])];
    if (seen.has(row[0].toLowerCase())) continue;
    seen.add(row[0].toLowerCase());
    rows.push(row);
  }
  return rows;
}

/** Gold per tier from any `{Common:7,...,Christmas:0}` map, whatever the minified name is. */
function goldByTier(src) {
  const re = /\{Common:([0-9.eE+-]+),Uncommon:([0-9.eE+-]+),Rare:([0-9.eE+-]+),Epic:([0-9.eE+-]+),Legendary:([0-9.eE+-]+),Secret:([0-9.eE+-]+),Halloween:([0-9.eE+-]+),Christmas:([0-9.eE+-]+)\}/g;
  const m = re.exec(src);
  if (!m) return {};
  const out = {};
  TIER_ORDER.forEach((t, i) => { out[t] = Number(m[i + 1]); });
  return out;
}

/** Weight ranges for the size labels the current helper uses. */
function sizeByLabel(src) {
  const out = {};
  const re = /(Tiny|Small|Medium|Big|Enormous):\{minWeight:([0-9.eE+-]+),maxWeight:([0-9.eE+-]+)\}/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = { min: Number(m[2]), max: Number(m[3]) };
  return Object.assign({}, DEFAULT_SIZES, out);
}

/**
 * The older helper: n(name, tier[, minWeight, maxWeight]). Missing weights default to 1..10 in
 * the bundle's own helper, so they default the same way here.
 */
function extractBuilt(src, gold) {
  const re = new RegExp('([A-Za-z_$][\\w$]*)\\(\"([^\"]+)\",\"(' + TIERS + ')\"(?:,([0-9.eE+-]+),([0-9.eE+-]+))?\\)', 'g');
  const seen = new Set();
  const rows = [];
  let m;
  while ((m = re.exec(src))) {
    const tier = m[3];
    const row = [m[2], tier, m[4] == null ? 1 : Number(m[4]), m[5] == null ? 10 : Number(m[5]), gold[tier] == null ? 0 : gold[tier]];
    if (seen.has(row[0].toLowerCase())) continue;
    seen.add(row[0].toLowerCase());
    rows.push(row);
  }
  return rows;
}

/**
 * The current helper: x(name, tier[, size]). Missing size means Medium. The weight range comes
 * from the bundle's size map and the gold from its tier map.
 */
function extractSized(src, sizes, gold) {
  const re = new RegExp('([A-Za-z_$][\\w$]*)\\(\"([^\"]+)\",\"(' + TIERS + ')\"(?:,\"(' + SIZE_ORDER.join('|') + ')\")?\\)', 'g');
  const seen = new Set();
  const rows = [];
  let m;
  while ((m = re.exec(src))) {
    const tier = m[3];
    const size = sizes[m[4] || 'Medium'] || sizes.Medium || DEFAULT_SIZES.Medium;
    const row = [m[2], tier, size.min, size.max, gold[tier] == null ? 0 : gold[tier]];
    if (seen.has(row[0].toLowerCase())) continue;
    seen.add(row[0].toLowerCase());
    rows.push(row);
  }
  return rows;
}

/** Read the rows already embedded in autofish.js, so a current-chunk merge cannot drop them. */
function existingRows(src) {
  const a = src.indexOf('const SPECIES = [');
  if (a < 0) return [];
  const b = src.indexOf('];', a);
  if (b < 0) return [];
  const re = /\["([^"]+)","([^"]+)",([0-9.eE+-]+),([0-9.eE+-]+),([0-9.eE+-]+)\]/g;
  const rows = [];
  let m;
  while ((m = re.exec(src.slice(a, b)))) {
    rows.push([m[1], m[2], Number(m[3]), Number(m[4]), Number(m[5])]);
  }
  return rows;
}

/** Base table first, so a name in both keeps its explicit gold. Names compare case-insensitively.
 * @param {...any[]} lists
 */
function merge(...lists) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < lists.length; i++) {
    for (const row of lists[i]) {
      const key = row[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/**
 * Current rows win, but an existing nonzero gold fills a helper row whose tier map is 0 (the
 * event tiers are 0 in the live map). Then append every existing name the current chunks did not
 * repeat, so a legacy/seasonal row is not silently removed by a partial chunk download.
 */
function mergeExisting(current, existing) {
  const old = new Map(existing.map((row) => [row[0].toLowerCase(), row]));
  const currentNames = new Set(current.map((row) => row[0].toLowerCase()));
  const rows = current.map((row) => {
    const prior = old.get(row[0].toLowerCase());
    if (!prior) return row;
    if (!(row[4] > 0) && prior[4] > 0) {
      const filled = row.slice();
      filled[4] = prior[4];
      return filled;
    }
    return row;
  });
  for (const row of existing) if (!currentNames.has(row[0].toLowerCase())) rows.push(row);
  return rows;
}

function order(rows) {
  const rank = (t) => {
    const i = TIER_ORDER.indexOf(t);
    return i < 0 ? TIER_ORDER.length : i;
  };
  return rows.slice().sort((a, b) => rank(a[1]) - rank(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Four rows per line keeps the embedded block readable without one-screen-per-entry. */
function literal(rows) {
  const lines = [];
  for (let i = 0; i < rows.length; i += 4) {
    const chunk = rows.slice(i, i + 4).map((r) => JSON.stringify(r));
    lines.push('  ' + chunk.join(', ') + (i + 4 < rows.length ? ',' : ''));
  }
  return 'const SPECIES = [\n' + lines.join('\n') + '\n];';
}

function inputFiles(args) {
  const paths = args.filter((a) => !a.startsWith('--'));
  const input = paths.length ? paths : [path.join(ROOT, 'shots', 'diag', 'chunks')];
  const files = [];
  for (const p of input) {
    if (!fs.existsSync(p)) return { error: 'bundle not found: ' + p };
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) {
        if (name.endsWith('.js')) files.push(path.join(p, name));
      }
    } else {
      files.push(p);
    }
  }
  if (!files.length) return { error: 'no .js bundles under ' + input.join(', ') };
  return { files };
}

function main(argv) {
  const args = argv.slice(2);
  const write = args.includes('--write');
  const fresh = args.includes('--fresh');
  const found = inputFiles(args);
  if (found.error || !found.files) {
    console.error(found.error);
    return 2;
  }

  const target = path.join(ROOT, 'src', 'ledger.js');
  const source = fs.readFileSync(target, 'utf8');
  const existing = fresh ? [] : existingRows(source);
  const current = [];
  const counts = [];
  for (const file of found.files) {
    const text = fs.readFileSync(file, 'utf8');
    const gold = goldByTier(text);
    const sizes = sizeByLabel(text);
    const base = extract(text);
    const built = extractBuilt(text, gold);
    const sized = extractSized(text, sizes, gold);
    const rows = merge(base, built, sized);
    current.push(...rows);
    if (rows.length) counts.push(path.basename(file) + ':' + rows.length);
  }

  const currentRows = merge(current);
  const rows = order(fresh ? currentRows : mergeExisting(currentRows, existing));
  if (rows.length < 100) {
    console.error('only ' + rows.length + ' species found - the bundle format probably changed');
    return 1;
  }

  const per = {};
  for (const r of rows) per[r[1]] = (per[r[1]] || 0) + 1;
  const block = literal(rows);
  console.log('species: ' + rows.length + ' (current ' + currentRows.length + ', existing ' + existing.length + ')');
  console.log('chunks: ' + (counts.join(', ') || 'none'));
  console.log('tiers: ' + JSON.stringify(per));
  console.log('block: ' + block.length + ' chars');
  if (!write) {
    console.log('\n' + block);
    return 0;
  }
  const a = source.indexOf(OPEN);
  const b = source.indexOf(CLOSE);
  if (a < 0 || b < 0) {
    console.error('catalogue sentinels are missing from autofish.js');
    return 1;
  }
  const next = source.slice(0, a + OPEN.length) + '\n' + block + '\n  ' + source.slice(b);
  fs.writeFileSync(target, next);
  console.log('wrote ' + target);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = {
  extract, extractBuilt, extractSized, existingRows, goldByTier, sizeByLabel,
  merge, mergeExisting, order, literal,
};
