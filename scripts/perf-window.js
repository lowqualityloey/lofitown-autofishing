// @ts-check
/**
 * Attribute frame time on a running AutoFish build, including builds older than __fish.perf().
 *
 * Paste this whole file into the browser console on app.lofi.town while the bot is running and
 * leave the tab in the foreground. It wraps the four detectors for 20 s, prints the same table
 * __fish.perf() prints, and puts the originals back before it resolves - safe to run repeatedly.
 *
 *   Detector    calls/s   ms/call   ms/s   share
 *   findBubble     93.1      0.18     17   0.02
 *   findCatch      93.1      0.26     24   0.02
 *   lockDial        8.0     38.83    310   0.31
 *   sample         76.9      1.10     85   0.09
 *
 * `share` is the fraction of wall time a detector held the main thread. findBubble includes
 * snapshot(), so rows overlap; read them as attribution, not as a partition. The fps/p50/p95 line
 * is a requestAnimationFrame gap series taken at the same time, so a big ms/call shows up as a
 * spike in p95 rather than being lost in an average.
 *
 * The earlier tabs could not be reloaded mid-session, which is why this mutates the live page
 * instead of asking for a fresh import. Detection is unaffected: a wrapper only adds two
 * performance.now() calls around the original.
 */
(async () => {
  const F = window.__fish;
  if (!F) throw new Error('no __fish on this page - is the userscript running?');
  const map = { findBubble: 'bubble', findCatch: 'card', lockDial: 'lock', sample: 'sample' };
  const orig = {};
  const p = { bubble: 0, bubbleN: 0, card: 0, cardN: 0, lock: 0, lockN: 0, sample: 0, sampleN: 0 };

  for (const name of Object.keys(map)) {
    if (typeof F[name] !== 'function') throw new Error('missing F.' + name + ' - wrong build?');
    orig[name] = F[name];
    const key = map[name];
    F[name] = function () {
      const t0 = performance.now();
      try {
        return orig[name].apply(this, arguments);
      } finally {
        p[key] += performance.now() - t0;
        p[key + 'N']++;
      }
    };
  }

  const startedAt = performance.now();
  const gaps = [];
  let last = performance.now();
  let frames = 0;
  let raf = 0;
  const tick = (t) => {
    if (frames) {
      gaps.push(t - last);
      if (gaps.length > 1200) gaps.shift();
    }
    last = t;
    frames++;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  await new Promise((done) => setTimeout(done, 20000));
  cancelAnimationFrame(raf);
  for (const name of Object.keys(orig)) F[name] = orig[name];

  const secs = (performance.now() - startedAt) / 1000;
  const rate = (ms, n) => ({
    'calls/s': n ? +(n / secs).toFixed(1) : 0,
    'ms/call': n ? +(ms / n).toFixed(2) : null,
    'ms/s': +(ms / secs).toFixed(1),
    share: +(ms / secs / 1000).toFixed(3),
  });
  gaps.sort((a, b) => a - b);
  const at = (x) => +gaps[Math.min(gaps.length - 1, Math.floor(x * gaps.length))].toFixed(1);
  const total = gaps.reduce((s, v) => s + v, 0);

  const table = {
    findBubble: rate(p.bubble, p.bubbleN),
    findCatch: rate(p.card, p.cardN),
    lockDial: rate(p.lock, p.lockN),
    sample: rate(p.sample, p.sampleN),
  };
  console.table(table);
  console.log(
    'frames: ' + gaps.length + ' over ' + secs.toFixed(1) + ' s, fps ' + (1000 / (total / gaps.length)).toFixed(1) +
    ', p50 ' + at(0.5) + ' ms, p95 ' + at(0.95) + ' ms, worst ' + (+gaps[gaps.length - 1]).toFixed(1) + ' ms',
  );
  console.log('dial search share: ' + table.lockDial.share + ' - that is the number to compare before/after');
  return { secs: +secs.toFixed(1), table, p95: at(0.95) };
})().catch((e) => console.error('perf-window:', e));
