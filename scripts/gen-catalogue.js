#!/usr/bin/env node
'use strict';
/**
 * Regenerate the species catalogue embedded in autofish.js.
 *
 * The game ships the whole fish table in its own JS bundle; the bot only needs the part that
 * names a rarity. This script pulls it out and rewrites the block between the catalogue
 * sentinels, so a game update is one command instead of hand-editing 136 rows.
 *
 *   node scripts/gen-catalogue.js [path/to/bundle.js] [--write]
 *
 * The bundle is a minified Next.js chunk (git-ignored under shots/diag/); fetch it once with
 *   curl -s https://app.lofi.town/_next/static/chunks/<chunk>.js -o shots/diag/c3763.js
 * Default input is shots/diag/c3763.js; without --write it only prints the table.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OPEN = '// <species-catalogue>';
const CLOSE = '// </species-catalogue>';
const TIER_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Secret', 'Halloween', 'Christmas'];

function extract(src) {
  // Weights and gold in the bundle are sometimes exponential (1e3, 5e4), hence the e-notation.
  const re = /\{name:"([^"]+)",rarityTier:"([^"]+)",minWeight:([0-9.eE+-]+),maxWeight:([0-9.eE+-]+),baseGold:([0-9.eE+-]+)\}/g;
  const seen = new Set();
  const rows = [];
  let m;
  while ((m = re.exec(src))) {
    const row = [m[1], m[2], Number(m[3]), Number(m[4]), Number(m[5])];
    if (seen.has(row[0])) continue;
    seen.add(row[0]);
    rows.push(row);
  }
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

function main(argv) {
  const args = argv.slice(2);
  const write = args.includes('--write');
  const file = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'shots', 'diag', 'c3763.js');
  if (!fs.existsSync(file)) {
    console.error('bundle not found: ' + file);
    return 2;
  }
  const rows = order(extract(fs.readFileSync(file, 'utf8')));
  if (rows.length < 100) {
    console.error('only ' + rows.length + ' species found - the bundle format probably changed');
    return 1;
  }
  const per = {};
  for (const r of rows) per[r[1]] = (per[r[1]] || 0) + 1;
  const block = literal(rows);
  console.log('species: ' + rows.length);
  console.log('tiers: ' + JSON.stringify(per));
  console.log('block: ' + block.length + ' chars');
  if (!write) {
    console.log('\n' + block);
    return 0;
  }
  const target = path.join(ROOT, 'autofish.js');
  const src = fs.readFileSync(target, 'utf8');
  const a = src.indexOf(OPEN);
  const b = src.indexOf(CLOSE);
  if (a < 0 || b < 0) {
    console.error('catalogue sentinels are missing from autofish.js');
    return 1;
  }
  const next = src.slice(0, a + OPEN.length) + '\n' + block + '\n  ' + src.slice(b);
  fs.writeFileSync(target, next);
  console.log('wrote ' + target);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { extract, order, literal };
