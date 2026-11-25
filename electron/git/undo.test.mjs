import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as ops from './ops.mjs';
import * as undo from './undo.mjs';
import { gitIdentity, tmpDir } from './test-tmp.mjs';

const sh = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

function fixture() {
  const root = tmpDir('ovl-undo-');
  sh(['init', '-b', 'main', root]);
  gitIdentity(root, sh);
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'bee\n');
  sh(['add', '.'], root);
  sh(['commit', '-m', 'base'], root);
  return root;
}

test('revert → restorePaths brings back modified, deleted and untracked files', async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'a.txt'), 'edited\n');
  fs.rmSync(path.join(root, 'b.txt'));
  fs.writeFileSync(path.join(root, 'new.txt'), 'fresh\n');
  const paths = ['a.txt', 'b.txt', 'new.txt'];
  const snap = await undo.snapshotLane(root, 0, paths);
  await ops.revertLaneChanges(root, 0, paths);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'base\n');
  assert.ok(!fs.existsSync(path.join(root, 'new.txt')));
  await undo.restorePaths(root, 0, { sha: snap.sha, paths });
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'edited\n');
  assert.ok(!fs.existsSync(path.join(root, 'b.txt')));
  assert.equal(fs.readFileSync(path.join(root, 'new.txt'), 'utf8'), 'fresh\n');
});

test('restorePaths refuses when the files changed again', async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'a.txt'), 'edited\n');
  const snap = await undo.snapshotLane(root, 0, ['a.txt']);
  await ops.revertLaneChanges(root, 0, ['a.txt']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'newer\n');
  await assert.rejects(undo.restorePaths(root, 0, { sha: snap.sha, paths: ['a.txt'] }), /changed since/);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'newer\n');
});

test('uncommit only while tip is unpushed and unchanged', async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'a.txt'), 'two\n');
  let board = await ops.commitLane(root, 0, 'two');
  const tip = board.lanes[0].head;
  board = await undo.uncommit(root, 0, tip);
  assert.notEqual(board.lanes[0].head, tip);
  assert.equal(board.lanes[0].dirty, 1);
  await assert.rejects(undo.uncommit(root, 0, tip), /moved/);
});

test('remove lane → restoreLane brings back worktree and uncommitted files', async () => {
  const root = fixture();
  let board = await ops.createLane(root, { name: 'one', branch: 'feat/one' });
  const lane = board.lanes.find((l) => l.branch === 'feat/one');
  fs.writeFileSync(path.join(lane.path, 'a.txt'), 'wip\n');
  fs.writeFileSync(path.join(lane.path, 'u.txt'), 'untracked\n');
  const snap = await undo.snapshotLane(root, lane.index);
  await ops.removeLane(root, lane.index, { force: true });
  undo.rememberLane(root, lane);
  assert.ok(!fs.existsSync(lane.path));
  await assert.rejects(undo.restoreLane(root, { path: '/tmp/not-removed-by-us' }), /Nothing to restore/);
  board = await undo.restoreLane(root, { path: lane.path, sha: snap.sha });
  const back = board.lanes.find((l) => l.branch === 'feat/one');
  assert.ok(back);
  assert.equal(fs.readFileSync(path.join(lane.path, 'a.txt'), 'utf8'), 'wip\n');
  assert.equal(fs.readFileSync(path.join(lane.path, 'u.txt'), 'utf8'), 'untracked\n');
  assert.equal(back.dirty, 2);
});

test('delete branch → restoreBranch', async () => {
  const root = fixture();
  sh(['branch', 'topic'], root);
  const tip = sh(['rev-parse', 'topic'], root).trim();
  await ops.deleteBranch(root, 'topic', { force: true });
  const board = await undo.restoreBranch(root, 'topic', tip);
  assert.ok(board.branches.some((b) => b.name === 'topic' && b.head === tip));
  await assert.rejects(undo.restoreBranch(root, 'topic', tip), /exists/);
});
