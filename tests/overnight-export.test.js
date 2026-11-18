'use strict';
/**
 * The sampler is served by a fishserve and must post back to the origin that served it. It used to
 * take only the port and always post to 127.0.0.1, so a fishserve on another host wrote nowhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'overnight-export.js'), 'utf8');

/** Run the real sampler against a fake page and return the URLs it POSTed to. */
async function posts(page) {
  const urls = [];
  const win = Object.assign({
    __fish: { exportRun: () => JSON.stringify({ version: '3.9.47', attempts: [] }) },
  }, page);
  vm.runInNewContext(SRC, {
    window: win,
    fetch: async (url) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ file: 'export-test.json' }) };
    },
    setInterval: () => 0,
    clearInterval: () => {},
    console: { log: () => {}, warn: () => {} },
  }, { filename: 'overnight-export.js' });
  for (let i = 0; i < 40; i++) {
    if (win.__overnight && win.__overnight.status().posts > 0) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  if (win.__overnight) win.__overnight.stop();
  return urls;
}

test('the sampler posts back to the origin the panel loaded it from', async () => {
  const urls = await posts({ __overnightBase: 'http://10.0.0.5:9000' });
  assert.deepEqual(urls, ['http://10.0.0.5:9000/export'], 'the whole origin is kept, not only its port');
});

test('a console paste still falls back to the documented localhost port', async () => {
  assert.deepEqual(await posts({ __overnightPort: 9123 }), ['http://127.0.0.1:9123/export']);
  assert.deepEqual(await posts({}), ['http://127.0.0.1:8731/export']);
});

test('a failed post is reported, with the origin it tried, instead of throwing', async () => {
  // The stale-address line is only reachable if a failed POST sets lastError. A removed PORT
  // variable here used to throw inside the catch, leaving lastError null and the line green.
  const win = {
    __overnightBase: 'http://127.0.0.1:8798',
    __fish: { exportRun: () => JSON.stringify({ attempts: [] }) },
  };
  vm.runInNewContext(SRC, {
    window: win,
    fetch: async () => { throw new Error('fetch failed'); },
    setInterval: () => 0,
    clearInterval: () => {},
    console: { log: () => {}, warn: () => {} },
  }, { filename: 'overnight-export.js' });
  for (let i = 0; i < 40; i++) {
    if (win.__overnight && win.__overnight.status().lastError) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const st = win.__overnight.status();
  assert.equal(st.posts, 0);
  assert.match(st.lastError, /fetch failed/);
  assert.match(st.lastError, /8798/, 'the message names the origin that failed, not a guessed port');
  await win.__overnight.now();
  assert.match(win.__overnight.status().lastError, /8798/);
});
