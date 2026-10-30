'use strict';
/**
 * Preloaded with `node -r` by tests/release-guard.test.js, before scripts/release.js destructures
 * child_process.execFileSync.
 *
 * The release script must refuse a non-public mirror before it touches any release. This stub
 * answers just enough of `gh` to reach that refusal, records every gh argv, and throws on every
 * other gh call - so a missing or relocated gate fails loudly instead of reaching the network.
 *
 * The one `git remote get-url origin` answer keeps the test independent of the checkout's
 * remotes; every other git call is the real binary.
 */
const fs = require('fs');
const child = require('child_process');

const LOG = process.env.AUTOFISH_GH_STUB_LOG;
const VISIBILITY = process.env.AUTOFISH_GH_STUB_VISIBILITY || 'private';
const REMOTE = 'git@github.com:lowqualityloey/lofitown-autofishing.git\n';

if (!LOG) throw new Error('AUTOFISH_GH_STUB_LOG is required');

const realExecFileSync = child.execFileSync;

child.execFileSync = function (file, args, options) {
  if (!Array.isArray(args)) return realExecFileSync(file, args, options);
  if (file === 'git') {
    if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') return REMOTE;
    return realExecFileSync(file, args, options);
  }
  if (file !== 'gh') return realExecFileSync(file, args, options);

  fs.appendFileSync(LOG, JSON.stringify(args) + '\n');

  if (args[0] === 'auth' && args[1] === 'status') return '';
  if (args[0] === 'api' && /^repos\//.test(args[1] || '')) return VISIBILITY;

  throw new Error('release-guard stub: unexpected gh call ' + args.join(' '));
};
