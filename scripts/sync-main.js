#!/usr/bin/env node
// @ts-check
/**
 * Move the local `main` branch to origin/main, so a checkout that follows main picks up merged work
 * without a manual trip into it.
 *
 * A linked worktree makes this less obvious than it sounds: the commits are in the shared object
 * database as soon as they are fetched, but the files on disk follow a branch, and a branch only
 * moves when something moves it. This moves it - and only forward:
 *
 *   - it fetches origin/main first, so "up to date" is measured against the remote, not a stale ref;
 *   - it refuses unless main can fast-forward, so a local commit on main is never dropped, and it
 *     names the commits that are in the way;
 *   - when main is checked out in a worktree, git does the merge there, so that worktree's files are
 *     the ones that update and git gets the last word on local-modification conflicts;
 *   - when main is checked out nowhere, the ref moves with a compare-and-swap, so a concurrent
 *     update makes it fail instead of being silently overwritten;
 *   - with no local main at all, it creates one at origin/main.
 *
 *   npm run sync          # or: node scripts/sync-main.js
 *
 * Prints what moved and what changed; exits 1 when it refused. Works from any worktree of the
 * repository, including one on a detached HEAD.
 */
'use strict';
const { execFileSync } = require('child_process');

const MAIN = 'refs/heads/main';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/** The same, but an expected failure comes back as data instead of an exception. */
function gitSoft(args, cwd) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (e) {
    const text = String(e.stderr || '') + String(e.stdout || '');
    return { ok: false, out: text.trim() || e.message };
  }
}
function die(msg) {
  console.error('sync-main: ' + msg);
  process.exit(1);
}
const short = (sha) => sha.slice(0, 7);
const subject = (sha, cwd) => git(['log', '-1', '--format=%s', sha], cwd);
const count = (range, cwd) => git(['rev-list', '--count', range], cwd);

/** The worktree that has main checked out, or '' when it is checked out nowhere. */
function mainWorktree(cwd) {
  let at = '';
  for (const line of git(['worktree', 'list', '--porcelain'], cwd).split('\n')) {
    if (line.startsWith('worktree ')) at = line.slice('worktree '.length);
    else if (line === 'branch ' + MAIN) return at;
    else if (line === '') at = '';
  }
  return '';
}

const inside = gitSoft(['rev-parse', '--show-toplevel'], process.cwd());
if (!inside.ok) die('not inside a git repository');
const repo = inside.out;

const fetched = gitSoft(['fetch', '--quiet', 'origin', 'main'], repo);
if (!fetched.ok) die('fetch of origin/main failed:\n' + fetched.out);
const target = git(['rev-parse', 'origin/main'], repo);

const current = gitSoft(['rev-parse', '--verify', '--quiet', MAIN], repo);
if (!current.ok) {
  const made = gitSoft(['update-ref', '-m', 'sync-main: create main at origin/main', MAIN, target], repo);
  if (!made.ok) die('could not create main: ' + made.out);
  console.log(`created main at ${short(target)}  ${subject(target, repo)}`);
  process.exit(0);
}
const from = current.out;

if (from === target) {
  console.log(`main is already at origin/main  ${short(from)}  ${subject(from, repo)}`);
  process.exit(0);
}

if (!gitSoft(['merge-base', '--is-ancestor', from, target], repo).ok) {
  die(
    `main has commits origin/main does not, so it cannot fast-forward.\n` +
      `  main only:        ${count(target + '..' + from, repo)} commit(s)\n` +
      `  origin/main only: ${count(from + '..' + target, repo)} commit(s)\n` +
      '  Rebase or merge main yourself; this script never rewrites or discards history.'
  );
}

console.log(`main: ${short(from)} -> ${short(target)}  (${count(from + '..' + target, repo)} commit(s) to apply)`);

const holder = mainWorktree(repo);
if (holder) {
  const merged = gitSoft(['merge', '--ff-only', '--quiet', target], holder);
  if (!merged.ok) die(`fast-forward failed in ${holder}:\n${merged.out}`);
  console.log(`fast-forwarded the worktree that has main checked out: ${holder}`);
} else {
  const moved = gitSoft(['update-ref', '-m', 'sync-main: fast-forward to origin/main', MAIN, target, from], repo);
  if (!moved.ok) die('could not move main: ' + moved.out);
  console.log('main is checked out nowhere; moved the branch ref only.');
}

const changed = git(['diff', '--shortstat', from, target], repo);
if (changed) console.log(changed);
