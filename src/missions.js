// @ts-check
/* src/missions.js — read-only lofi.town Quests reader: thin DOM walk + pure parser.
 * UMD: browser global AutoFishMissions, CommonJS require('./src/missions.js').
 *
 * Read-only by contract (TASK-2026-11-28-missions-awareness-d1): nothing here clicks, and
 * `.cozy-missions-claim` stays observed-only here. Activation lives outside this module, in the
 * panel's guarded autoClaimPass() -> core pressElement() path (TASK-2026-11-28-missions-claim-d2).
 * Scope comes from the countdown format (HH:MM:SS daily vs D:HH:MM:SS weekly),
 * so the reader never needs to switch the game's own tabs.
 *
 * Evidence shapes come from the live M0 spike (2026-11-28): rows read as objective text,
 * a reward number ("450", "1,550"), then progress ("0/1") or status ("Complete"); the daily
 * countdown is HH:MM:SS and the weekly one D:HH:MM:SS.
 */
/**
 * @param {any} root
 * @param {() => Record<string, any>} factory
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AutoFishMissions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAILY_RE = /^\d{1,2}:\d{2}:\d{2}$/;
  var WEEKLY_RE = /^\d{1,2}:\d{2}:\d{2}:\d{2}$/;
  var REWARD_RE = /^\d{1,3}(,\d{3})*$/;
  var PROGRESS_RE = /^\d+\s*\/\s*\d+$/;
  var COMPLETE_RE = /^complete$/i;
  var CLAIM_CLASS = 'cozy-missions-claim';

  /**
   * Pure: which quest scope a countdown line belongs to. A plain clock time ("8:08") is neither.
   * @param {string} line
   * @returns {'daily' | 'weekly' | null}
   */
  function countdownScope(line) {
    var t = String(line || '').trim();
    if (WEEKLY_RE.test(t)) return 'weekly';
    if (DAILY_RE.test(t)) return 'daily';
    return null;
  }

  /**
   * Pure: decide which completed missions may be claimed, and say why. The only safe plan is an
   * exact one: the number of claim controls visible must equal the number of completed missions,
   * pairing them in row order. Zero controls with completed rows is the normal auto-grant shape
   * (M0 evidence), never a claim plan; any other combination is ambiguous and plans nothing.
   * @param {{ missions?: Array<{ complete?: boolean }>, claimCount?: number }} read
   * @returns {{ count: number, planned: number[], ambiguous: boolean, reason: string }}
   */
  function planClaims(read) {
    var missions = read && Array.isArray(read.missions) ? read.missions : [];
    var claimCount = read && typeof read.claimCount === 'number' && read.claimCount > 0 ? read.claimCount : 0;
    var completeIdx = [];
    for (var i = 0; i < missions.length; i++) {
      if (missions[i] && missions[i].complete) completeIdx.push(i);
    }
    if (!claimCount && !completeIdx.length) {
      return { count: 0, planned: [], ambiguous: false, reason: 'nothing to claim' };
    }
    if (!claimCount) {
      return { count: 0, planned: [], ambiguous: false, reason: 'auto-grant: completed quests show no claim controls' };
    }
    if (claimCount !== completeIdx.length) {
      return { count: claimCount, planned: [], ambiguous: true,
        reason: claimCount + ' claim control(s) vs ' + completeIdx.length + ' completed mission(s) - pairing unknown' };
    }
    return { count: claimCount, planned: completeIdx.slice(), ambiguous: false,
      reason: 'claim controls match completed missions in row order' };
  }

  /**
   * Pure: turn the Quests panel's text lines into mission records. Lines are scanned in order;
   * an objective is any non-numeric text line followed by a reward line and a progress
   * ("0/1") or status ("Complete") line. Headings, tab labels and the countdown are ignored.
   * A triple without its progress line is not a readable row and is left out — a missing line
   * never becomes a fabricated quest.
   * @param {string[]} lines
   * @returns {Array<{ objective: string, reward: string | null, progress: string | null, complete: boolean }>}
   */
  function parseLines(lines) {
    var out = [];
    var arr = Array.isArray(lines) ? lines : [];
    var i = 0;
    while (i < arr.length) {
      var line = String(arr[i] || '').trim();
      i++;
      if (!line || DAILY_RE.test(line) || WEEKLY_RE.test(line)) continue;
      if (/^(daily|weekly|quests?)$/i.test(line)) continue;
      if (REWARD_RE.test(line) || PROGRESS_RE.test(line) || COMPLETE_RE.test(line)) continue;
      /** @type {string | null} */
      var reward = null;
      /** @type {string | null} */
      var progress = null;
      if (i < arr.length && REWARD_RE.test(String(arr[i] || '').trim())) { reward = String(arr[i]).trim(); i++; }
      if (i < arr.length && (PROGRESS_RE.test(String(arr[i] || '').trim()) || COMPLETE_RE.test(String(arr[i] || '').trim()))) {
        progress = String(arr[i]).trim();
        i++;
      }
      if (progress == null) continue;
      out.push({
        objective: line,
        reward: reward,
        progress: PROGRESS_RE.test(progress) ? progress.replace(/\s/g, '') : null,
        complete: COMPLETE_RE.test(progress),
      });
    }
    return out;
  }

  /**
   * Pure: normalize one read. An explicit scope hint wins; otherwise the countdown format
   * decides; with neither, the read is honestly scoped "unknown".
   * @param {any[]} parsed
   * @param {string} countdown
   * @param {string} [scopeHint]
   */
  function shapeRead(parsed, countdown, scopeHint) {
    var scope = scopeHint || countdownScope(countdown) || 'unknown';
    return {
      scope: scope,
      countdown: countdown || null,
      missions: Array.isArray(parsed) ? parsed : [],
      claimVisible: false,
      readAt: new Date().toISOString(),
    };
  }

  /**
   * DOM walk (thin): read whatever the Quests panel shows right now, without clicking anything.
   * Returns null when the panel is not open or shows no readable rows. Claim controls are
   * counted and planned (pure planClaims); activation never happens here.
   * @param {Document} doc
   * @returns {Record<string, any> | null}
   */
  function readQuests(doc) {
    if (!doc || !doc.querySelector) return null;
    var root = /** @type {HTMLElement | null} */ (doc.querySelector('.cozy-missions-panel'));
    if (!root || !root.textContent) return null;
    var lines = String(root.innerText || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var countdown = '';
    for (var i = 0; i < lines.length; i++) {
      if (DAILY_RE.test(lines[i]) || WEEKLY_RE.test(lines[i])) { countdown = lines[i]; break; }
    }
    var parsed = parseLines(lines);
    if (!parsed.length) return null;
    /** @type {any} */
    var read = shapeRead(parsed, countdown);
    var claimCount = 0;
    try { claimCount = doc.querySelectorAll('.' + CLAIM_CLASS).length; } catch (e) { claimCount = 0; }
    read.claimCount = claimCount;
    read.claimVisible = claimCount > 0; // D1 field, kept for existing consumers
    read.claims = planClaims({ missions: read.missions, claimCount: claimCount });
    return read;
  }

  return { readQuests: readQuests, parseLines: parseLines, shapeRead: shapeRead, countdownScope: countdownScope, planClaims: planClaims };
});
