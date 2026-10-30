'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release.js');
const STUB = path.join(__dirname, 'fixtures', 'release-guard-stub.js');
const MIRROR = 'lowqualityloey/lofitown-autofishing-dist';
const MIRROR_RE = MIRROR.replace('/', '\\/');

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
