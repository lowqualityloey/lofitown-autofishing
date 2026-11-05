'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(post, /if \(!BASE\) return;/, 'no fetch without a server');
  assert.match(src, /function syncBudget\(\)/, 'the finished session counts in the local budget');
  assert.match(src, /if \(!BASE\) return;/, 'diagnosis uploads must not run without a server');
});

test('the daily cap survives a reload and a second session in the same page', () => {
  const load = src.slice(src.indexOf('async function loadToday()'), src.indexOf('function postSessionRow'));
  assert.match(load, /if \(!BASE\) return;/, 'the server is optional, the local budget is not');
  const start = src.slice(src.indexOf('startCore: function'), src.indexOf('stopCore:'));
  assert.match(start, /baseTodayMs = loadBudget\(\)\.ms/, 'a new session must re-read the day');
  assert.match(src, /var BUDGET_KEY = 'autofish:budget:v1'/);
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
  assert.ok(fn.includes('status.needsSeat'), 'render() reads needsSeat from the core status');
  assert.ok(fn.includes("'paused'"), 'the notice also shows while paused, not only while running');
  assert.match(fn, /seatNote \|\| focusNote \|\| banner/, 'the seat notice outranks the log-offline banner');
  assert.ok(fn.includes("'banner seat'"), 'the seat notice gets its own colour, not the amber warning style');
  assert.ok(fn.includes("host.dataset.needsSeat = '1'"), 'needsSeat is observable from outside the shadow root');
  assert.match(src, /\.banner\.seat\{/, 'the seat style exists');
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
  assert.match(fn, /seatNote \|\| focusNote \|\| banner/, 'the focus notice outranks the log-offline banner');
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

test('the frame report is on the panel, because a browser may take no console at all', () => {
  // The Zen tab takes no synthetic keystrokes, so __fish.perf() cannot be read there. The numbers
  // still have to be reachable: on the panel, and from a screenshot.
  assert.ok(src.includes('perfLine: perfLine'), 'the line is registered for render');
  assert.ok(src.includes('perfBox.append(perfLine, accLine, accMore, perfMore, perfJson)'), 'the block is built in the card');
  const fn = src.slice(src.indexOf('function renderPerf('), src.indexOf('function render()'));
  assert.ok(fn.length > 0, 'renderPerf exists');
  assert.ok(fn.includes('fish().perf()'), 'the numbers are perf()\'s, not re-derived counters');
  assert.ok(fn.includes('p.p50') && fn.includes('p.p95') && fn.includes('p.worst'), 'the frame percentiles are shown');
  assert.ok(fn.includes("'per second: scan '"), 'each detector prints its share of wall time');
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
  assert.ok(src.includes("phase: budget.cooldownUntil ? 'cooldown' : 'idle'"), 'a live cooldown is restored, not bypassed');
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
  assert.ok(src.includes("profileName() !== 'default'"), 'the global server total does not leak into a second profile');
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
  assert.ok(src.includes('prefs.postCatches = !!p.postCatches'), 'the POST pref is read');
  assert.ok(src.includes('postCatches: !!window.__panel.postCatches'), 'the POST pref is saved');
  assert.ok(src.includes("var post = (window.__panel && window.__panel.postCatches && BASE) ? BASE + '/catch' : null"), 'the URL is only passed when opted in');
  assert.ok(src.includes('logUrl: post'), 'startCore carries the opt-in URL');
});

test('a stop says what stopped it, and the hidden threshold is configurable', () => {
  assert.ok(src.includes("stopNote = 'last stop: ' + state.stopReason"), 'the reason is shown');
  assert.ok(src.includes("start after '"), 'and when the cooldown ends');
  assert.ok(src.includes("stepperRow('Stop when hidden', 'hidden')"), 'the hidden stop has a stepper');
  assert.match(src, /field: 'hiddenStopMs'/, 'the stepper writes the reducer field');
  assert.ok(src.includes('chainToggle: chainToggle'), 'the chain toggle is wired');
  assert.ok(src.includes('Auto-start next run'), 'and labelled');
});
