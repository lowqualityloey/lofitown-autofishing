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
const OPEN = '// <card-text>';
const CLOSE = '// </card-text>';
const a = SRC.indexOf(OPEN);
const b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('card-text sentinels are missing from autofish.js');
const T = new Function(SRC.slice(a + OPEN.length, b) + '\nreturn { textSince, parseCard, WEIGHT, MONEY, WORD };')();
const TIER = (s) => /^(common|uncommon|rare|epic|legendary|secret|halloween|christmas)$/i.test(String(s));

function draw(list, t0) {
  const at = t0 == null ? 1000 : t0;
  return list.map((s, i) => ({ t: at + i, s }));
}

test('textSince keeps the card strings and drops bubbles, blanks and date digits', () => {
  const buf = draw(['CAST!', ' ', 'Lobster', '5', '3.36kg', '$10', 'REEL!', '$']);
  assert.deepEqual(T.textSince(buf, 0), ['Lobster', '3.36kg', '$10', '$']);
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

test('a decimal price is a price, not a parse failure', () => {
  assert.equal(T.MONEY.test('$1,204.50'), true);
  const out = T.parseCard(['Blue Lobster', 'Rare', '3.86kg', 'Pristine', '$1,204.50'], TIER);
  assert.equal(out.why, 'ok');
  assert.equal(out.rec.value, '$1,204.50');
});

test('a card with no price says why instead of inventing a catch', () => {
  assert.deepEqual(T.parseCard(['Lobster', '3.36kg'], TIER), { why: 'noprice' });
  assert.deepEqual(T.parseCard([], TIER), { why: 'empty' });
  assert.deepEqual(T.parseCard(['$10'], TIER), { why: 'nowords' });
});

test('a card that never parsed moves the cursor before it is tapped away', () => {
  const at = SRC.indexOf("L('catch text missing'");
  assert.ok(at > 0, 'the missing-text branch is missing');
  const branch = SRC.slice(at, at + 600);
  const cursor = branch.indexOf('F.txtAt = now();');
  const tap = branch.indexOf('tap(card.cx, card.cy);');
  assert.ok(cursor > 0, 'the text cursor must advance past an unparsed card');
  assert.ok(tap > cursor, 'the cursor has to move before the card is dismissed');
});
