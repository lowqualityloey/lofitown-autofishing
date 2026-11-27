'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// panel.js mounts itself and needs a DOM, so these are source-level guards on the interactions that
// cannot be exercised in node. They exist because a dead-looking-alive button shipped once: the drag
// handler on .head captured the pointer, the browser then computed the click against the host, and
// the collapse button inside the head never fired.
const src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');

test('the panel head names the build, so a stale tab is visible at a glance', () => {
  // The Neo tab ran a build from before perf() with no way to tell from the panel. The label is
  // derived from __fish.version (stamped by build-userscript.js), never a hand-typed constant.
  assert.ok(src.includes('function versionLabel()'), 'the label is derived, not hard-coded');
  assert.match(src, /head\.append\(dot, title, ver, chip, min\)/, 'the label sits in the head');
  assert.ok(src.includes("v === 'dev' ? 'dev' : 'v' + v"), 'an unbundled copy says dev, not vdev');
  assert.ok(src.includes("ver.title = 'build '"), 'hovering explains what it is');
});

test('the collapse button is wired, and the pill brings the panel back', () => {
  assert.match(src, /min\.addEventListener\('click', function \(\) \{ userExpanded = false; setCollapsed\(true\); \}\)/);
  assert.match(src, /pill\.addEventListener\('click', function \(\) \{ userExpanded = true; setCollapsed\(false\); \}\)/);
});

test('dragging never steals a click from a button inside the head', () => {
  const startDrag = src.slice(src.indexOf('function startDrag(e)'), src.indexOf('function onDrag(e)'));
  assert.ok(startDrag.indexOf("closest('button')") > 0, 'startDrag must ignore pointerdown on a button');
  // the guard has to run before the capture, or the capture retargets the pointerup anyway
  const captureAt = startDrag.indexOf('host.setPointerCapture(e.pointerId)');
  assert.ok(captureAt > 0, 'startDrag still captures the pointer for real drags');
  assert.ok(
    startDrag.indexOf("closest('button')") < captureAt,
    'the button guard must come before setPointerCapture'
  );
});

test('the panel keeps a clear position instead of snapping back when a card clears', () => {
  assert.match(src, /var placed = false;/, 'the panel needs a first-placement flag');
  const place = src.slice(src.indexOf('function place()'), src.indexOf('function restorePosition()'));
  assert.match(place, /if \(placed\) \{/, 'the current position is considered');
  assert.match(place, /L\.intersects\(/, 'a position is kept only when it clears the game');
  assert.match(place, /placed = true;/, 'a successful placement is remembered');
});

test('collapsing actually hides the card and shows the 48px pill', () => {
  assert.match(src, /\.hide\{display:none\}/);
  assert.match(src, /\.pill\{width:48px;height:48px/);
  const setCollapsed = src.slice(src.indexOf('function setCollapsed(next)'), src.indexOf('function startDrag(e)'));
  assert.match(setCollapsed, /ui\.card\.classList\.toggle\('hide', collapsed\)/);
  assert.match(setCollapsed, /ui\.pill\.classList\.toggle\('hide', !collapsed\)/);
  // the choice has to survive a reload
  assert.match(setCollapsed, /pos\.collapsed = collapsed/);
});
test('the panel never assumes a local server it was not served from', () => {
  assert.ok(src.indexOf("'http://127.0.0.1:8731'") < 0, 'the server-free build must not guess a port');
  const post = src.slice(src.indexOf('function postSessionRow'), src.indexOf('function captureDiag'));
  assert.match(post, /var server = BASE \|\| captureServer\(\);/, 'a served panel uses its origin; an inlined one uses the capture address');
  assert.match(post, /if \(!server\) return;/, 'no fetch without an address');
  assert.ok(post.includes("server + '/session'"), 'the row goes to the same fishserve the sampler uses');
  assert.ok(!/if \(!BASE\) return;/.test(post), 'an inlined panel no longer stays silent');
  assert.ok(!/http:\/\/127\.0\.0\.1:/.test(post), 'and it still never guesses a port');
  assert.match(src, /function syncBudget\(\)/, 'the finished session counts in the local budget');
  assert.match(src, /if \(!BASE\) return;/, 'diagnosis uploads must not run without a server');
});

test('the daily cap survives a reload and a second session in the same page', () => {
  const load = src.slice(src.indexOf('async function loadToday()'), src.indexOf('function postSessionRow'));
  // An inlined userscript has no BASE, so it reads back from the same capture address it posts to;
  // returning on !BASE made the panel write rows it could never read (live 2026-11-21: the panel
  // showed 5.4 minutes today while its own fishserve held 115 for the same profile and day).
  assert.match(load, /var origin = BASE \|\| captureServer\(\);/, 'the read-back uses the address the rows were posted to');
  assert.match(load, /if \(!origin\) return;/, 'the server is optional, the local budget is not');
  assert.ok(!/if \(!BASE\) return;/.test(load), 'an inlined install no longer skips its own rows');
  assert.ok(load.includes("origin + '/sessions?day='"), 'the day is asked for by profile, from that origin');
  const start = src.slice(src.indexOf('startCore: function'), src.indexOf('stopCore:'));
  assert.match(start, /baseTodayMs = loadBudget\(\)\.ms/, 'a new session must re-read the day');
  assert.match(src, /var BUDGET_KEY = 'autofish:budget:v1'/);
});

test('a reload row carries the interrupted session it ended', () => {
  // Live 2026-11-21: both reload rows in sessions.csv read `catches 0`, because the heartbeat never
  // recorded the count and checkInterrupted posted a literal 0. The morning report reads those rows
  // to bound a night, so a session that caught fish was recorded as having caught none.
  const hb = src.slice(src.indexOf('function writeHeartbeat()'), src.indexOf('function checkInterrupted'));
  assert.match(hb, /catches: state\.catchCount/, 'the heartbeat records the session catch count');
  const fn = src.slice(src.indexOf('function checkInterrupted()'), src.indexOf('/* -------------------------------------------------------------- DOM'));
  assert.ok(fn.length > 0, 'checkInterrupted exists');
  assert.match(fn, /var catches = typeof live\.catches === 'number' \? live\.catches : 0;/, 'the row takes the recorded count');
  assert.match(fn, /postSessionRow\('reload', minutes, catches, startedAt\)/, 'the row is posted with that count');
  assert.ok(!/postSessionRow\('reload', minutes, 0\)/.test(fn), 'the hard-coded zero is gone');
});

test('a reload row is dated by the heartbeat, not by the moment it is posted', () => {
  // The same live rows: started_at 05:08:07.212Z, logged 05:08:07.856Z - a 110 minute session that
  // began 0.6 s before it was written. started_at came from state.startedAt, which mount has not set
  // when the interrupted row is posted, so || Date.now() faked every one of them.
  const fn = src.slice(src.indexOf('function postSessionRow'), src.indexOf('function captureDiag'));
  assert.match(fn, /function postSessionRow\(reason, minutes, catches, startedAt, note\)/, 'the caller owns the start time');
  assert.match(fn, /new Date\(startedAt \|\| state\.startedAt \|\| Date\.now\(\)\)\.toISOString\(\)/, 'a supplied start wins over the mount-time fallback');
  assert.ok(!/started_at: new Date\(state\.startedAt \|\| Date\.now\(\)\)/.test(fn), 'the faked start is gone from the body');
  const check = src.slice(src.indexOf('function checkInterrupted()'), src.indexOf('/* -------------------------------------------------------------- DOM'));
  assert.match(check, /var startedAt = typeof live\.startedAt === 'number' \? live\.startedAt : null;/, 'the heartbeat start is passed through');
});

test('a reload row is filed on the day it started, which is how the server reads a day', () => {
  // The 110 minute row landed in 2026-11-21's log beside a 5.4 minute local budget, so the day read
  // 115 minutes. It was not a missing day check that did that: fishserve buckets a row on
  // localDay(started_at), and started_at had been faked to "now". An honest start is the whole fix,
  // so the reload path needs no second day check to keep an overnight record out of today's total.
  const serve = fs.readFileSync(path.join(__dirname, '..', 'fishserve.js'), 'utf8');
  assert.match(serve, /localDay\(r\[1\] \|\| r\[0\]\) === day/, 'a row belongs to the day its started_at names');
  const check = src.slice(src.indexOf('function checkInterrupted()'), src.indexOf('/* -------------------------------------------------------------- DOM'));
  assert.match(check, /postSessionRow\('reload', minutes, catches, startedAt\)/, 'the panel sends that start');
  assert.ok(!/dayKey\(/.test(check), 'so the reload path carries no day check of its own');
});

test('the session, cooldown and cap steppers reach overnight ranges', () => {
  // the point of the ranges is "leave it fishing while I sleep", so assert the numbers a
  // sleeper needs are actually reachable through the steppers, not just parseable.
  const conf = src.slice(src.indexOf('function keyConf(key)'), src.indexOf('function clamp('));
  const dur = /field: 'durationMs', min: (\d+) \* 60000, max: (\d+) \* 60000/.exec(conf);
  const cool = /field: 'cooldownMs', min: (\d+) \* 60000, max: (\d+) \* 60000/.exec(conf);
  const cap = /field: 'dailyCapMs', min: (\d+) \* 60000, max: (\d+) \* 60000/.exec(conf);
  assert.ok(dur && cool && cap, 'all three steppers declare explicit minute bounds');
  assert.ok(Number(dur[2]) >= 720, 'a session can run at least 12 hours');
  assert.ok(Number(cap[2]) >= 1440, 'the daily cap can cover a full day');
  assert.ok(Number(cool[1]) <= 1, 'the cooldown floor is one minute');
  assert.ok(Number(cap[2]) >= Number(dur[2]), 'the cap must be able to outlast one session, or it stops the run');
});

test('the panel reads the catch ledger for the rarity strip and the last catch', () => {
  // the strip is fed by __fish.log(), never by the live counters: history has to survive a reload
  assert.ok(src.includes('fish().log'), 'renderLog reads the ledger');
  assert.ok(src.includes('TIER_NAMES.map'), 'every rarity tier gets a cell, empty ones included');
  assert.ok(src.includes('renderLog();'), 'render() refreshes the strip');
  const fn = src.slice(src.indexOf('function renderLog('), src.indexOf('function render()'));
  assert.ok(fn.length > 0, 'renderLog exists');
  // a broken or blocked ledger must not take the panel down with it
  assert.ok(fn.includes('catch (e) { book = null; }'), 'renderLog swallows a ledger read failure');
  assert.ok(fn.includes("ui.lastCatch.textContent = bits.join"), 'the last catch line is text, not markup');
});
test('a running session that cannot bite says so: sit down, the game is seat-based', () => {
  // Fishing in lofi.town only starts from the sit-down path (the CAST! prompt is emitted there), so a
  // standing character can never be rescued by clicking. The panel is the only thing the user looks
  // at, so the condition has to be visible there and not just in the event log.
  const fn = src.slice(src.indexOf('function render()'), src.indexOf('/* ------------------------------------------------------------ layout'));
  assert.ok(fn.length > 0, 'render() exists');
  assert.ok(fn.includes('var seatNote = seatNoteFor(status, phase, focusOn);'), 'render() uses the tested seat-note helper');
  assert.ok(fn.includes("'paused'"), 'the notice also shows while paused, not only while running');
  assert.match(fn, /seatNote \|\| focusModeNote \|\| focusNote \|\| playerNote \|\| blindNote \|\| castNote \|\| pauseNote \|\| banner/, 'the seat notice outranks the blind notice and the log-offline banner');
  assert.ok(fn.includes("'banner seat'"), 'the seat notice gets its own colour, not the amber warning style');
  assert.ok(fn.includes("host.dataset.needsSeat = '1'"), 'needsSeat is observable from outside the shadow root');
  assert.match(src, /\.banner\.seat\{/, 'the seat style exists');
});

test('the seat notice is suppressed only while focus is on', () => {
  // The warning belongs to a standing character, not to a focus hold: while focus owns the run,
  // the panel must not tell the player to sit down, but turning focus off must bring the warning
  // back if the seat is still missing.
  const start = src.indexOf('function seatNoteFor(');
  const end = src.indexOf('function render()');
  assert.ok(start > 0 && end > start, 'seatNoteFor is present and testable');
  const sandbox = {};
  vm.runInNewContext(src.slice(start, end), sandbox);
  const seatNoteFor = sandbox.seatNoteFor;
  assert.equal(typeof seatNoteFor, 'function', 'the helper is loaded from panel.js');
  const seated = { needsSeat: true };
  assert.match(seatNoteFor(seated, 'running', false), /sit on a chair by the water/, 'a running seat pause warns');
  assert.match(seatNoteFor(seated, 'paused', false), /sit on a chair by the water/, 'a paused seat pause warns');
  assert.equal(seatNoteFor(seated, 'running', true), '', 'focus suppresses the running seat warning');
  assert.equal(seatNoteFor(seated, 'paused', true), '', 'focus suppresses the paused seat warning');
  assert.match(seatNoteFor(seated, 'running', false), /sit on a chair by the water/, 'turning focus off brings the warning back');
  assert.equal(seatNoteFor(seated, 'idle', false), '', 'there is no seat warning outside a live session');
  assert.equal(seatNoteFor({ needsSeat: false }, 'running', false), '', 'a non-seat status produces no warning');
  assert.equal(seatNoteFor(null, 'running', false), '', 'a missing status produces no warning');
});

test('the seat fact reaches the reducer so the clock pauses instead of burning', () => {
  // session.js pauses on fact.seat and resumes when it goes false; the panel is the only caller of
  // that reducer, so it must pass the flag on every tick or the pause can never happen.
  assert.ok(src.includes('seat: !!(status && status.needsSeat)'), 'the live tick passes needsSeat as seat');
  assert.ok(src.includes('catches: 0, errors: 0, todayMs: baseTodayMs, seat: false'), 'the cooldown tick passes seat: false');
  assert.ok(src.includes('clock paused'), 'the notice says the clock is paused, not that the run stopped');
  const sessionSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'session.js'), 'utf8');
  assert.ok(sessionSrc.includes("actions.push({ type: 'holdCasts', on: true });"), 'a seat pause keeps the core alive to spot the prompt, but holds its casts');
  assert.ok(sessionSrc.includes("if (!(s.seatOverrideUntil != null && at < s.seatOverrideUntil)) return paused(s, at, 'seat')"), 'the runner pauses on the seat fact unless a user Resume bought a grace window');
  assert.match(src, /holdCasts: function \(a\) \{ try \{ fish\(\)\.holdCasts\(!!a\.on\); \} catch \(e\) \{\} \}/, 'the panel executes the hold action');
});

test('a focus session is announced, because a free account cannot fish in one', () => {
  // The session clock is in the page title, and 25 minutes in a session with the modal hidden gave
  // 0 dials from both the bot and six hand inputs. The panel cannot lift that gate, so the least it
  // can do is say it before the budget is spent.
  assert.ok(src.includes("function inFocusSession()"), 'the title check exists');
  assert.match(src, /\/\\bFOCUS\\b\/\.test\(document\.title\)/, 'it matches FOCUS in the page title, the only session signal');
  assert.match(src, /var FOCUS_NOTE = 'focus session active/, 'the notice names the state');
  assert.ok(src.includes('needs Cozier'), 'and says why fishing will not happen');
  const fn = src.slice(src.indexOf('function render()'), src.indexOf('/* ------------------------------------------------------------ layout'));
  assert.match(fn, /seatNote \|\| focusModeNote \|\| focusNote \|\| playerNote \|\| blindNote \|\| castNote \|\| pauseNote \|\| banner/, 'the focus notice outranks the blind notice and the log-offline banner');
  assert.ok(fn.includes("'banner focus'"), 'it gets its own colour, not the amber seat warning');
  assert.ok(fn.includes("host.dataset.focus = '1'"), 'the state is observable from outside the shadow root');
  assert.match(src, /\.banner\.focus\{/, 'the focus style exists');
  assert.ok(src.includes('window.__panel.focus = inFocusSession'), 'the check is callable from the console');
  // a reporter, never a gate: a Cozier subscriber can fish in a session, so Start stays free
  const start = src.slice(src.indexOf("primary.addEventListener('click'"), src.indexOf("winToggle.addEventListener('click'"));
  const buttons = fn.slice(fn.indexOf('var primary = ui.primary;'), fn.indexOf('// The single most confusing stop'));
  assert.ok(buttons.length > 0 && !buttons.includes('inFocusSession'), 'the notice is not wired into the button states');
  assert.ok(!start.includes('inFocusSession'), 'Start is not blocked in a focus session');
  assert.ok(!/fetch\(/.test(start), 'the start path makes no network call');
});

test('focus mode pauses the run, draws nothing over the game, and releases only its own hold', () => {
  assert.match(src, /prefs\.focusMode = !!p\.focusMode/, 'the pref is read');
  assert.match(src, /focusMode: !!focusPref/, 'the setting is saved, never the live hold');
  assert.match(src, /focusPref = !focusOn;/, 'the toggle sets the setting');

  assert.ok(src.includes('focusPref = !!prefs.focusMode;'), 'mount adopts the stored setting');
  // 3.9.44: adopting the setting must not engage the hold. A page-load hold has focusSawSession
  // false and focusTick only auto-releases a session-driven hold, so a page with no focus session
  // stayed paused with the prompt masked (measured live 2026-11-17: title `lofi.town`,
  // running:true, paused:true, one rect armed, zero dial presses).
  assert.ok(!src.includes('if (focusPref) setFocusMode(true);'), 'mount does not turn the setting into a hold');
  const mountFn = src.slice(src.indexOf('focusPref = !!prefs.focusMode;'), src.indexOf('mountAdoption();'));
  assert.ok(mountFn.length > 0 && !/setFocusMode\(/.test(mountFn), 'nothing in mount engages the hold; focusTick does when a session exists');
  const fn = src.slice(src.indexOf('function setFocusMode'), src.indexOf('function focusTick'));
  assert.match(fn, /type: 'pause', at: Date\.now\(\), reason: 'focus'/, 'engaging pauses with the focus reason');
  assert.match(fn, /if \(state\.pauseReason === 'focus'\) dispatch\(\{ type: 'resume'/, 'releasing resumes only its own hold');
  assert.ok(!/cover|clipPath|promptRect|promptCanvas/i.test(fn), 'engaging touches no canvas and paints nothing');
  assert.ok(!/focusPref\s*=/.test(fn), 'releasing a hold never clears the setting');
  const auto = src.slice(src.indexOf('function focusTick'), src.indexOf('/* ------------------------------------------------------------ server'));
  assert.match(auto, /if \(focusOn && focusSawSession && !session\) setFocusMode\(false\)/, 'only a session-driven hold is auto-released');
  assert.ok(src.includes("host.dataset.focusMode = '1'"), 'the state is observable outside the shadow root');
  assert.ok(!src.includes("el('div', 'cover')"), 'no cover node is built');
  assert.ok(!src.includes('applyPromptHole') && !src.includes('clipPath'), 'the game canvas is never clipped');
  assert.ok(!src.includes('backdrop-filter:blur(7px)'), 'no blur patch is styled');
  assert.ok(src.includes('var focusModeNote = focusOn ?'), 'the banner says the hold is deliberate');
  assert.match(src, /profileOpen: !!\(status && status\.profileOpen\),[\s\S]{0,240}?focus: focusOn\r?\n/, 'every tick reports the hold, so Start cannot fish through it');
  assert.match(src, /var focusModeNote = focusOn \? 'paused for this focus session/, 'the banner says the hold pauses, and promises no hiding');
  assert.ok(src.includes("'Pause in focus sessions'"), 'the toggle is named for what it does now');
  assert.ok(!src.includes("'Focus mode'"), 'the old name is gone from the UI');
  assert.match(auto, /else if \(!focusOn && session && focusPref\) setFocusMode\(true, \{ session: true \}\)/, 'a session starting engages the hold when the setting is on');
});

test('the Cozier popup hider is opt-in, cosmetic, and tags only what it recognises', () => {
  // The in-session upsell cannot be dismissed; hiding it is the only lever a free account has. It
  // must stay off by default, and it must never blank an overlay it cannot identify: the game
  // reuses overlay roots for other modals.
  assert.match(src, /prefs\.hideUpsell = !!p\.hideUpsell/, 'the pref is read');
  assert.match(src, /hideUpsell: !!window\.__panel\.hideUpsell/, 'the pref is saved');
  assert.ok(src.includes("if (prefs.hideUpsell) setUpsellHidden(true)"), 'mount honours the pref');
  const fn = src.slice(src.indexOf('function upsellRoot()'), src.indexOf('function renderUpsellToggle()'));
  assert.ok(fn.includes("getElementById(UPSELL_ID)"), 'it looks for the upsell by its own description id');
  assert.ok(fn.includes('getClientRects().length'), 'a mounted-but-hidden modal is not a reason to tag the overlay');
  assert.ok(fn.includes("closest('[' + UPSELL_ATTR + ']')"), 'a root we are already hiding still counts as visible, or the sweep flickers');
  assert.ok(fn.includes("indexOf('inset-0')"), 'it climbs to the scrim-carrying fixed overlay, not the card');
  const sweep = src.slice(src.indexOf('function sweepUpsell()'), src.indexOf('function renderUpsellToggle()'));
  assert.ok(sweep.includes('marked[i] !== target'), 'the tag is moved, never left behind on a reused root');
  assert.ok(sweep.includes("removeAttribute(UPSELL_ATTR)"), 'the tag is dropped when the upsell goes away');
  assert.ok(src.includes("'[' + UPSELL_ATTR + ']{display:none!important}'"), 'the style is a display:none on the tagged root');
  assert.ok(src.includes("upsellToggle.textContent = upsellOn ? 'on' : 'off'"), 'the toggle shows state');
  // cosmetic means cosmetic: nothing here may touch the game or the account
  assert.ok(!/fetch\(|localStorage\.removeItem/.test(fn + sweep), 'the hider makes no network calls and deletes no state');
});

test('a catch outside the catalogue is visible: an UNK cell and an honest last line', () => {
  // The Zen account showed "Tubenose Poacher · 0.49kg" with a strip of zeros. The catch was in the
  // ledger, but Unknown had no cell, so the panel looked like it was recording nothing at all.
  assert.ok(src.includes("tierCells.push({ name: 'Unknown'"), 'the strip has an Unknown cell');
  assert.ok(src.includes("cell.cell.style.display = n ? '' : 'none'"), 'it only takes space when it has fish');
  assert.ok(src.includes("bits.push('rarity unknown')"), 'the last-catch line says why there is no tier');
  assert.ok(src.includes('not in the built-in catalogue'), 'the tooltip explains the catalogue miss');
});

test('the UNK tooltip reads the worklist, including the no-gap case', () => {
  assert.ok(src.includes('unknownCell: unknownCell'), 'the UNK cell is registered for the render pass');
  assert.ok(src.includes('unknownTitle(book && book.worklist)'), 'the tooltip reads log()\'s worklist');
  const fn = src.slice(src.indexOf('function unknownTitle('), src.indexOf('function renderLog('));
  assert.ok(fn.length > 0, 'unknownTitle exists');
  assert.ok(fn.includes("'1 open gap · '"), 'a single open name is called one gap');
  assert.ok(fn.includes("'no open gaps - all '"), 'a fully explained map says there is no gap');
  assert.ok(fn.includes('historical names are resolved, fragments or non-fish'),
    'the rest of the map is explained rather than counted as gaps');
});

test('the frame report is on the panel, because a browser may take no console at all', () => {
  // The Zen tab takes no synthetic keystrokes, so __fish.perf() cannot be read there. The numbers
  // still have to be reachable: on the panel, and from a screenshot.
  assert.ok(src.includes('perfLine: perfLine'), 'the line is registered for render');
  assert.ok(src.includes('perfBox.append(perfLine, accLine, accMore, perfMore, perfRate, perfJson)'), 'the block is built in the card');
  const fn = src.slice(src.indexOf('function renderPerf('), src.indexOf('function render()'));
  assert.ok(fn.length > 0, 'renderPerf exists');
  assert.ok(fn.includes('fish().perf()'), 'the numbers are perf()\'s, not re-derived counters');
  assert.ok(fn.includes('p.p50') && fn.includes('p.p95') && fn.includes('p.worst'), 'the frame percentiles are shown');
  assert.ok(fn.includes("'per second: scan '"), 'each detector prints its share of wall time');
  assert.ok(fn.includes('Math.round(r[key].msPerSec)'), 'shares are whole ms, so the line cannot grow past the card');
  assert.ok(fn.includes('ui.perfRate.textContent') && fn.includes("'dial '"), 'the dial and catch shares take their own line');
  assert.ok(fn.includes("share('lockDial')"), 'the dial search is one of them');
  assert.ok(fn.includes('catch (e) { p = null; }'), 'a missing perf() must not take the panel down');
  assert.ok(fn.includes('byWidth'), 'the rare-dial width report is on the panel');
  assert.ok(fn.includes("'Caught '"), 'the attempt accuracy line is shown');
  assert.ok(fn.includes("' presses landed'"), 'the acc line carries the accepted-press wedge rate');
  assert.ok(src.includes('renderPerf();'), 'render() refreshes it on the tick');
  const toggle = src.slice(src.indexOf("perfBox.addEventListener('click'"), src.indexOf('function zoneRect('));
  assert.ok(toggle.length > 0, 'the block is clickable');
  assert.ok(toggle.includes('JSON.stringify(rep'), 'the click prints the whole report');
  assert.ok(toggle.includes('calibration:'), 'the calibration surface is part of the report');
  assert.ok(toggle.indexOf('place()') > 0, 'the card is re-measured after it grows');
});

test('the budget is local: today and the cooldown survive a reload', () => {
  assert.ok(src.includes("var BUDGET_KEY = 'autofish:budget:v1'"), 'the budget key exists');
  assert.ok(src.includes('function syncBudget()'), 'the budget is written');
  assert.match(src, /budgetAt > 10000/, 'it is flushed every ten seconds, so a crash costs at most that');
  assert.ok(src.includes('baseTodayMs = Math.max(local, server)'), 'the server is a mirror, not the authority');
  assert.ok(src.includes('} catch (e) { baseTodayMs = local; }'), 'an offline fetch keeps the local budget');
  assert.ok(src.includes('state.todayMs = baseTodayMs'), 'mount restores the day before the first tick');
  assert.ok(src.includes("phase: (!flow && budget.cooldownUntil) ? 'cooldown' : 'idle'"), 'a live cooldown is restored in timed mode');
  assert.ok(src.includes('function todaySessionMs()'), 'the live session is split from the day it carried');
  assert.match(src, /fishingMs \|\| 0\) - \(state\.carriedMs \|\| 0\)/, 'only today\'s share is stored and shown');
});

test('the panel separates all-time totals from today and lets a profile be cleared', () => {
  // "how many today, but also total" needs both numbers on screen, and a reset control so the
  // history is not an invisible, undeletable blob in localStorage.
  assert.ok(src.includes('book.today'), 'the ledger summary has a today bucket');
  assert.ok(src.includes("logToggle.textContent = logScope === 'today' ? 'today' : 'all'"), 'the strip can switch scope');
  assert.ok(src.includes("ui.logTotal.textContent = 'all '"), 'all-time and today totals are shown together');
  assert.ok(src.includes("today.shiny"), 'today\'s shinies are surfaced');
  assert.ok(src.includes('profileReset: profReset'), 'the reset control is wired');
  assert.ok(src.includes('f.logReset()'), 'reset clears the current profile ledger');
  assert.ok(src.includes('function budgetKey'), 'the daily budget is keyed by profile');
  assert.ok(src.includes("p === 'default' ? BUDGET_KEY : BUDGET_PREFIX + p"), 'default keeps the pre-profile budget key');
  assert.ok(src.includes('k.indexOf(BUDGET_PREFIX) === 0'), 'a profile with only a budget stays selectable');
  assert.ok(src.includes('profile: profileName()'), 'every profile logs its own session row');
  assert.ok(src.includes("&profile=' + encodeURIComponent(profileName())"), 'the server total is read for this profile only');
  assert.ok(!src.includes("if (profileName() !== 'default') return;"), 'no profile is excluded from the session log');
});

test('the panel has a real pause, a separate stop, and typed time fields', () => {
  // The single Stop button made every interruption cost a cooldown. Pause holds; Stop rests.
  assert.ok(src.includes("var secondary = el('button', 'secondary hide', 'Stop')"), 'Stop is a separate control');
  const primary = src.slice(src.indexOf("primary.addEventListener('click'"), src.indexOf("winToggle.addEventListener('click'"));
  assert.ok(primary.includes("type: 'pause'"), 'the primary control pauses while running');
  assert.ok(primary.includes("type: 'resume'"), 'and resumes while paused');
  assert.ok(primary.includes("type: 'skip-cooldown'"), 'the self-imposed cooldown has an escape hatch');
  assert.ok(src.includes('function bindTyped'), 'the minute fields accept typed values');
  assert.ok(src.includes('function parseMinutes'), 'typing accepts 90 and 1h 30');
  assert.ok(src.includes("el('input', 'val')"), 'the value is an input, not a read-only div');
  assert.ok(src.includes('function parseClockInput'), 'the clock fields accept HH:MM');
  assert.ok(!src.includes("input.addEventListener('blur', commit)"), 'an invalid entry keeps its marker instead of being re-parsed on blur');
});

test('reload resume and catch POSTs are opt-in, and resume no longer needs a clock window', () => {
  const live = src.slice(src.indexOf('function checkInterrupted'), src.indexOf('/* -------------------------------------------------------------- DOM'));
  assert.ok(live.length > 0, 'checkInterrupted exists');
  assert.ok(!live.includes('state.window.on &&'), 'resume must work without a clock window');
  assert.ok(live.includes("live.phase === 'paused'"), 'a user hold is not turned into a running session by a reload');
  assert.ok(live.includes("state.phase === 'cooldown'"), 'a live cooldown is respected');
  assert.ok(live.includes('state.todayMs >= state.dailyCapMs'), 'a spent cap is respected');
  assert.ok(src.includes('var capOn = p.localCapture !== undefined ? !!p.localCapture : !!(p.postCatches || p.overnight);'), 'legacy catch POST / overnight prefs migrate to localCapture');
  assert.ok(src.includes('localCapture: capOn'), 'localCapture pref is saved');
  const start = src.slice(src.indexOf('startCore: function'), src.indexOf('stopCore:'));
  assert.match(start, /var server = BASE \|\| captureServer\(\);/, 'the catch URL uses the same capture address as the rows');
  assert.ok(start.includes("var post = (window.__panel && (window.__panel.localCapture || window.__panel.postCatches) && server) ? server + '/catch' : null"), 'the URL is only passed when opted in');
  assert.ok(start.includes('logUrl: post'), 'startCore carries the opt-in URL');
});

test('a userscript catch POST uses the capture address fallback, not BASE', () => {
  const block = src.slice(src.indexOf('startCore: function'), src.indexOf('stopCore:'));
  const fn = block.slice(block.indexOf('function'), block.lastIndexOf('}') + 1);
  assert.ok(fn.indexOf('captureServer') > 0, 'the start path resolves the capture address');

  function startWith(BASE, server, localCapture) {
    let started = null;
    const sandbox = {
      BASE: BASE,
      captureServer: function () { return server; },
      loadBudget: function () { return { ms: 0 }; },
      fish: function () { return { start: function (o) { started = o; } }; },
      window: { __panel: { localCapture: localCapture } }
    };
    vm.runInNewContext('(' + fn + ')({ maxMinutes: 62 });', sandbox);
    return started;
  }

  const fallback = 'http://127.0.0.1:8731';
  let started = startWith(null, fallback, true);
  assert.equal(started.logUrl, fallback + '/catch', 'the userscript uses the address the session rows use');
  assert.equal(started.maxMinutes, 62, 'the start options still carry the backstop');

  started = startWith('http://127.0.0.1:9999', fallback, true);
  assert.equal(started.logUrl, 'http://127.0.0.1:9999/catch', 'a served panel keeps its own origin');

  started = startWith(null, fallback, false);
  assert.equal(started.logUrl, null, 'the toggle still opts out');

  started = startWith(null, '', true);
  assert.equal(started.logUrl, null, 'no address means no POST');
});

test('local capture unifies catch CSV + 5-minute snapshots, survives reload, and shows status', () => {
  assert.ok(src.includes("var captureLabel = el('div', 'label', 'Local capture');"), 'the single unified Local capture row is labelled');
  assert.ok(!src.includes('Send catches to CSV'), 'the duplicate CSV toggle is retired');
  assert.ok(!src.includes("'Overnight capture'"), 'the duplicate Overnight toggle is retired');
  assert.match(src, /localCapture: capOn/, 'the pref is saved');
  assert.match(src, /overnightBase: captureBase \|\| ''/, 'the fishserve address is kept with it');
  assert.ok(src.includes('if (overnightPref) armOvernight();'), 'mount arms the sampler from the stored setting');
  assert.ok(src.includes('captureBase = BASE || prefs.overnightBase'), 'a served panel knows the address; an inlined one remembers it');
  assert.ok(src.includes('function syncCaptureUrl()'), 'syncCaptureUrl updates both CSV streaming and live core logUrl');

  const arm = src.slice(src.indexOf('async function armOvernight'), src.indexOf('function disarmOvernight'));
  assert.ok(arm.length > 0, 'armOvernight exists');
  assert.ok(arm.includes("/overnight.js?t="), 'the sampler is fetched from fishserve, not pasted');
  assert.ok(arm.includes('window.__overnightBase'), 'the POST origin follows the server that served the sampler');
  assert.ok(arm.includes('if (live && !live.stopped)'), 'a sampler already running is not stacked');
  assert.ok(arm.includes('if (!captureStatus())'), 'a sampler that never installed itself is reported, not assumed');
  assert.ok(arm.includes('renderCapture()'), 'every arm step repaints the status');

  assert.ok(src.includes('captureLine: captureLine'), 'the status line is registered');
  assert.ok(src.includes("'capture armed · '"), 'the line says armed in words');
  assert.ok(src.includes('· stale (fishserve gone?),') || src.includes("st.lastError"), 'a dead or failing capture is not green');
  assert.ok(src.includes('renderCapture();'), 'render refreshes it on the tick');
  assert.ok(src.includes('host.dataset.capture'), 'the armed state is observable outside the shadow root');

  const toggle = src.slice(src.indexOf("captureRow.addEventListener('click'"), src.indexOf("profSel.addEventListener('change'"));
  assert.ok(toggle.length > 0, 'the whole row is the control');
  assert.ok(!src.includes("captureToggle.addEventListener('click'"), 'the 14 px button is not a second, stacked listener');
  assert.ok(toggle.includes('askCaptureAddress()'), 'the server-free install is asked for the address once');
  assert.ok(!/localStorage/.test(toggle), 'the address goes through the prefs, not a second store');
  assert.ok(toggle.includes('if (!captureServer()) next = !!askCaptureAddress();'), 'one click asks for the address, even when the switch already says on');
  assert.ok(toggle.includes('if (next) armOvernight(); else disarmOvernight();'), 'answering arms; cancelling leaves the capture off');
});

test('a stale capture address can be corrected from the amber line', () => {
  // A stored address that moves used to have no way back: the toggle only asked when there was no
  // address at all, so the pref sat on a dead origin forever and heal retried the same one.
  const ask = src.slice(src.indexOf('function askCaptureAddress'), src.indexOf('function editCaptureAddress'));
  assert.ok(ask.length > 0 && ask.includes('window.prompt('), 'the address is asked for in one place');
  assert.ok(ask.includes('node fishserve.js') && ask.includes('Click Cancel'), 'first-time capture prompt explains fishserve is optional');
  assert.ok(ask.includes('captureBase = base'), 'the answer is kept with the pref');
  assert.ok(ask.includes('capture needs an address like'), 'a malformed answer says why');

  const edit = src.slice(src.indexOf('function editCaptureAddress'), src.indexOf('function healCapture'));
  assert.ok(edit.length > 0, 'editCaptureAddress exists');
  assert.ok(edit.includes('if (BASE) return;'), 'a served panel has only the origin that served it');
  assert.ok(edit.includes('window.__overnight.stop()'), 'the old sampler is stopped before the new one loads');
  assert.ok(edit.includes('savePrefs()'), 'the corrected address survives a reload');
  assert.ok(edit.includes('armOvernight()'), 'it arms from the new origin instead of keeping the dead one');

  assert.ok(src.includes("captureLine.addEventListener('click'"), 'the amber line is clickable');
  assert.ok(src.includes("captureLine.addEventListener('keydown'"), 'and reachable from the keyboard');
  assert.match(src, /captureEditReady = !!\(overnightPref && !BASE && tone === 'warn'\)/, 'only a broken capture offers the edit');
  assert.ok(src.includes('click to change the fishserve address'), 'the line explains what the click does');
});

test('a capture that died or cannot post heals itself, without a click', () => {
  // 3.9.45 armed the sampler at mount, but nothing re-armed it later: a sampler that stopped, or a
  // fishserve that was down when the page loaded, left the pref on with nothing posting until the
  // toggle was clicked. The pref is the source of truth, so the heartbeat retries it on a backoff.
  assert.ok(src.includes('var CAPTURE_BACKOFF = ['), 'retries back off instead of hammering');
  assert.equal((src.match(/11 \* 60 \* 1000/g) || []).length, 1, 'the staleness threshold is one constant');

  const heal = src.slice(src.indexOf('function healCapture'), src.indexOf('function renderCapture'));
  assert.ok(heal.length > 0, 'healCapture exists');
  assert.ok(heal.includes('if (!overnightPref || captureArming) return;'), 'it only runs with the pref on, and never over a load in flight');
  assert.ok(heal.includes('if (!captureServer())'), 'a missing address is left to the toggle');
  assert.ok(heal.includes('st.lastError'), 'a failed post is retried');
  assert.ok(heal.includes('st.stopped'), 'a sampler that died is loaded again');
  assert.ok(heal.includes('captureStale(st)'), 'and so is one that went quiet');
  assert.ok(heal.includes('__overnight.now()'), 'a live sampler is nudged, not stacked');
  assert.ok(heal.includes('armOvernight()'), 'a dead sampler is re-armed');
  assert.ok(heal.includes('if (now < captureRetryAt) return;'), 'the retry waits for the backoff');
  assert.ok(heal.includes('if (!why) { captureClearBackoff(); return; }'), 'a healthy capture clears the backoff');

  assert.ok(src.includes('retrying on a backoff'), 'a pending retry is explained on the line');
  const render = src.slice(src.indexOf('function renderCapture'), src.indexOf('/* ------------------------------------------------------------ server ----'));
  assert.ok(!render.includes('healCapture();'), 'rendering stays display-only: no sampler loads or POSTs from a repaint');
  assert.ok(render.includes('captureStale(st)'), 'the line and the heal share the staleness rule');
  assert.ok(render.includes('the sampler is not running · re-arming'), 'a dead sampler says so instead of asking for a click');
  const tick = src.slice(src.indexOf('function tick()'), src.indexOf('/* ------------------------------------------------------------- mount ----'));
  assert.ok(tick.includes('healCapture();'), 'the heartbeat drives the heal, in every phase');
});

test('a stop says what stopped it, and the hidden threshold is configurable', () => {
  assert.ok(src.includes("stopNote = 'last stop: ' + state.stopReason"), 'the reason is shown');
  assert.ok(src.includes("start after '"), 'and when the cooldown ends');
  assert.ok(src.includes("stepperRow('Stop when hidden', 'hidden')"), 'the hidden stop has a stepper');
  assert.match(src, /field: 'hiddenStopMs'/, 'the stepper writes the reducer field');
  assert.ok(src.includes('chainToggle: chainToggle'), 'the chain toggle is wired');
  assert.ok(src.includes('Auto-start next run'), 'and labelled');
});

test('fast first press is retired from the panel UI, Cozier popup stays, and Flow mode hides timed controls', () => {
  assert.ok(!src.includes('Fast first press'), 'the obsolete UI toggle is retired');
  assert.ok(!src.includes('fastnote{'), 'the permanent amber warning is retired');
  assert.ok(src.includes("'Cozier popup'"), 'Cozier popup control is kept');
  assert.ok(src.includes("el('div', 'label', 'Mode')"), 'Mode switch is present');
  assert.ok(src.includes('timedWrap.style.display = flow ? \'none\' : \'\''), 'Flow mode hides timed/budget rows');
  assert.ok(src.includes("if (key === 'hidden') return { field: 'hiddenStopMs', min: 0"), 'Stop when hidden can step down to off');
  assert.ok(src.includes("minutesText(state.fishingMs) + ' flow'"), 'Flow mode counts elapsed time up on the surface meter');
});

test('the panel says why and when a run paused', () => {
  // The phase chip said "paused" and nothing else; the reason and the clock time lived only in
  // __panel.state, which is what this note removes.
  const block = src.slice(src.indexOf('var PAUSE_WHY'), src.indexOf('function render()'));
  assert.ok(block.includes('function pauseNoteFor('), 'a dedicated pause note exists before render');
  const sandbox = {};
  vm.runInNewContext(block + '\nthis.pauseNoteFor = pauseNoteFor;', sandbox);
  const T = 1_800_000_000_000;
  const held = sandbox.pauseNoteFor({ phase: 'paused', pauseReason: 'user', pausedAt: T - 5 * 3600_000 }, T);
  assert.match(held, /^paused /, 'it opens with the paused state');
  assert.match(held, /5h ago/, 'it says how long ago the pause happened');
  assert.match(held, /you paused it/, 'it says why, in plain words');
  assert.match(held, /press Resume/, 'and what to do about it');
  const quiet = sandbox.pauseNoteFor({ phase: 'paused', pauseReason: 'no-catch', pausedAt: T - 60_000, retryAt: T + 30_000 }, T);
  assert.match(quiet, /nothing bit for 10 minutes/, 'a guard pause is named, not left as "paused"');
  assert.match(quiet, /retrying /, 'an automatic retry is shown with its time');
  assert.ok(!quiet.includes('press Resume'), 'the automatic case does not ask for a click');
  assert.equal(sandbox.pauseNoteFor({ phase: 'running', pauseReason: null }, T), '', 'nothing is said while running');
  assert.equal(sandbox.pauseNoteFor({ phase: 'paused', pauseReason: null }, T), '', 'a pause with no reason says nothing');
  assert.ok(src.includes('|| pauseNote || banner'), 'the note reaches the banner chain');
  assert.ok(src.includes("host.dataset.pauseReason = state.pauseReason"), 'the reason is observable outside the closed root');
});

test('panel includes rare chime, IndexedDB trophy viewer, update badge, CSV export, dashboard link, and bounded auto-reload', () => {
  assert.ok(src.includes("'Rare catch chime'"), 'rare catch chime toggle exists in Settings');
  assert.ok(src.includes('function playRareChime('), 'Web Audio rare chime generator exists');
  assert.ok(src.includes("var TROPHY_DB = 'autofish:trophies:v1'"), 'trophy cards use IndexedDB, never localStorage');
  assert.ok(src.includes('function openTrophyPop(') && src.includes('trophy-pop'), 'clickable trophy popover exists');
  assert.ok(src.includes('function checkForUpdate(') && src.includes('UPDATE_CHECK_URL'), 'cached GitHub update check exists');
  assert.ok(src.includes('function downloadLedgerCsv(') && src.includes("'↓ CSV'"), 'one-click ledger CSV export exists');
  assert.ok(src.includes("captureServer() + '/dashboard'"), 'healthy green capture line opens local dashboard');
  assert.ok(src.includes('function maybeAutoReloadResultMissing(') && src.includes('reloadGate'), 'result-missing auto-reload uses bounded reloadGate');
  assert.ok(src.includes('autoReload: true') && src.includes('!live.autoReload'), 'bounded auto-reload resumes cleanly while user pauses stay paused');
});

test('panel UI polish: semantic pill, global focus-visible, Escape dialog, Trophies button, chunked settings, and 2-step clear', () => {
  assert.ok(src.includes("var pill = el('button', 'pill hide', '🎣')"), 'collapsed pill is a focusable <button>');
  assert.ok(src.includes('button:focus-visible,.pill:focus-visible,[role="button"]:focus-visible'), 'global green :focus-visible outline exists');
  assert.ok(src.includes("e.key === 'Escape' && trophyPopOpen") && src.includes("'role', 'dialog'"), 'trophy viewer supports dialog semantics and Escape close');
  assert.ok(src.includes("'Trophies'") && src.includes('Trophies ('), 'explicit Trophies button sits beside CSV and scope toggles');
  assert.ok(src.includes("chainToggle.style.color = state.chain ? '#5ad18b'"), 'chainToggle renders green active color when on');
  assert.ok(src.includes("daysKept === 1 ? ' day kept' : ' days kept'"), 'singular day pluralization fixed');
  assert.ok(src.includes("'confirm?'") && src.includes("clearConfirmUntil"), 'destructive trophy clear requires 2-step confirmation');
  assert.ok(src.includes('.banner.success{') && src.includes("showTempBanner('downloaded '"), 'CSV download uses auto-clearing success banner');
});
