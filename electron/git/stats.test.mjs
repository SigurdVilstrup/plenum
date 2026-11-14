import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeStats, heatPeak, loadStats } from './stats.mjs';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime() / 1000;
const c = (name, email, when, subject, files, body = '') => ({
  name, email, at: when, subject, body, files: new Map(Object.entries(files)),
});

test('computeStats: people, agents, days, heatmap', () => {
  const now = new Date(2026, 10, 12, 15).getTime();
  const s = computeStats([
    c('Ada', 'a@x.com', at(2026, 11, 12, 9), 'feat: a', { 'a.js': { added: 100, deleted: 10 } }),
    c('Ada', 'A@x.com', at(2026, 11, 11, 9), 'fix(ui): b', { 'a.js': { added: 5, deleted: 5 } }, 'Co-Authored-By: Claude <noreply@anthropic.com>'),
    c('Lin', 'l@x.com', at(2026, 11, 10, 22), 'chore: c', { 'b.js': { added: 1, deleted: 0 } }),
    c('Lin', 'l@x.com', at(2026, 11, 1, 22), 'no prefix', {}),
  ], { now, merges: 2 });
  assert.equal(s.commits, 4);
  assert.equal(s.merges, 2);
  assert.equal(s.added, 106);
  assert.equal(s.people[0].name, 'Ada');
  assert.equal(s.people[0].commits, 2); // emails differ only by case
  assert.equal(s.people[0].withAgent, 1);
  assert.deepEqual(s.tools.map((t) => t.tool).sort(), ['Claude', 'Human']);
  assert.equal(s.kinds.assisted, 1);
  assert.equal(s.series.length, 14); // young repo: two weeks of axis, not 90 empty days
  assert.equal(s.series.at(-1).n, 1); // today
  assert.equal(s.series.at(-1).day, '2026-11-12');
  assert.equal(s.longestStreak, 3); // 10, 11, 12 Nov
  assert.equal(s.heat[3][9], 1); // Thu 12 Nov 09:00
  assert.deepEqual(s.heatPeak, { day: 1, hour: 22, n: 1 }); // tied at 1: first cell in scan order (Tue 22:00)
  assert.deepEqual(s.awards.map((a) => a.id), ['lines', 'streak']); // four small commits earn only 105 lines and a 3-day streak
  assert.equal(s.awards.find((a) => a.id === 'lines').scope, 'person');
  assert.equal(s.awards.find((a) => a.id === 'streak').scope, 'repo');
  assert.equal(s.awards.find((a) => a.id === 'lines').email, 'a@x.com');
  assert.deepEqual(s.weekly.tools, ['Human', 'Claude']);
  assert.equal(s.weekly.unit, 'day'); // 12 days of history
  assert.equal(s.weekly.weeks.length, 14); // never fewer than two weeks of axis
  assert.equal(s.weekly.totals.Claude, 1);
  assert.equal(s.weekly.weeks.at(-1).counts.Human, 1); // today, 12 Nov
  assert.equal(s.series.length, 14);
});

test('awards: need two people and a real margin, then name the winner', () => {
  const now = new Date(2026, 10, 12, 15).getTime();
  const many = (name, n, hour, subject, body = '') => Array.from({ length: n }, (_, i) =>
    c(name, `${name}@x.com`, at(2026, 11, 2 + (i % 5), hour), subject, { 'a.js': { added: 40, deleted: 1 } }, body));
  const crowd = [
    ...many('Ada', 4, 23, 'fix: night', 'Co-Authored-By: Claude <noreply@anthropic.com>'),
    ...many('Lin', 3, 10, 'feat: day'),
  ];
  const award = (list, id) => computeStats(list, { now }).awards.find((x) => x.id === id);
  assert.equal(award(crowd, 'night').who, 'Ada');
  assert.equal(award(crowd, 'fixes').who, 'Ada');
  assert.equal(award(crowd, 'ai').who, 'Ada');
  assert.equal(award(crowd, 'human').who, 'Lin');
  assert.equal(award(crowd, 'early'), undefined); // nobody committed before 09:00
  assert.equal(award(many('Ada', 6, 23, 'fix: solo'), 'night'), undefined); // nobody to beat
  assert.equal(award(many('Ada', 6, 23, 'fix: solo'), 'file').who, null); // repo-wide still shows
  assert.equal(award(crowd, 'file').scope, 'repo');
  assert.equal(award(crowd, 'night').scope, 'person');
});

test('heatPeak: empty and ties pick the first cell', () => {
  assert.equal(heatPeak(Array.from({ length: 7 }, () => Array(24).fill(0))), null);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  heat[1][3] = 2;
  heat[5][10] = 2;
  assert.deepEqual(heatPeak(heat), { day: 1, hour: 3, n: 2 });
});

test('computeStats: old history buckets by week and keeps 90 days', () => {
  const now = new Date(2026, 10, 12, 15).getTime();
  const s = computeStats([c('Ada', 'a@x.com', at(2026, 1, 5), 'feat: old', {}), c('Ada', 'a@x.com', at(2026, 11, 12), 'feat: new', {})], { now });
  assert.equal(s.weekly.unit, 'week');
  assert.equal(s.weekly.weeks.length, 52);
  assert.equal(s.series.length, 90);
});

test('computeStats: empty', () => {
  const s = computeStats([]);
  assert.equal(s.commits, 0);
  assert.equal(s.first, null);
  assert.equal(s.perCalendarDay, 0);
});

test('loadStats: protected scope ignores other branches, all scope sees them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-stats-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g('init', '-b', 'main');
  g('config', 'user.name', 'Ada'); g('config', 'user.email', 'a@x.com');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'one\ntwo\n');
  g('add', '.'); g('commit', '-m', 'feat: first');
  g('checkout', '-b', 'side');
  fs.writeFileSync(path.join(dir, 'g.txt'), 'x\n');
  g('add', '.'); g('commit', '-m', 'fix: side\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
  g('checkout', 'main');
  const prot = await loadStats(dir, 'protected');
  assert.equal(prot.commits, 1);
  assert.equal(prot.added, 2);
  assert.equal(prot.teamRef, 'main');
  const all = await loadStats(dir, 'all');
  assert.equal(all.commits, 2);
  assert.equal(all.tools.find((t) => t.tool === 'Claude').commits, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
