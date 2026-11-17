/**
 * Keep an overnight run from being swallowed by the attempt store's 250-row cap.
 *
 * The page persists resolved attempts per profile in localStorage and keeps the last 250, so a
 * night at ~1.3 attempts/minute (600+) would export only its tail - and the question the night is
 * meant to answer (did a cap or a stall cost hours?) lives in the part that rolls off. This posts a
 * snapshot every five minutes, which at that rate is ~7 new rows between posts: far below the cap,
 * so consecutive snapshots always overlap.
 *
 * Paste this whole file into the browser console on app.lofi.town while the bot is fishing. It
 * needs fishserve on 127.0.0.1:8731 (POST /export writes data/runs/export-<time>.json).
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
  const PORT = Number(window.__overnightPort) || 8731;
  const EVERY_MS = 5 * 60 * 1000;
  const url = 'http://127.0.0.1:' + PORT + '/export';

  if (window.__overnight) window.__overnight.stop();
  const state = { stopped: false, posts: 0, last: null, lastError: null };
  let timer = null;

  async function snap(reason) {
    if (state.stopped) return null;
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
      state.lastError = 'POST failed: ' + ((e && e.message) || e) + ' - is fishserve running on ' + PORT + '?';
      console.warn('[overnight] ' + state.lastError);
      return null;
    }
  }

  timer = setInterval(() => { snap('interval'); }, EVERY_MS);
  const first = await snap('start');
  console.log('[overnight] every ' + (EVERY_MS / 60000) + ' min to ' + url +
    '; __overnight.now() forces one, __overnight.stop() ends it' +
    (first ? '' : ' - THE FIRST POST FAILED, fix it before leaving'));
  window.__overnight = {
    now: () => snap('manual'),
    stop: () => { state.stopped = true; clearInterval(timer); console.log('[overnight] stopped (' + state.posts + ' posts)'); },
    status: () => Object.assign({}, state),
  };
})();
