'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release.js');
const { expectPublic, milestoneText, milestoneFor } = require(SCRIPT);
const STUB = path.join(__dirname, 'fixtures', 'release-guard-stub.js');
const MIRROR = 'lowqualityloey/lofitown-autofishing-dist';
const MIRROR_RE = MIRROR.replace('/', '\\/');

test('a tag with no vault trailer is refused, so a release cannot publish unrecorded', () => {
  assert.equal(
    milestoneText('fix: x\n\nHeyLoey-Milestone: 3.9.44 - the mask clears both elements\n'),
    '3.9.44 - the mask clears both elements'
  );
  assert.equal(milestoneText('fix: x\n\nHeyLoey-Milestone:   \n'), '', 'an empty trailer is not an opt-in');
  assert.equal(milestoneText('feat: HeyLoey-Milestone: mid-line\n'), '', 'the trailer must start a line');

  assert.throws(() => milestoneFor('v9.9.9', 'fix: nothing here\n'), /no HeyLoey-Milestone: trailer/);
  assert.throws(() => milestoneFor('v9.9.9', 'fix: nothing here\n'), /heyloey done/, 'it says how to fix it');
  assert.throws(() => milestoneFor('v9.9.9', 'fix: nothing here\n'), /git tag -f v9\.9\.9/, 'and how to attach it to the tag it is blocking');

  assert.deepEqual(
    milestoneFor('v9.9.9', 'fix: x\n\nHeyLoey-Milestone: 9.9.9 - ships\n'),
    { text: '9.9.9 - ships', exempt: false, reason: null }
  );
  const legacy = milestoneFor('v3.9.43', '3.9.43: mask\n');
  assert.equal(legacy.exempt, true, 'the one hand-logged tag stays verifiable');
  assert.match(legacy.reason, /logged by hand/);

  // The gate has to run before the publish path reads GitHub, not after it: a release the tool
  // refuses must not have had its source release read or its mirror touched first.
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const at = src.indexOf('milestoneFor(tag');
  const sourceRead = src.indexOf('releaseInfo(source, tag)');
  assert.ok(at > 0 && sourceRead > 0 && at < sourceRead, 'the trailer gate runs before the source release is read');
  assert.equal((src.match(/milestoneFor\(tag, git\(/g) || []).length, 1, 'exactly one gate, on the tag commit');
});

for (const visibility of ['private', 'internal']) {
  test(visibility + ' mirror: refused before any release command', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autofish-guard-'));
    const log = path.join(dir, 'gh-calls.log');
    try {
      // --check keeps a broken stub from ever publishing. The gate is unconditional and sits
      // before the shared release path, so this still proves no release command ran first.
      const run = spawnSync(process.execPath, ['-r', STUB, SCRIPT, '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          AUTOFISH_GH_STUB_LOG: log,
          AUTOFISH_GH_STUB_VISIBILITY: visibility,
        },
      });

      assert.ifError(run.error);
      assert.equal(run.status, 1, 'expected the gate to exit 1; stderr: ' + run.stderr);
      assert.match(run.stderr, new RegExp('the mirror repository ' + MIRROR_RE + ' is ' + visibility));
      assert.match(run.stderr, new RegExp('gh repo edit ' + MIRROR_RE + ' --visibility public'));

      assert.ok(fs.existsSync(log), 'the stub recorded no gh calls; stderr: ' + run.stderr);
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      assert.deepEqual(
        calls,
        [
          ['auth', 'status'],
          ['api', 'repos/' + MIRROR, '--jq', '.visibility'],
        ],
        'a release command ran before the visibility gate'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// GitHub keys its release-download cache by the full URL. The verifier probes before publishing,
// so without a changing key the 404 it gets for a brand-new tag outlives the upload. This server
// has the same shape: a URL answered 404 is cached, and a different query key misses that cache.
test('a cached 404 from the pre-publish probe cannot hide a new mirror tag', async () => {
  const expected = Buffer.from('// ==UserScript==\n// @version 3.9.8\n');
  const cached = new Set();
  const seen = [];
  let published = false;

  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.setHeader('connection', 'close');
    if (!published || cached.has(req.url)) {
      cached.add(req.url);
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.statusCode = 200;
    res.end(expected);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const url = 'http://127.0.0.1:' + port + '/releases/download/v3.9.8/autofish.user.js';

    const before = await expectPublic(url, expected);
    assert.equal(before.status, 404, 'the pre-publish probe should see no asset');

    published = true;
    const after = await expectPublic(url, expected, 3, 1);
    assert.equal(after.status, 200, 'post-upload probe read the cached 404: ' + seen.join(' '));
    assert.deepEqual(after.bytes, expected);
    assert.equal(seen.length, 2, 'expected one probe before and one after publish');
    assert.notEqual(seen[0], seen[1], 'the verifier reused the URL it had cached as a 404');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
