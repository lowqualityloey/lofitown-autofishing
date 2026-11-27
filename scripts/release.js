#!/usr/bin/env node
// @ts-check
/**
 * Publish the built userscript to the public distribution mirror, and prove the source and
 * mirror releases cannot drift.
 *
 * The mirror exists because this repository is private: Tampermonkey's update check carries no
 * GitHub session, so an asset on a private release answers its request with 404. The mirror holds
 * only the built file. That makes it a second copy of one artifact - and a second copy is exactly
 * how a release drifts, with the source release carrying this week's build and the mirror last
 * week's.
 *
 * So this script never builds bytes of its own:
 *   - it refuses to publish unless the mirror repository is public, because an anonymous
 *     update check gets 404 from a private one - before any write, not after;
 *   - it takes dist/autofish.user.js as committed at the release tag;
 *   - it requires the source release's asset to be byte-identical to that file;
 *   - it uploads those verified bytes to the mirror, then downloads the mirror asset again
 *     anonymously - the way Tampermonkey does - and requires the same hash;
 *   - every probe carries a unique query key, because GitHub caches the 404 from the pre-upload
 *     probe and would otherwise keep answering 404 after the asset exists;
 *   - while the tag is HEAD it rebuilds in memory too, so a stale committed dist cannot ship.
 *
 * The mirror repository and asset name come from build-userscript.js's UPDATE_URL, so the place
 * this publishes and the place an installed copy looks cannot disagree.
 *
 *   node scripts/release.js --check   # verify the tag, both assets and the public URL; writes nothing
 *   node scripts/release.js           # create or refresh the mirror release from the verified asset
 *
 * Run it after `gh release create v<version>` in this repository. Requires Node 18+ (fetch) and
 * an authenticated `gh`.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { UPDATE_URL, build } = require('../build-userscript.js');

const ROOT = path.join(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');
const DIST = 'dist/autofish.user.js';
// The files build() reads. If any is modified, "build of the working tree" is not "build of the
// tag", so the fresh-build cross-check is skipped instead of comparing the wrong thing.
const BUILD_INPUTS = ['package.json', 'autofish.js', 'session.js', 'layout.js', 'panel.js', 'build-userscript.js'];

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: ROOT, encoding, maxBuffer: 64 * 1024 * 1024 });
}

function gh(args, input) {
  try {
    return execFileSync('gh', args, {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const detail = (err.stderr || err.stdout || '').toString().trim();
    throw new Error('gh ' + args.slice(0, 4).join(' ') + ' failed' + (detail ? ': ' + detail : ' (' + err.message + ')'));
  }
}

function hash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function size(buf) {
  return buf.length.toLocaleString('en-US') + ' bytes';
}

/**
 * Derive the publishing target from the URL the build advertises. Exported so a test can hold the
 * two together: if the header ever moves to another repository, this script moves with it.
 */
function mirrorFromUpdateUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/([^/]+)$/.exec(url);
  if (!m) throw new Error('UPDATE_URL must be a github.com/<owner>/<repo>/releases/latest/download/<asset> URL, got ' + url);
  return { repo: m[1] + '/' + m[2], asset: m[3] };
}

/**
 * The vault record rides on the release commit as a `HeyLoey-Milestone:` trailer, and the repo's
 * post-commit hook turns it into the daily note. Nothing about publishing depends on it, so a tag
 * without the trailer still ships - which is how 3.9.12 and then 3.9.43 went unrecorded and had to
 * be backfilled. The rule lived in an instruction; this makes the tool refuse instead.
 */
const TRAILER = /^HeyLoey-Milestone:[ \t]*(\S.*)$/m;
const TRAILER_EXEMPT = {
  // Tagged before this check existed; its note was written by hand on 2026-11-17 from the WSL
  // checkout. The exception is a record, not a silent skip - a new tag has to carry the trailer.
  'v3.9.43': 'logged by hand 2026-11-17 (commit 56afe89 was already tagged)',
  // The 3.9.63 tag was placed on the PR #33 merge commit after the source and mirror releases were
  // published, so adding the trailer would have meant moving a published tag. Backfilled by hand.
  'v3.9.63': 'tagged on merge commit c639a7f without the trailer; published 2026-11-24, so the tag cannot move; vault note logged 2026-11-25',
};

function milestoneText(body) {
  const m = TRAILER.exec(String(body || ''));
  return m ? m[1].trim() : '';
}

/**
 * Which repair to offer depends on whether the release is already out. A tag that is published must
 * not move - installed copies and the mirror point at the commit it already names - so the default
 * (and the only thing `--check` can safely say about an existing release) is to log the note and
 * leave git alone. Amending and re-tagging is offered only while nothing has been published.
 * `published` defaults to true: an unknown state has to give the safe advice.
 */
function milestoneFor(tag, body, options) {
  const published = !options || options.published !== false;
  const text = milestoneText(body);
  if (text) return { text, exempt: false, reason: null };
  if (TRAILER_EXEMPT[tag]) return { text: '', exempt: true, reason: TRAILER_EXEMPT[tag] };
  const logIt = '  log it:    heyloey done "<one line, the concrete outcome>"';
  if (published) {
    throw new Error(
      tag + ' has no HeyLoey-Milestone: trailer, so this release has no vault record.\n' +
      '  It is already published, so its tag must not move - writing the note is the fix:\n' +
      logIt
    );
  }
  throw new Error(
    tag + ' has no HeyLoey-Milestone: trailer, so the vault record for this release would not be written.\n' +
    '  Nothing is published for it yet, so the commit can still carry it:\n' +
    logIt + '\n' +
    '  then:      git commit --amend -m "<subject>" -m "HeyLoey-Milestone: <one line>"\n' +
    '  and move the tag: git tag -f ' + tag
  );
}

function sourceRepo() {
  const remote = git(['remote', 'get-url', 'origin']).trim();
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!m) throw new Error('origin is not a GitHub remote: ' + remote);
  return m[1] + '/' + m[2];
}

/**
 * Tampermonkey's update check is anonymous - no token, no session. GitHub answers anonymous
 * release-asset requests with 404 when the repository is not public, so a private or internal
 * mirror publishes successfully and still serves no updates. Refuse before any write.
 */
function requirePublicRepo(repo) {
  const visibility = gh(['api', 'repos/' + repo, '--jq', '.visibility']);
  if (visibility !== 'public') {
    throw new Error(
      'the mirror repository ' + repo + ' is ' + visibility +
      ' — anonymous update checks get 404 — make it public first: gh repo edit ' + repo + ' --visibility public'
    );
  }
  return visibility;
}

function releaseInfo(repo, tag) {
  try {
    const json = gh(['release', 'view', tag, '--repo', repo, '--json', 'tagName,name,body,isDraft,assets']);
    return JSON.parse(json);
  } catch (err) {
    // Only "this release does not exist" is an expected answer here. Auth failures, a mistyped
    // --json field or a dead network must stay errors: silently reading them as "no release yet"
    // is how a script publishes over something it never checked.
    if (/\b(not found|HTTP 404)\b/i.test(err.message)) return null;
    throw err;
  }
}

function download(repo, tag, asset, file) {
  gh(['release', 'download', tag, '--repo', repo, '--pattern', asset, '--output', file, '--clobber']);
  return fs.readFileSync(file);
}

/**
 * Upload the verified bytes, creating the release first when the mirror has none. The mirror has
 * its own history and no source commits, so the tag is created there pointing at its default
 * branch - only the asset is meaningful, and only its bytes are checked.
 */
function publishMirror(repo, tag, asset, bytes, source) {
  if (!releaseInfo(repo, tag)) {
    console.log('  mirror         creating release ' + tag);
    gh(['release', 'create', tag, '--repo', repo, '--title', source.name || tag, '--notes-file', '-'], source.body || '');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autofish-upload-'));
  try {
    const file = path.join(dir, asset);
    fs.writeFileSync(file, bytes);
    console.log('  mirror         uploading ' + asset + ' (' + size(bytes) + ')');
    gh(['release', 'upload', tag, file, '--repo', repo, '--clobber']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * GitHub's release-download route caches a 404 for a tag that does not exist yet. This script probes
 * before publishing, so reusing that URL after upload can keep reading the cached miss. The query
 * key is ignored by the route but keys a fresh cache entry, so every probe sees current state.
 */
function cacheBusted(url) {
  const separator = url.includes('?') ? '&' : '?';
  return url + separator + 'cb=' + crypto.randomBytes(8).toString('hex');
}

/** Anonymous on purpose: no gh, no token - the way a Tampermonkey update check arrives. */
async function fetchBytes(url) {
  const res = await fetch(cacheBusted(url), {
    redirect: 'follow',
    headers: { 'user-agent': 'autofish-release', 'cache-control': 'no-cache' },
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Fetch until the URL serves `expected`, or give up. A fresh upload is served through a CDN, so
 * the first reads after it can still be the previous asset; that is what the retries wait out.
 */
async function expectPublic(url, expected, attempts = 1, delayMs = 0) {
  let last = { status: 0, bytes: Buffer.alloc(0) };
  for (let i = 0; i < attempts; i += 1) {
    try {
      last = await fetchBytes(url);
      if (last.status === 200 && hash(last.bytes) === hash(expected)) return last;
    } catch (err) {
      last = { status: 0, bytes: Buffer.alloc(0), error: err.message };
    }
    if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last;
}

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const tag = 'v' + version;
  const mirror = mirrorFromUpdateUrl(UPDATE_URL);
  const source = sourceRepo();

  console.log('autofish ' + version + ' · ' + tag + (CHECK_ONLY ? ' · check only' : ''));
  gh(['auth', 'status']); // fail before any writes if gh has no credentials
  console.log('  mirror repo    ' + mirror.repo + ' · ' + requirePublicRepo(mirror.repo));

  let tagCommit;
  try {
    tagCommit = git(['rev-parse', '--verify', '--quiet', tag + '^{commit}']).trim();
  } catch (err) {
    throw new Error('no local tag ' + tag + ' — tag the release commit first');
  }
  // Whether the release already exists decides which repair the refusal may suggest, so this read
  // comes first - it is a read, and the gate still stands before any publish.
  const src = releaseInfo(source, tag);
  const milestone = milestoneFor(tag, git(['log', '-1', '--format=%B', tagCommit]), { published: !!src });
  const head = git(['rev-parse', 'HEAD']).trim();

  const tagged = JSON.parse(git(['show', tag + ':package.json']));
  if (tagged.version !== version) {
    throw new Error(tag + ' carries package.json ' + tagged.version + ', but this tree is ' + version);
  }

  let committed;
  try {
    committed = git(['show', tag + ':' + DIST], 'buffer');
  } catch (err) {
    throw new Error(tag + ' has no committed ' + DIST);
  }

  const header = committed.toString('utf8');
  const declared = /^\/\/ @version\s+(\S+)$/m.exec(header);
  const downloadUrl = /^\/\/ @downloadURL\s+(\S+)$/m.exec(header);
  const updateUrl = /^\/\/ @updateURL\s+(\S+)$/m.exec(header);
  if (!declared || declared[1] !== version) {
    throw new Error(DIST + ' at ' + tag + ' declares ' + (declared ? declared[1] : 'no version') + ', expected ' + version);
  }
  if (!downloadUrl || !updateUrl || downloadUrl[1] !== UPDATE_URL || updateUrl[1] !== UPDATE_URL) {
    throw new Error(DIST + ' at ' + tag + ' does not point @downloadURL and @updateURL at ' + UPDATE_URL);
  }

  const dirty = BUILD_INPUTS.filter((file) => git(['status', '--porcelain', '--', file]).trim() !== '');
  let fresh = null;
  if (tagCommit === head && dirty.length === 0) {
    fresh = Buffer.from(build(), 'utf8');
    if (hash(fresh) !== hash(committed)) {
      throw new Error(
        'the committed ' + DIST + ' is stale at ' + tag +
        ' (tag ships ' + hash(committed).slice(0, 12) + ', a fresh build is ' + hash(fresh).slice(0, 12) + ')' +
        ' — rebuild, commit and retag'
      );
    }
  }

  console.log('  tag            ' + tag + ' → ' + tagCommit.slice(0, 7) + (tagCommit === head ? '' : ' (HEAD ' + head.slice(0, 7) + ')'));
  console.log('  milestone      ' + (milestone.text || 'none recorded — exempt: ' + milestone.reason));
  console.log('  committed dist ' + size(committed) + ' · sha256 ' + hash(committed).slice(0, 12));
  if (fresh) console.log('  fresh build    ' + size(fresh) + ' · sha256 ' + hash(fresh).slice(0, 12) + ' · match');
  else if (dirty.length) console.log('  fresh build    skipped (' + dirty.join(', ') + ' modified)');

  if (!src) throw new Error('no source release ' + tag + ' in ' + source + ' — create it before mirroring');
  if (src.isDraft) throw new Error('source release ' + tag + ' is a draft — publish it before mirroring');
  if (!src.assets.some((asset) => asset.name === mirror.asset)) {
    throw new Error('source release ' + tag + ' has no ' + mirror.asset + ' asset — attach the built file first');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autofish-release-'));
  try {
    const shipped = download(source, tag, mirror.asset, path.join(dir, mirror.asset));
    if (hash(shipped) !== hash(committed)) {
      throw new Error(
        'the source release asset does not match the build committed at ' + tag +
        ' (asset ' + hash(shipped).slice(0, 12) + ', tag ' + hash(committed).slice(0, 12) + ') — replace the asset'
      );
    }
    console.log('  source asset   ' + size(shipped) + ' · sha256 ' + hash(shipped).slice(0, 12) + ' · match');

    const tagUrl = 'https://github.com/' + mirror.repo + '/releases/download/' + tag + '/' + mirror.asset;
    let published = false;
    let served = await expectPublic(tagUrl, committed);
    if (hash(served.bytes) !== hash(committed)) {
      if (CHECK_ONLY) {
        throw new Error(
          'the mirror does not serve the tagged build (status ' + served.status +
          (served.bytes.length ? ', ' + size(served.bytes) + ' sha256 ' + hash(served.bytes).slice(0, 12) : '') +
          ') — run node scripts/release.js'
        );
      }
      publishMirror(mirror.repo, tag, mirror.asset, committed, src);
      published = true;
      served = await expectPublic(tagUrl, committed, 10, 3000);
      if (hash(served.bytes) !== hash(committed)) {
        throw new Error(
          'the mirror still does not serve the tagged build after upload (status ' + served.status + ')' +
          (served.status === 404 ? ' — check that ' + mirror.repo + ' is still public' : '')
        );
      }
    }
    console.log('  mirror asset   ' + size(served.bytes) + ' · sha256 ' + hash(served.bytes).slice(0, 12) + ' · match' + (published ? ' · published' : ''));

    // The URL installed copies actually poll. Only meaningful while this tag is the newest
    // release: releases/latest follows the newest, so an older tag cannot own that path.
    const latest = gh(['release', 'list', '--repo', mirror.repo, '--limit', '1', '--json', 'tagName', '--jq', '.[0].tagName']);
    if (latest === tag) {
      const polled = await expectPublic(UPDATE_URL, committed, published ? 10 : 1, 3000);
      if (hash(polled.bytes) !== hash(committed)) {
        throw new Error('releases/latest does not serve the tagged build (status ' + polled.status + ') — installed copies would update to something else');
      }
      console.log('  latest URL     ' + size(polled.bytes) + ' · sha256 ' + hash(polled.bytes).slice(0, 12) + ' · match (anonymous)');
    } else {
      console.log('  latest URL     ' + (latest || 'none') + ' is newest; releases/latest does not resolve to ' + tag);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + (CHECK_ONLY ? 'both releases match the tagged build' : 'source and mirror releases are identical'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nerror: ' + err.message);
    process.exitCode = 1;
  });
}

module.exports = { mirrorFromUpdateUrl, expectPublic, milestoneText, milestoneFor };
