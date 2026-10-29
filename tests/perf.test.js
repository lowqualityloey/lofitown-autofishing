'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Reading the UI layer is a GPU readback (~2.1 ms per 360x210 read against the live game) and the
// per-pixel PX() helper allocates a 4-element array every call. Doing both once per frame dropped
// the page from 141 fps to 27.6 fps (measured live 2026-10-28), so these guards keep the scan rates
// and the allocation-free loops from creeping back in.

const CORE = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');

function fnBody(start) {
  const a = CORE.indexOf(start);
  assert.ok(a >= 0, start + ' is missing');
  const b = CORE.indexOf('\n  }', a);
  assert.ok(b > a, 'the end of ' + start + ' is missing');
  return CORE.slice(a, b);
}

test('the bubble scan is throttled to ~25 Hz idle and ~11 Hz with a dial locked', () => {
  const fn = fnBody('F.findBubble = function ()');
  assert.match(fn, /const t = now\(\);/);
  assert.match(fn, /F\.bubbleScanAt/);
  const m = fn.match(/<\s*\(F\.geo \? (\d+) : (\d+)\)/);
  assert.ok(m, 'the throttle interval is missing');
  assert.ok(Number(m[1]) >= 90, 'a locked dial must not read the layer more than ~11 Hz');
  assert.ok(Number(m[2]) >= 40, 'the idle scan must not read the layer more than ~25 Hz');
});

test('the full-surface prompt scan is throttled to a few Hz', () => {
  const fn = fnBody('function bubbleAnywhere()');
  const m = fn.match(/promptAt < (\d+)/);
  assert.ok(m, 'the prompt scan throttle is missing');
  assert.ok(Number(m[1]) >= 300, 'the whole-surface readback must not run more than ~3 Hz');
});

test('the bubble box scan reads channels by index instead of allocating per pixel', () => {
  const fn = fnBody('function bubbleInBox()');
  assert.ok(!/PX\(/.test(fn), 'bubbleInBox must not call PX() - it allocates an array per pixel');
  assert.ok(!/\[r\.d\[i\]/.test(fn), 'a per-pixel array literal came back');
  assert.match(fn, /d\[i \+ 3\] > 120 && d\[i\] >= 225/, 'the flat white test is missing');
  assert.match(fn, /new Array\(w\)\.fill\(0\)/, 'the single-pass column count is missing');
});

test('the bubble height and width do not shadow the buffer stride', () => {
  const fn = fnBody('function bubbleInBox()');
  assert.ok(!/const w = x - s;/.test(fn), 'the bubble width must not shadow the buffer width');
  assert.ok(!/const h = y1 - y0;/.test(fn), 'the bubble height must not shadow the buffer height');
});
// The dial search, not the dial sample, was the second lag (measured live 2026-10-28): 83 ms per
// lockDial call at 8 calls a second, i.e. two thirds of the main thread whenever no dial was on
// screen. These guards keep the fixed shape: precomputed direction tables, index-only predicates,
// one rim mask per read, and a throttled catch-card scan.

function slice(from, to) {
  const a = CORE.indexOf(from);
  assert.ok(a >= 0, from + ' is missing');
  const b = CORE.indexOf(to, a);
  assert.ok(b > a, to + ' is missing after ' + from);
  return CORE.slice(a, b);
}

test('the dial search counts a rim mask instead of test-allocating per sample', () => {
  const fn = slice('F.lockDial = function (hintX, hintY, span)', 'F.sample = function');
  assert.match(fn, /rimMask\(r\)/, 'lockDial must mark the rim once');
  const coarse = fn.slice(fn.indexOf('const mask = rimMask(r);'), fn.indexOf('if (!best) return null;'));
  assert.match(coarse, /for \(let k = 0; k < 20; k\+\+\)/, 'the coarse scan counts mask hits inline');
  assert.match(coarse, /mask\[y \* rw \+ x\]/, 'and reads the mask by index, not through a helper');
  assert.ok(!/rimHits\(/.test(coarse), 'a helper call per candidate circle came back');
  assert.match(coarse, /hit >= 15/, '15/20 is the measured gate; 17 misses a real dial');
  const refine = slice('function finishLock(r, mask, best)', 'F.lockDial = function');
  assert.match(refine, /rimHits\(mask, r, best\.cx, best\.cy, R, RIM_C40, RIM_S40, 40\)/, 'the refinement must still check 40 samples');
  assert.ok(!/Math\.cos|Math\.sin/.test(fn), 'the direction tables must replace per-sample trig');
  assert.ok(!/PX\(/.test(fn), 'lockDial must not allocate a pixel array per sample');
  assert.ok(!/RIM\(/.test(fn), 'lockDial must read the mask, not the raw predicate');
});

test('the dial sample reads its three rings by index, without per-sample arrays', () => {
  const fn = slice('F.sample = function (geo)', 'function cancelPend');
  assert.ok(!/PX\(/.test(fn), 'F.sample must not allocate a pixel array per sample');
  assert.ok(!/Math\.cos\(|Math\.sin\(/.test(fn), 'F.sample must use the DIAL_/PIN_ tables');
  assert.match(fn, /isRim\(d, \(y \* rw \+ x\) \* 4\)/);
  assert.match(fn, /isGreen\(d, \(y \* rw \+ x\) \* 4\)/);
  assert.match(fn, /isPin\(d, \(y \* rw \+ x\) \* 4\)/);
});

test('the rim helpers are built from tables and read channels by index', () => {
  assert.match(CORE, /const RIM_C20 = new Float64Array\(20\)/);
  assert.match(CORE, /const RIM_C40 = new Float64Array\(40\)/);
  assert.match(CORE, /const DIAL_N = 72/);
  assert.match(CORE, /const PIN_N = PIN_F\.length;/);
  for (const name of ['isRim', 'isGreen', 'isPin', 'rimMask', 'rimHits']) {
    const fn = slice('function ' + name + '(', '\n  }');
    assert.ok(!/PX\(/.test(fn), name + ' must not call PX()');
    assert.ok(!/\[d\[i\]/.test(fn), name + ' must not build a pixel array');
  }
  const mix = slice('function inkMix(r)', 'let promptAt = 0;');
  assert.ok(!/PX\(/.test(mix), 'inkMix must not allocate a pixel array per pixel');
});

// Measured live 2026-10-28: the detectors pulled four copies of the UI layer a second between them
// - bubble box, card box, prompt fallback, card shape - 107-117 ms of every second spent in
// blocking GPU readbacks. They all read one quarter-scale grab now, and a full-resolution read is
// spent only on something that grab already saw.

test('one quarter-scale grab per scan tick feeds every detector', () => {
  const snap = slice('function snapshot()', '// <scan-core>');
  assert.match(snap, /scanTickMs\) \|\| 66/, 'the snapshot must throttle itself to one grab per tick');
  assert.match(CORE, /scanTickMs: 66/, 'the shared scan tick is missing from the defaults');
  assert.equal((CORE.match(/!downscale\(\)/g) || []).length, 1, 'a detector took its own copy of the layer again');
  for (const start of ['function bubbleAnywhere()', 'function cardByShape()']) {
    const fn = fnBody(start);
    assert.match(fn, /snapshot\(\)/, start + ' must read the shared snapshot');
    assert.doesNotMatch(fn, /downscale\(\)/, start + ' must not pull its own copy of the layer');
  }
  for (const start of ['F.findBubble = function ()', 'F.findCatch = function ()']) {
    const fn = fnBody(start);
    assert.match(fn, /if \(!snapshot\(\)\) return null;/, start + ' must ask for the shared grab');
  }
});

test('a full-resolution read is spent only on something the snapshot already saw', () => {
  const bubble = fnBody('F.findBubble = function ()');
  const bGate = bubble.indexOf('bubbleGate()'), bBox = bubble.indexOf('bubbleInBox()');
  assert.ok(bGate > 0 && bBox > bGate, 'the bubble box read must sit behind the snapshot gate');
  const card = fnBody('F.findCatch = function ()');
  const cGate = card.indexOf('cardGate()'), cBox = card.indexOf('cardInBox()');
  assert.ok(cGate > 0 && cBox > cGate, 'the card box read must sit behind the snapshot gate');
  // one definition plus one call site: nothing else may spend the readback directly
  assert.equal((CORE.match(/bubbleInBox\(\)/g) || []).length, 2, 'a second bubble box read came back');
  assert.equal((CORE.match(/cardInBox\(\)/g) || []).length, 2, 'a second card box read came back');
  assert.match(fnBody('function bubbleGate()'), /BUBBLE_GATE_PX/);
  assert.match(fnBody('function cardGate()'), /hit \/ n >= 0\.08/);
});

test('the catch-card scan is throttled to about 10 Hz', () => {
  const fn = slice('F.findCatch = function ()', 'F.lockDial = function (');
  const m = fn.match(/cardCheckMs \|\| (\d+)/);
  assert.ok(m, 'the card-scan throttle is missing');
  assert.ok(Number(m[1]) >= 100, 'a card waits for a tap; there is nothing to win by scanning faster');
});

// A white blob is not always the cast button. Measured live 2026-10-28: a false-positive bubble was
// tapped every ~0.9 s for 60+ s with no cast, because the bubble branch returns before the cast
// retry. These guards keep the bounded recovery ladder (click -> keybind -> stand up) wired in.

test('the bubble branch escalates instead of tapping the same blob forever', () => {
  const btn = CORE.indexOf('const b = F.findBubble();');
  assert.ok(btn > 0, 'the bubble branch is missing');
  const branch = CORE.slice(btn, btn + 2600);
  assert.match(branch, /const rung = \(F\.bubbleMiss = \(F\.bubbleMiss \|\| 0\) \+ 1\);/);
  assert.match(branch, /castRecovery\(rung\)/);
  assert.match(branch, /if \(rec\.tap\)/);
  assert.match(branch, /if \(rec\.space\)/);
  // a plain unconditional tap() that ignored the ladder is what caused the first stall
  assert.doesNotMatch(branch, /\n\s{8}tap\(b\.cx, b\.cy\);/);
  // ... but the ladder must never give the click up either. Measured live 2026-10-29: rungs 14-36
  // were all `tap:false`, so the bot pressed a key the game ignored for twenty minutes while a
  // REEL! prompt sat on screen. The click is the one input that has ever started the minigame.
  assert.match(branch, /if \(rec\.tap\) tap\(b\.cx, b\.cy\);/);
  assert.doesNotMatch(CORE, /return \{ tap: false, space: true/);
});

test('the dial hint follows the prompt it can see, not only the prompt it clicked', () => {
  const btn = CORE.indexOf('const b = F.findBubble();');
  const branch = CORE.slice(btn, btn + 2600);
  const hint = branch.indexOf('F.hint = { x: b.cx, y: b.cy + 53 };');
  const tap = branch.indexOf('if (rec.tap) tap(b.cx, b.cy);');
  assert.ok(hint > 0, 'the bubble branch must set the dial hint');
  assert.ok(tap > hint, 'the hint belongs before the tap gate, or a rung that stops tapping freezes it');
});

test('the dial rim search accepts a real rim, not only a perfect one', () => {
  // The live dial measures 17/20 rim samples at a 1680x1031 viewport, so a 17-of-20 gate sat
  // exactly on its own boundary: one anti-aliased sample and lockDial found nothing.
  const fn = slice('F.lockDial = function (hintX, hintY, span)', 'F.sample = function');
  assert.match(fn, /hit >= 15/);
  assert.doesNotMatch(fn, /hit >= 17/);
});

test('a dial that locked before is tried first, so a drifted hint cannot hide it', () => {
  const fn = slice('F.lockDial = function (hintX, hintY, span)', 'F.sample = function');
  const remembered = fn.indexOf('if (F.lastGeo)');
  const search = fn.indexOf('const mask = rimMask(r)');
  assert.ok(remembered > 0, 'lockDial must try the last known dial geometry');
  assert.ok(search > remembered, 'the remembered circle has to be tried before the search');
  assert.match(CORE, /F\.lastGeo = \{ cx: g\.cx, cy: g\.cy, R: g\.R \};/);
});

test('a prompt that went away starts the recovery ladder over', () => {
  assert.match(CORE, /castRungResetMs: \d+/);
  assert.match(CORE, /F\.bubbleMiss = 0;\n?\s*F\.lastBubble = b;/);
});

test('a locked dial resets the recovery ladder, so the next cast starts at rung one', () => {
  const m = CORE.match(/F\.bubbleMiss = 0; F\.stallRetry = 0;[^\n]*the ladder worked[^\n]*/);
  assert.ok(m, 'the dial lock must reset bubbleMiss and stallRetry');
  const lock = CORE.indexOf("L('dial locked'");
  assert.ok(lock > m.index, 'the reset has to happen when the lock succeeds');
  assert.ok(lock - m.index < 900, 'the reset belongs next to the lock');
});

test('the cast retry sends only the keybind - there is no bubble to click', () => {
  // The ladder used to be called here and its answer dropped, so the test certified a no-op.
  const from = CORE.indexOf('if (F.opts.castRetryMs');
  const at = CORE.indexOf("L('cast retry'");
  assert.ok(from > 0 && at > from);
  const around = CORE.slice(from, at + 60);
  assert.match(around, /space\(F\.opts\.spaceTarget\)/);
  assert.doesNotMatch(around, /castRecovery\(/, 'the stall path has no bubble to click');
  assert.doesNotMatch(around, /tap\(/, 'the stall path has no coordinates to tap');
});

// Fishing in this game is seat-based: the cast prompt is emitted only by the sit-down path
// (isRaycastHittingWater -> showCastButton) and by the post-fish result. A walk stands the character
// up, i.e. it destroys the only thing that produces the prompt - measured live 2026-10-28 it walked
// the character behind a building instead of recovering anything.

test('no movement key is ever synthesised - sitting is what makes a cast possible', () => {
  assert.doesNotMatch(CORE, /walkNudge\(/);
  assert.doesNotMatch(CORE, /function clearWalk/);
  assert.doesNotMatch(CORE, /\.walk\b/);
  assert.doesNotMatch(CORE, /walkHoldMs/);
});

test('a missing cast prompt is named, not clicked at forever', () => {
  assert.match(CORE, /seatWatchdogMs: \d+/);
  assert.match(CORE, /L\('needs a seat'/);
  assert.match(CORE, /F\.needsSeat = true;/);
  // the flag has to clear again once a prompt or a dial proves the character is seated
  assert.match(CORE, /F\.needsSeat = false;[^\n]*the character is seated/);
  assert.match(CORE, /F\.needsSeat = false;[^\n]*the cast took/);
  const status = CORE.slice(CORE.indexOf('F.status = function'), CORE.indexOf('F.status = function') + 1600);
  assert.match(status, /needsSeat:/);
});

test('the ladder counts cast attempts, not frames', () => {
  // Counting frames ran the rung to 4567 in one second and left the bot walking instead of clicking.
  const btn = CORE.indexOf('const b = F.findBubble();');
  const branch = CORE.slice(btn, btn + 1800);
  const gate = branch.indexOf('if (t - F.lastPress > F.opts.bubbleDebounceMs) {');
  assert.ok(gate > 0, 'the debounce gate is missing');
  const rung = branch.indexOf('const rung = (F.bubbleMiss = (F.bubbleMiss || 0) + 1);');
  assert.ok(rung > gate, 'the rung must only advance once per cast attempt (inside the debounce gate)');
});

// The whole-surface scan runs ~3x/s over ~108k downscaled pixels. `spx()` built a 4-element array
// per pixel and the flood fill built another per visited pixel - the same allocation pattern that
// dropped the page to 27.6 fps in bubbleInBox, reintroduced in the one loop nobody rewrote.
const SCAN_OPEN = '// <scan-core>';
const SCAN_CLOSE = '// </scan-core>';
const scanA = CORE.indexOf(SCAN_OPEN);
const scanB = CORE.indexOf(SCAN_CLOSE);
if (scanA < 0 || scanB < 0) throw new Error('scan-core sentinels are missing from autofish.js');
const SCAN = new Function(CORE.slice(scanA + SCAN_OPEN.length, scanB) + '\nreturn { floodComponents };')();

test('floodComponents finds 4-connected blobs and honours minPx', () => {
  const w = 8, h = 6;
  const d = new Uint8ClampedArray(w * h * 4);
  const put = (x, y) => { d[(y * w + x) * 4 + 3] = 255; };
  [[1, 1], [2, 1], [1, 2], [6, 0], [7, 0], [0, 5]].forEach(([x, y]) => put(x, y));
  const seen = new Uint8Array(w * h);
  const out = SCAN.floodComponents(w, h, d, (buf, i) => buf[i + 3] > 120, 2, seen);
  assert.equal(out.length, 2, 'the lone edge pixel is below minPx');
  const byCount = out.slice().sort((a, b) => b.count - a.count);
  assert.deepEqual(byCount[0], { x0: 1, y0: 1, x1: 2, y1: 2, count: 3 });
  assert.deepEqual(byCount[1], { x0: 6, y0: 0, x1: 7, y1: 0, count: 2 }, 'a blob on the top edge is not clipped');
});

test('the connected-component pass allocates no per-pixel arrays', () => {
  const fn = CORE.slice(CORE.indexOf('function floodComponents'), scanB);
  assert.ok(!/spx\(/.test(fn), 'spx() allocates an array per pixel');
  assert.ok(!/const near = \[/.test(fn), 'the neighbour array is back');
  assert.match(fn, /near4\[0\]/, 'the scratch neighbour array is missing');
  assert.ok(CORE.indexOf('function spx(') < 0, 'spx() must be gone, not merely unused');
  const blobs = CORE.slice(CORE.indexOf('function blobs('), CORE.indexOf('function blobs(') + 400);
  assert.match(blobs, /floodComponents\(sw, sh, sdata, match, minPx, seenBuf\)/, 'blobs must pass the shared snapshot and scratch');
});

// The prompt box was measured on a 1620x1031 surface. As a fixed rectangle it only fits that size:
// at 1100x700 the bubble centre lands at (550, 243), left of the old x=690, so the cheap boxed scan
// saw nothing and every prompt paid a whole-surface pass instead.
const BOX_OPEN = '// <prompt-box>';
const BOX_CLOSE = '// </prompt-box>';
const boxA = CORE.indexOf(BOX_OPEN);
const boxB = CORE.indexOf(BOX_CLOSE);
if (boxA < 0 || boxB < 0) throw new Error('prompt-box sentinels are missing from autofish.js');
const BOX = new Function(CORE.slice(boxA + BOX_OPEN.length, boxB) + '\nreturn { promptBox, BUBBLE_BOX_REF };')();

test('the prompt box at the measured size is exactly the measured rectangle', () => {
  assert.deepEqual(BOX.promptBox(1620, 1031), { x: 690, y: 215, w: 360, h: 210 });
  assert.deepEqual(BOX.promptBox(), { x: 690, y: 215, w: 360, h: 210 }, 'no canvas means the reference surface');
  assert.equal(BOX.BUBBLE_BOX_REF.cw, 1620);
});

test('the prompt box follows a smaller live surface and still holds the bubble', () => {
  const box = BOX.promptBox(1100, 700);
  const bx = 810 * 1100 / 1620, by = 358 * 700 / 1031;   // where the bubble centre lands
  assert.ok(box.x <= bx && bx <= box.x + box.w, 'the box misses the bubble horizontally');
  assert.ok(box.y <= by && by <= box.y + box.h, 'the box misses the bubble vertically');
  assert.ok(box.w < 360 && box.h < 210, 'a smaller window must not read a bigger box');
  assert.ok(box.w >= 260 && box.h >= 150, 'the bubble itself does not shrink with the window');
});

test('the prompt box contains the prompt measured live at 1117x785', () => {
  // Field run 2026-10-29: the CAST! bubble was detected at (558,234). The fixed 1620x1031 box
  // (690..1050) could never contain it, so all 11 prompts came from the whole-surface fallback.
  const box = BOX.promptBox(1117, 785);
  assert.ok(box.x <= 558 && 558 <= box.x + box.w, 'the live prompt is left of the box again');
  assert.ok(box.y <= 234 && 234 <= box.y + box.h, 'the live prompt is above the box again');
  assert.ok(box.w * box.h < 1117 * 785 / 4, 'the boxed scan must stay much cheaper than the whole surface');
});

test('the prompt box never leaves the surface', () => {
  for (const [w, h] of [[1680, 1031], [1100, 700], [640, 400], [320, 200], [200, 120]]) {
    const b = BOX.promptBox(w, h);
    assert.ok(b.x >= 0 && b.y >= 0, 'negative origin at ' + w + 'x' + h);
    assert.ok(b.x + b.w <= w, 'overflows width at ' + w + 'x' + h);
    assert.ok(b.y + b.h <= h, 'overflows height at ' + w + 'x' + h);
    assert.ok(b.w > 0 && b.h > 0);
  }
});

test('both prompt scans size their box from the live canvas, not a literal', () => {
  assert.doesNotMatch(CORE, /BOX_BUBBLE\b/);
  for (const start of ['function bubbleInBox()', 'function bubbleGate()']) {
    const fn = fnBody(start);
    assert.match(fn, /promptBox\(uiCanvas && uiCanvas\.width, uiCanvas && uiCanvas\.height\)/, start + ' must size its box from the canvas');
    assert.match(fn, /readUI\(box\.x|box\.x \/ SDOWN/, start + ' must use the computed box');
  }
});

// Zen/Gecko pays much more for a canvas readback than Chromium does. The tuning has to follow a
// measurement from the machine that hurts, so the probe reports frame gaps and per-detector cost
// instead of us guessing at throttles.

test('the perf probe reports frame gaps and per-detector cost', () => {
  assert.match(CORE, /F\.perf = function \(\)/);
  assert.match(CORE, /perf\.gaps\.push\(frameAt - perf\.last\)/);
  assert.match(CORE, /Object\.keys\(PERF_KEYS\)/);
  for (const name of ['findBubble', 'findCatch', 'lockDial', 'sample']) {
    assert.ok(CORE.includes(name + ':'), name + ' is instrumented');
  }
  assert.match(CORE, /perf\.gaps\.length > 600/, 'the gap buffer is bounded');
  assert.match(CORE, /perfRates\(calls, totals, uptime\)/, 'the probe reports rates, not just totals');
  assert.match(CORE, /uptimeMs: Math\.round\(uptime\)/, 'the report is normalised by how long it ran');
  assert.match(CORE, /perf\.stoppedAt = now\(\)/, 'the window freezes at stop, so a report read afterwards is not diluted');
});
