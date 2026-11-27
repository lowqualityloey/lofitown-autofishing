'use strict';
/**
 * The catch card is canvas text, so the reader is a heuristic over every string the page drew.
 * The pure half is extracted by its sentinels; the cursor that decides which strings belong to
 * the current card is the part that has to be guarded, because a stale cursor reads the previous
 * card into the next ledger row.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'autofish.js'), 'utf8');
const LOOP_SRC = readFileSync(join(__dirname, '..', 'src', 'loop.js'), 'utf8');
const T = require('../src/vision.js');
const TIER = (s) => /^(common|uncommon|rare|epic|legendary|secret|halloween|christmas)$/i.test(String(s));

function draw(list, t0) {
  const at = t0 == null ? 1000 : t0;
  return list.map((s, i) => ({ t: at + i, s }));
}

test('textSince keeps the card strings and drops bubbles, blanks and date digits', () => {
  const buf = draw(['CAST!', ' ', 'Lobster', '5', '3.36kg', '$10', 'REEL!', '$']);
  assert.deepEqual(T.textSince(buf, 0), ['Lobster', '3.36kg', '$10', '$']);
});

test('textSince keeps Unicode and punctuation in species names but drops bubbles and dates', () => {
  const buf = draw(['CAST!', 'Moʻo', 'A Penguin?', 'Wow! Fish', '5', '10 kg', '$100', 'REEL!']);
  assert.deepEqual(T.textSince(buf, 0), ['Moʻo', 'A Penguin?', 'Wow! Fish', '10 kg', '$100']);
});

test('textSince excludes everything at or before the cursor', () => {
  const first = draw(['Bass', '1.2kg', '$8'], 1000);
  const second = draw(['Koi Carp', '2.5kg', '$55'], 5000);
  const raw = T.textSince(first.concat(second), 4000);
  assert.deepEqual(raw, ['Koi Carp', '2.5kg', '$55'], 'the previous card must not leak into this one');
});

test('parseCard reads the documented card order', () => {
  const out = T.parseCard(['Lobster', 'Impressive', '3.36kg', '$10'], TIER);
  assert.equal(out.why, 'ok');
  assert.equal(out.rec.species, 'Lobster');
  assert.equal(out.rec.rarity, '', 'a common fish prints no rarity word');
  assert.equal(out.rec.quality, 'Impressive', 'the word in the rarity slot is the quality when it is not a tier');
  assert.equal(out.rec.weight, '3.36kg');
  assert.equal(out.rec.value, '$10');
});

test('parseCard resolves a printed rarity and a multi-word quality', () => {
  const out = T.parseCard(['Sun Fish', 'Epic', '4.08t', 'Exquisite', '$258'], TIER);
  assert.equal(out.why, 'ok');
  assert.equal(out.rec.species, 'Sun Fish');
  assert.equal(out.rec.rarity, 'Epic');
  assert.equal(out.rec.quality, 'Exquisite');
  assert.equal(out.rec.weight, '4.08t');
});

test('parseCard keeps Unicode and punctuation species names', () => {
  for (const name of ['Moʻo', 'A Penguin?', 'Mermaid?']) {
    const out = T.parseCard([name, 'Legendary', '10 kg', 'Pristine', '$100'], TIER);
    assert.equal(out.why, 'ok', name);
    assert.equal(out.rec.species, name, 'the species must not be replaced by the rarity word');
    assert.equal(out.rec.rarity, 'Legendary', name);
    assert.equal(out.rec.quality, 'Pristine', name);
    assert.equal(out.rec.weight, '10 kg');
    assert.equal(out.rec.value, '$100');
  }
});

test('a species name the card wraps across two draws is read whole', () => {
  const KNOWN = (s) => /^(yellowstripe goatfish|rocks with mussels|goby fish|sun fish)$/i.test(s);
  const wrap = T.parseCard(['Yellowstripe', 'Goatfish', '0.24kg', 'Decent', '$6'], TIER, KNOWN);
  assert.equal(wrap.why, 'ok');
  assert.equal(wrap.rec.species, 'Yellowstripe Goatfish', 'the second draw is part of the name, not the quality');
  assert.equal(wrap.rec.quality, 'Decent');
  assert.equal(wrap.rec.rarity, '', 'a common prints no rarity word');
  assert.equal(wrap.rec.weight, '0.24kg');
  const tall = T.parseCard(['Rocks with', 'Mussels', '7.31kg', 'Exquisite', '$26'], TIER, KNOWN);
  assert.equal(tall.rec.species, 'Rocks with Mussels');
  assert.equal(tall.rec.quality, 'Exquisite');
  // A very long name can take three lines, not two; the join is not limited to one extra piece.
  const three = T.parseCard(['Definitely', 'not', 'Catfish', 'Legendary', '100kg', 'Pristine', '$750'], TIER,
    (s) => s === 'Definitely not Catfish');
  assert.equal(three.rec.species, 'Definitely not Catfish');
  assert.equal(three.rec.rarity, 'Legendary');
  assert.equal(three.rec.quality, 'Pristine');
});

test('the join stops before a tier word and keeps the old read when the name is unknown', () => {
  const KNOWN = (s) => /^(sun fish)$/i.test(s);
  const tier = T.parseCard(['Sun Fish', 'Epic', '4.08t', 'Exquisite', '$258'], TIER, KNOWN);
  assert.equal(tier.rec.species, 'Sun Fish', 'Epic must stay the rarity');
  assert.equal(tier.rec.rarity, 'Epic');
  const odd = T.parseCard(['Mystery', 'Fish', '1.2kg', 'Fine', '$9'], TIER, KNOWN);
  assert.equal(odd.rec.species, 'Mystery', 'without a catalogue match the single-word read is kept');
  assert.equal(odd.rec.quality, 'Fish', 'no join may silently swallow the quality word');
});

test('every catalogue name survives being wrapped at any word boundary', () => {
  const LSRC = readFileSync(join(__dirname, '..', 'src', 'ledger.js'), 'utf8');
  const c = LSRC.indexOf('// <species-catalogue>');
  const d = LSRC.indexOf('// </species-catalogue>');
  const names = [...LSRC.slice(c, d).matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
  const set = new Set(names.map((n) => n.toLowerCase()));
  const KNOWN = (s) => set.has(String(s).toLowerCase());
  let wrapped = 0;
  for (const name of names) {
    const cut = name.lastIndexOf(' ');
    if (cut < 0) continue;
    wrapped++;
    const out = T.parseCard([name.slice(0, cut), name.slice(cut + 1), '1.2kg', 'Fine', '$9'], TIER, KNOWN);
    assert.equal(out.rec.species, name, name + ' lost the half the card wrapped');
    assert.equal(out.rec.quality, 'Fine');
  }
  assert.ok(wrapped > 150, 'most catalogue names are multi-word');
});

test('the live reader hands the catalogue lookup to parseCard', () => {
  assert.match(SRC, /parseCard\(textSince\(hookText\(\), F\.txtAt \|\| 0\), normTier, function \(name\) \{/);
  assert.match(SRC, /return speciesInfo\(name\)\.known;/);
});

test('a decimal price is a price, not a parse failure', () => {
  assert.equal(T.MONEY.test('$1,204.50'), true);
  const out = T.parseCard(['Blue Lobster', 'Rare', '3.86kg', 'Pristine', '$1,204.50'], TIER);
  assert.equal(out.why, 'ok');
  assert.equal(out.rec.value, '$1,204.50');
});

test('every catalogue name passes the card word matcher', () => {
  const LSRC = readFileSync(join(__dirname, '..', 'src', 'ledger.js'), 'utf8');
  const c = LSRC.indexOf('// <species-catalogue>');
  const d = LSRC.indexOf('// </species-catalogue>');
  const block = LSRC.slice(c, d);
  const names = [...block.matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
  assert.ok(names.length > 200, 'the catalogue should be the full table');
  for (const name of names) assert.ok(T.WORD.test(name), name + ' would be dropped by the card reader');
});

test('a card with no price says why instead of inventing a catch', () => {
  assert.deepEqual(T.parseCard(['Lobster', '3.36kg'], TIER), { why: 'noprice' });
  assert.deepEqual(T.parseCard([], TIER), { why: 'empty' });
  assert.deepEqual(T.parseCard(['$10'], TIER), { why: 'nowords' });
});

test('a card that never parsed moves the cursor before it is tapped away', () => {
  const at = LOOP_SRC.indexOf("L('catch text missing'");
  assert.ok(at > 0, 'the missing-text branch is missing');
  const branch = LOOP_SRC.slice(at, at + 600);
  const cursor = branch.indexOf('F.txtAt = o.now ? o.now() : t;');
  const tap = branch.indexOf('tap(card.cx, card.cy);');
  assert.ok(cursor > 0, 'the text cursor must advance past an unparsed card');
  assert.ok(tap > cursor, 'the cursor has to move before the card is dismissed');
});
