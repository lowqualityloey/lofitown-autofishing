// @ts-check
/**
 * Keep an overnight run from being swallowed by the attempt store's 250-row cap.
 *
 * The page persists resolved attempts per profile in localStorage and keeps the last 250, so a
 * night at ~1.3 attempts/minute (600+) would export only its tail - and the question the night is
 * meant to answer (did a cap or a stall cost hours?) lives in the part that rolls off. This posts a
 * snapshot every five minutes, which at that rate is ~7 new rows between posts: far below the cap,
 * so consecutive snapshots always overlap.
 *
 * The panel loads this file on mount when the "Overnight capture" pref is on, and the server hands
 * it out at /overnight.js, so a page reload re-arms it. It can still be pasted into the console on
 * app.lofi.town. It needs fishserve (POST /export writes data/runs/export-<time>.json); the panel
 * sets window.__overnightBase to the origin that served the file, so the POST goes back to that
 * same host and port. A console paste has no panel and falls back to http://127.0.0.1:8731.
 *
 *   __overnight.now()      force a snapshot now (do this once, to prove the path before leaving)
 *   __overnight.status()   posts so far and the last one
 *   __overnight.stop()     stop the timer (the run itself is untouched)
 *
 * Everything is additive: exportRun() reads, it does not reset the store, so the page keeps
 * fishing exactly as it was.
 */
(async () => {
  const F = window.__fish;
  if (!F || typeof F.exportRun !== 'function') throw new Error('no __fish.exportRun on this page - is the userscript running?');
  const ORIGIN = String(window.__overnightBase || '').replace(/\/+$/, '') ||
    ('http://127.0.0.1:' + (Number(window.__overnightPort) || 8731));
  const EVERY_MS = 5 * 60 * 1000;
  const url = ORIGIN + '/export';

  if (window.__overnight) window.__overnight.stop();
  /** @type {OvernightStatus} */
  const state = { stopped: false, posts: 0, last: null, lastError: null };
  /** @type {number | undefined} */
  let timer;

  async function snap(reason) {
    if (state.stopped || !F) return null;
    let body;
    try {
      body = F.exportRun();
    } catch (e) {
      state.lastError = 'exportRun failed: ' + ((e && e.message) || e);
      console.warn('[overnight] ' + state.lastError);
      return null;
    }
    let attempts = 0;
    try { attempts = (JSON.parse(body).attempts || []).length; } catch (e) {}
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.e || ('HTTP ' + res.status));
      state.posts++;
      state.last = { at: new Date().toISOString(), reason, attempts, file: out.file };
      state.lastError = null;
      console.log('[overnight] ' + attempts + ' attempts (' + reason + ') -> ' + out.file);
      return state.last;
    } catch (e) {
      state.lastError = 'POST failed: ' + ((e && e.message) || e) + ' - is fishserve running on ' + ORIGIN + '?';
      console.warn('[overnight] ' + state.lastError);
      return null;
    }
  }

  timer = setInterval(() => { snap('interval'); }, EVERY_MS);
  // Installed before the first POST, not after: the panel loads this file on mount and reads
  // __overnight.status() right away to show whether capture is armed.
  window.__overnight = {
    now: () => snap('manual'),
    stop: () => { state.stopped = true; clearInterval(timer); console.log('[overnight] stopped (' + state.posts + ' posts)'); },
    status: () => Object.assign({}, state),
  };
  const first = await snap('start');
  console.log('[overnight] every ' + (EVERY_MS / 60000) + ' min to ' + url +
    '; __overnight.now() forces one, __overnight.stop() ends it' +
    (first ? '' : ' - THE FIRST POST FAILED, fix it before leaving'));
})();
