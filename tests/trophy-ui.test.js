'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
const TTL = 24 * 60 * 60 * 1000;
const CAP = 40;

function retentionHelpers() {
  const start = src.indexOf('/** kept cards leave the 24h TTL alone');
  const end = src.indexOf('/**\n   * Run one IndexedDB readwrite operation');
  assert.ok(start > 0 && end > start, 'retention helpers have stable sentinels');
  const sandbox = {
    TROPHY_TTL_MS: TTL,
    TROPHY_CAP: CAP,
    isRareChimeRow: (row) => row && (row.rarity === 'Legendary' || row.rarity === 'Secret' ||
      row.rarity === 'Halloween' || row.rarity === 'Christmas' || !!row.shiny || !!row.golden),
  };
  vm.runInNewContext(src.slice(start, end) + '\nthis.api = { trophyEvictionRank, trophyEvictionOrder, trophyRetention, trophySpan, trophyRetentionText };', sandbox);
  return sandbox.api;
}

function row(id, at, extra) {
  return Object.assign({ id, at, species: id, rarity: 'Epic', blob: {} }, extra || {});
}

test('retention reports headroom, nearest expiry and missing screenshots', () => {
  const { trophyRetention, trophyRetentionText } = retentionHelpers();
  const now = 1_800_000_000_000;
  const rows = [
    row('oldest', now - 23 * 3600_000, { species: 'Sardine' }),
    row('new', now - 60_000, { species: 'Tuna', blob: null }),
  ];
  const info = trophyRetention(rows, now);
  assert.equal(info.total, 2);
  assert.equal(info.cap, CAP);
  assert.equal(info.slots, CAP - 2);
  assert.equal(info.missing, 1);
  assert.equal(info.nextExpiryAt, now + 3600_000);
  assert.equal(info.evictAt, null, 'there is no eviction while the store has headroom');
  const text = trophyRetentionText(info, now);
  assert.match(text, /^2\/40 saved/);
  assert.match(text, /38 slots left/);
  assert.match(text, /oldest expires in 1h/);
  assert.match(text, /1 missing/);
});

test('retention names the next eviction at the hard cap and prefers ordinary cards', () => {
  const { trophyRetention } = retentionHelpers();
  const now = 1_800_000_000_000;
  const rows = [row('legendary', now - 60_000, { rarity: 'Legendary' })];
  for (let i = 0; i < 39; i++) rows.push(row('card' + i, now - 1000 - i * 1000, { rarity: 'Epic' }));
  const info = trophyRetention(rows, now);
  assert.equal(info.total, 40);
  assert.equal(info.slots, 0);
  assert.equal(info.evictAt.id, 'card38', 'the oldest ordinary card evicts before the newest Legendary');
  assert.match(trophyRetentionTextFor(info, now), /next capture evicts card38/);
});

function trophyRetentionTextFor(info, now) {
  return retentionHelpers().trophyRetentionText(info, now);
}

test('a kept expired card survives the TTL but is still below the hard cap', () => {
  const { trophyRetention, trophyEvictionOrder } = retentionHelpers();
  const now = 1_800_000_000_000;
  const rows = [
    row('kept', now - 48 * 3600_000, { keep: true, rarity: 'Secret' }),
    row('ordinary', now - 100, { rarity: 'Epic' }),
  ];
  const info = trophyRetention(rows, now);
  assert.equal(info.kept, 1);
  assert.equal(info.nextExpiryAt, now - 100 + TTL, 'the kept card has no expiry deadline');
  assert.equal(trophyEvictionOrder(rows[0], rows[1]) > 0, true, 'kept sorts behind an ordinary card');

  const full = rows.slice();
  for (let i = 0; i < 39; i++) full.push(row('fill' + i, now - i * 1000));
  assert.equal(trophyRetention(full, now).evictAt.id, 'fill38', 'a kept card does not get evicted while an ordinary card can go');
});

test('retention handles the empty store and formats short deadlines', () => {
  const { trophyRetention, trophyRetentionText, trophySpan } = retentionHelpers();
  const info = trophyRetention([], 1_800_000_000_000);
  assert.equal(info.total, 0);
  assert.equal(info.slots, CAP);
  assert.equal(info.evictAt, null);
  assert.match(trophyRetentionText(info, 1_800_000_000_000), /0\/40 saved · cards expire after 24h/);
  assert.equal(trophySpan(30_000), '1m');
  assert.equal(trophySpan(90 * 60_000), '1h 30m');
  assert.equal(trophySpan(0), 'soon');
});

test('the trophy viewer exposes retention, a reversible Keep control and shared eviction rules', () => {
  assert.ok(src.includes("el('button', 'trophy-lb-keep', 'Keep')"), 'the Keep action lives in the lightbox');
  assert.match(src, /setAttribute\('aria-pressed', rec\.keep \? 'true' : 'false'\)/, 'Keep exposes its pressed state');
  assert.ok(src.includes('Kept — survives 24h expiry; the 40-card cap still applies.'), 'the copy states both retention rules');
  assert.match(src, /if \(!rec\.keep && expired\)/, 'expired kept cards are not deleted');
  assert.match(src, /keptForProf\.sort\(trophyEvictionOrder\)/, 'pruning uses the shared eviction order');
  assert.match(src, /trophyCounts = \{ total: 0, missing: 0, Legendary: 0, Secret: 0, variant: 0, kept: 0/, 'the HUD count carries kept metadata');
  assert.match(src, /ui\.trophyHint\.textContent = trophyRetentionText\(info, Date\.now\(\)\)/, 'the footer uses the pure retention formatter');
});

test('saved-card cleanup is opt-in, backed up and reversible', () => {
  assert.ok(src.includes("el('button', 'icon csv trophy-clean', 'clean')"), 'cleanup is a visible viewer action');
  assert.ok(src.includes("'clean?'") && src.includes('cleanConfirmUntil'), 'cleanup needs the same two-step confirmation');
  const fn = src.slice(src.indexOf('async function cleanSavedTrophies'), src.indexOf('async function restoreTrophyOriginals'));
  assert.ok(fn.includes('trophyCleanBusy'), 'one cleanup run at a time');
  assert.ok(fn.includes('cleaning ') && fn.includes('targets.length'), 'progress names each card');
  assert.ok(fn.includes('if (!result) { failed++; continue; }'), 'a failed decode leaves the saved blob untouched');
  assert.ok(fn.includes('backupBlob: rec.backupBlob || rec.blob'), 'the original PNG is retained before replacement');
  assert.ok(fn.includes('cleanedAt: Date.now()'), 'cleaned cards are not reprocessed');
  assert.ok(fn.includes('cleanStats: finished.stats'), 'the cleanup stats are retained with the record');
  const imageFn = src.slice(src.indexOf('async function cleanTrophyBlob'), src.indexOf('async function cleanSavedTrophies'));
  assert.match(imageFn, /stripCardSpecks\(\{ d: frame\.data, w: w, h: h \}, \{ pad: 8, minFrac: 0\.01 \}\)/, 'the saved-card pass uses the capture cleanup');
  assert.ok(fn.includes('already clean'), 'clean cards are reported separately');
  const restore = src.slice(src.indexOf('async function restoreTrophyOriginals'), src.indexOf('async function refreshTrophyCounts'));
  assert.ok(restore.includes('r.backupBlob'), 'restore selects only backed-up cards');
  assert.ok(restore.includes('blob: rec.backupBlob') && restore.includes('backupBlob: null'), 'restore swaps the original back');
  assert.ok(restore.includes('cleanedAt: null'), 'restored cards can be cleaned again');
  assert.ok(src.includes("trophyRestore.addEventListener('click'"), 'the restore control is wired');
  assert.ok(src.includes('No original card images to restore.'), 'an empty restore is explained');
});
