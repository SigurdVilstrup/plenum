import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadBoard, classifyAuthorship } from './board.mjs';

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

test('classify assisted trailer', () => {
  const a = classifyAuthorship('Sigurd', 's@x.com', 'Co-authored-by: Claude <c@x.com>');
  assert.equal(a.kind, 'assisted');
  assert.equal(a.tool, 'Claude');
});

test('loadBoard: worktree ahead dirty assisted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-'));
  const wt = path.join(os.tmpdir(), `overlook-wt-${Date.now()}`);
  try {
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 't@example.com'], root);
    git(['config', 'user.name', 'Tester'], root);
    git(['config', 'commit.gpgsign', 'false'], root);
    fs.writeFileSync(path.join(root, 'README'), 'hello');
    git(['add', 'README'], root);
    git(['commit', '-m', 'init'], root);
    git(['worktree', 'add', '-b', 'feat/one', wt], root);
    git(['commit', '--allow-empty', '-m', 'lane tip', '-m', 'Co-authored-by: Claude Opus <noreply@anthropic.com>'], wt);
    fs.writeFileSync(path.join(wt, 'notes.txt'), 'dirty');

    const board = await loadBoard(root);
    assert.equal(board.lanes.length, 2);
    const lane = board.lanes[1];
    assert.equal(lane.name, 'feat/one');
    assert.equal(lane.behind, 0);
    assert.equal(lane.ahead, 1);
    assert.equal(lane.dirty, 1);
    assert.equal(lane.readiness, 'working');
    assert.equal(lane.authorship, 'assisted');
    assert.equal(lane.tool, 'Claude');
    assert.equal(board.lanes[0].readiness, 'protected');
    assert.ok(board.commits.some((c) => c.isWIP && c.lane === 1));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
