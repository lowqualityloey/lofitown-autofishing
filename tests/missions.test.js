'use strict';
/**
 * The Quests parser must read exactly what the live panel showed during the M0 spike
 * (2026-11-28, TASK-2026-11-28-missions-awareness-d1): three daily rows, three weekly rows,
 * reward numbers with thousands separators, "0/1"-style progress, "Complete" status, and two
 * countdown formats. Everything here is pure — the DOM walk itself stays thin and untested by
 * design, so a game UI reshape fails as "no quests", never as a broken test suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/missions.js');

test('the captured daily panel parses into three missions, scope from the countdown', () => {
  const read = M.shapeRead(M.parseLines([
    'Quests', 'daily', 'weekly', '12:49:52',
    'Place 1 furniture in your Burrow', '450', '0/1',
    'Sell 200 coins worth of fish', '500', 'Complete',
    'Catch 10 fish', '550', 'Complete',
  ]), '12:49:52');
  assert.equal(read.scope, 'daily');
  assert.equal(read.countdown, '12:49:52');
  assert.deepEqual(read.missions.map((m) => [m.objective, m.reward, m.progress, m.complete]), [
    ['Place 1 furniture in your Burrow', '450', '0/1', false],
    ['Sell 200 coins worth of fish', '500', null, true],
    ['Catch 10 fish', '550', null, true],
  ]);
});

test('the captured weekly panel keeps the D:HH:MM:SS countdown as weekly scope', () => {
  const read = M.shapeRead(M.parseLines([
    'Quests', 'daily', 'weekly', '01:12:48:21',
    "Visit 10 friends' burrows", '1,500', '0/10',
    'Catch 75 fish', '1,550', 'Complete',
    'Catch 5 epic fish', '1,550', 'Complete',
  ]), '01:12:48:21');
  assert.equal(read.scope, 'weekly');
  assert.equal(read.missions.length, 3);
  assert.equal(read.missions[0].objective, "Visit 10 friends' burrows");
  assert.equal(read.missions[0].reward, '1,500');
  assert.equal(read.missions[0].progress, '0/10');
  assert.equal(read.missions[0].complete, false);
});

test('headings, tab labels and non-countdown clock lines are never missions', () => {
  assert.deepEqual(M.parseLines(['Quests', 'daily', 'weekly']), []);
  assert.deepEqual(M.parseLines([]), []);
  assert.deepEqual(M.parseLines(['8:08']), []);
  assert.equal(M.countdownScope('8:08'), null);
  assert.equal(M.countdownScope('12:49:52'), 'daily');
  assert.equal(M.countdownScope('01:12:48:21'), 'weekly');
});

test('a triple missing its progress line is not fabricated into a quest', () => {
  assert.deepEqual(M.parseLines(['Catch 10 fish', '550']), []);
  assert.deepEqual(M.parseLines(['Catch 10 fish', '550', 'Complete', 'orphan objective']), [
    { objective: 'Catch 10 fish', reward: '550', progress: null, complete: true },
  ]);
});

test('the missions module rides the core assembly into the userscript build', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'build-userscript.js'), 'utf8');
  assert.match(src, /'src\/missions\.js'/);
});

test('exportRun carries the mission snapshot additively and never fails the export', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'autofish.js'), 'utf8');
  const start = src.indexOf('F.exportRun = function');
  const end = src.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start, 'F.exportRun must be present');
  const body = src.slice(start, end);
  assert.match(body, /missions: \(function \(\)/);
  assert.match(body, /F\.exportMissions/);
  assert.match(body, /catch \(e\)/, 'a throwing panel hook must not fail the export');
});

test('the /report response carries missions as an additive optional field', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'fishserve.js'), 'utf8');
  assert.match(src, /function latestMissions/);
  assert.match(src, /missions: latestMissions\(RUNS\(\)\),/);
});

test('the panel never activates the claim control — read-only by contract', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'missions.js'), 'utf8');
  assert.match(src, /cozy-missions-claim/);
  assert.doesNotMatch(src, /\.click\(/);
  const panel = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
  const start = panel.indexOf('function renderMissions');
  const end = panel.indexOf('function missionsBlock', start);
  assert.ok(start >= 0 && end > start, 'renderMissions must be present');
  const body = panel.slice(start, end);
  assert.doesNotMatch(body, /\.click\(/);
});
