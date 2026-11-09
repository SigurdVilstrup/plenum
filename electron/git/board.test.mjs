import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadBoard, classifyAuthorship, parseDirty, parseNumstat, loadCommitChanges } from './board.mjs';

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

test('classify assisted trailer', () => {
  const a = classifyAuthorship('Sigurd', 's@x.com', 'Co-authored-by: Claude <c@x.com>');
  assert.equal(a.kind, 'assisted');
  assert.equal(a.tool, 'Claude');
});

test('parseDirty: paths and renames', () => {
  const files = parseDirty([' M notes.txt', '?? new.md', 'R  old.txt -> renamed.txt'].join('\n'));
  assert.deepEqual(files, [
    { path: 'notes.txt', code: ' M' },
    { path: 'new.md', code: '??' },
    { path: 'renamed.txt', code: 'R ' },
  ]);
});

test('parseNumstat', () => {
  const m = parseNumstat('12\t3\tsrc/a.js\n-\t-\tbin/x\n1\t0\told => new\n');
  assert.deepEqual(m.get('src/a.js'), { added: 12, deleted: 3 });
  assert.deepEqual(m.get('bin/x'), { added: 0, deleted: 0 });
  assert.deepEqual(m.get('new'), { added: 1, deleted: 0 });
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
    assert.equal(lane.dirtyFiles.length, 1);
    assert.equal(lane.dirtyFiles[0].path, 'notes.txt');
    assert.ok(lane.dirtyFiles[0].added >= 1);
    assert.equal(lane.readiness, 'working');
    const tip = await loadCommitChanges(root, board.lanes[0].head);
    assert.ok(tip.files.some((f) => f.path === 'README'));
    assert.equal(lane.authorship, 'assisted');
    assert.equal(lane.tool, 'Claude');
    assert.equal(board.lanes[0].readiness, 'protected');
    assert.ok(board.commits.some((c) => c.isWIP && c.lane === 1));
    assert.equal(lane.runnable, false);
    assert.equal(board.lanes[0].runnable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('loadBoard: feature lane runnable from .overlook/lane.yaml', async () => {
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

    const overlook = path.join(root, '.overlook');
    fs.mkdirSync(overlook);
    fs.copyFileSync(
      path.join(process.cwd(), 'fixtures/lane/minimal.lane.yaml'),
      path.join(overlook, 'lane.yaml'),
    );

    const board = await loadBoard(root);
    assert.equal(board.lanes.length, 2);

    const primary = board.lanes[0];
    assert.equal(primary.runnable, false);
    assert.equal(primary.running, false);

    const lane = board.lanes[1];
    assert.equal(lane.runnable, true);
    assert.equal(lane.offset, 100);
    assert.deepEqual(lane.urls, { web: 'http://127.0.0.1:5101' });
    assert.equal(lane.dataMode, 'shared');
    assert.equal(lane.running, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('loadBoard: merge packs feature tip onto a side column', async () => {
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
    fs.writeFileSync(path.join(wt, 'feat.txt'), 'side');
    git(['add', 'feat.txt'], wt);
    git(['commit', '-m', 'feature tip'], wt);
    fs.writeFileSync(path.join(root, 'main.txt'), 'main-side');
    git(['add', 'main.txt'], root);
    git(['commit', '-m', 'main tip'], root);
    git(['merge', 'feat/one', '--no-ff', '-m', 'merge feature'], root);

    const board = await loadBoard(root);
    const merge = board.commits.find((c) => c.isMerge);
    assert.ok(merge, 'expected a merge commit');
    assert.equal(merge.lane, 0);
    const featHead = board.lanes[1].head;
    const feat = board.commits.find((c) => c.id === featHead);
    assert.ok(feat, 'expected feature tip in history');
    assert.equal(feat.lane, 1);
    assert.notEqual(feat.lane, merge.lane);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('loadBoard: bad lane.yaml still loads board as not runnable', async () => {
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

    const overlook = path.join(root, '.overlook');
    fs.mkdirSync(overlook);
    fs.writeFileSync(path.join(overlook, 'lane.yaml'), 'version: 2\nrun: echo hi\n');

    const board = await loadBoard(root);
    assert.equal(board.lanes.length, 2);
    assert.equal(board.lanes[0].runnable, false);
    assert.equal(board.lanes[1].runnable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
