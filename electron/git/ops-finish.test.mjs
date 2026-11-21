import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBoard } from './board.mjs';
import { createLane, finishLane, repairLane, mergeLaneIntoMain } from './ops.mjs';

function sh(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-finish-'));
  sh(['init', '-b', 'main', root]);
  sh(['config', 'user.email', 't@e.com'], root);
  sh(['config', 'user.name', 'T'], root);
  sh(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'README'), 'x\n');
  sh(['add', 'README'], root);
  sh(['commit', '-m', 'init'], root);
  fs.mkdirSync(path.join(root, '.plenum'));
  fs.writeFileSync(
    path.join(root, '.plenum', 'lane.yaml'),
    ['version: 1', 'run: echo hi', 'setup: "mkdir -p .plenum && : > .plenum/prepared"', 'ports:', '  offset: 10', '  expose:', '    web: 5000', ''].join('\n'),
  );
  fs.writeFileSync(path.join(root, '.gitignore'), '.plenum/prepared\n.worktrees/\n');
  sh(['add', '.plenum/lane.yaml', '.gitignore'], root);
  sh(['commit', '-m', 'lane setup'], root);
  return root;
}

test('finishLane merges into Protected and removes the worktree', async () => {
  const root = fixture();
  try {
    await createLane(root, { name: 'one', branch: 'feat/one', lanesFolder: path.join(root, '.worktrees') });
    let board = await loadBoard(root);
    const lane = board.lanes.find((l) => l.branch === 'feat/one');
    assert.ok(lane);
    assert.equal(lane.prepared, true);
    fs.writeFileSync(path.join(lane.path, 'note'), 'y\n');
    sh(['add', 'note'], lane.path);
    sh(['commit', '-m', 'work'], lane.path);
    board = await finishLane(root, lane.index, { mode: 'merge', into: 'main', remove: true });
    assert.ok(!board.lanes.some((l) => l.branch === 'feat/one'));
    assert.ok(fs.existsSync(path.join(root, 'note')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mergeLaneIntoMain can target another open lane', async () => {
  const root = fixture();
  try {
    await createLane(root, { name: 'a', branch: 'feat/a', lanesFolder: path.join(root, '.worktrees') });
    await createLane(root, { name: 'b', branch: 'feat/b', lanesFolder: path.join(root, '.worktrees') });
    let board = await loadBoard(root);
    const a = board.lanes.find((l) => l.branch === 'feat/a');
    const b = board.lanes.find((l) => l.branch === 'feat/b');
    // Ignore runner stamp noise so merge sees a clean target.
    for (const p of [a.path, b.path]) {
      fs.appendFileSync(path.join(p, '.gitignore'), '\n.plenum/\n');
      sh(['add', '.gitignore'], p);
      sh(['commit', '-m', 'ignore plenum'], p);
    }
    fs.writeFileSync(path.join(a.path, 'a.txt'), 'a\n');
    sh(['add', 'a.txt'], a.path);
    sh(['commit', '-m', 'a'], a.path);
    board = await mergeLaneIntoMain(root, a.index, { mode: 'merge', into: 'feat/b' });
    assert.ok(fs.existsSync(path.join(b.path, 'a.txt')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repairLane stamps an unprepared worktree', async () => {
  const root = fixture();
  const wt = path.join(os.tmpdir(), `plenum-repair-${Date.now()}`);
  try {
    sh(['worktree', 'add', '-b', 'feat/ext', wt], root);
    let board = await loadBoard(root);
    const lane = board.lanes.find((l) => l.branch === 'feat/ext');
    assert.ok(lane);
    assert.equal(lane.prepared, false);
    board = await repairLane(root, lane.index);
    const fixed = board.lanes.find((l) => l.branch === 'feat/ext');
    assert.equal(fixed.prepared, true);
  } finally {
    try { sh(['worktree', 'remove', '--force', wt], root); } catch { /* */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
