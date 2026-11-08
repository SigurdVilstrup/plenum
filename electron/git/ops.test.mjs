import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as ops from './ops.mjs';
import { loadBoard } from './board.mjs';
import { git } from './run.mjs';

function sh(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-bare-')) + '.git';
  fs.rmSync(bare, { recursive: true, force: true });
  sh(['init', '-b', 'main', root]);
  sh(['config', 'user.email', 't@e.com'], root);
  sh(['config', 'user.name', 'T'], root);
  sh(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  sh(['add', 'a.txt'], root);
  sh(['commit', '-m', 'base'], root);
  sh(['init', '--bare', bare]);
  sh(['remote', 'add', 'origin', bare], root);
  sh(['push', '-u', 'origin', 'main'], root);
  return { root, bare };
}

test('create commit push rebase force-with-lease merge remove', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'one', branch: 'feat/one' });
  const lane = board.lanes.find((l) => l.name === 'feat/one');
  assert.ok(lane);
  assert.equal(lane.readiness, 'unmerged');
  fs.writeFileSync(path.join(lane.path, 'x.txt'), 'x');
  board = await ops.commitLane(root, lane.index, 'x');
  board = await ops.pushLane(root, lane.index);
  fs.writeFileSync(path.join(root, 'main.txt'), 'm');
  await git(['add', 'main.txt'], root);
  await git(['commit', '-m', 'main moves'], root);
  await git(['push'], root);
  board = await loadBoard(root);
  assert.ok(board.lanes.find((l) => l.name === 'feat/one').behind > 0);
  board = await ops.rebaseLane(root, lane.index);
  assert.equal(board.lanes.find((l) => l.name === 'feat/one').behind, 0);
  board = await ops.pushLane(root, lane.index);
  board = await ops.mergeLaneIntoMain(root, lane.index, { mode: 'ff' });
  const merged = board.lanes.find((l) => l.name === 'feat/one');
  assert.equal(merged.readiness, 'safe');
  board = await ops.removeLane(root, merged.index);
  assert.ok(!board.lanes.some((l) => l.name === 'feat/one'));
});

test('merge conflict walks primary via conflictRoot', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'c', branch: 'feat/c' });
  const lane = board.lanes.find((l) => l.name === 'feat/c');
  fs.writeFileSync(path.join(lane.path, 'a.txt'), 'lane\n');
  await git(['add', 'a.txt'], lane.path);
  await git(['commit', '-m', 'lane'], lane.path);
  fs.writeFileSync(path.join(root, 'a.txt'), 'main\n');
  await git(['add', 'a.txt'], root);
  await git(['commit', '-m', 'main'], root);
  let caught;
  try {
    await ops.mergeLaneIntoMain(root, lane.index, { mode: 'merge' });
  } catch (e) {
    caught = e;
  }
  assert.equal(caught?.code, 'CONFLICT');
  assert.equal(fs.realpathSync(caught.conflictRoot), fs.realpathSync(root));
  const st = await ops.conflictStatus(root, lane.index, caught.conflictRoot);
  assert.deepEqual(st.conflicts, ['a.txt']);
  assert.equal(st.operation, 'merge');
  fs.writeFileSync(path.join(root, 'a.txt'), 'resolved\n');
  await ops.conflictStage(root, lane.index, 'a.txt', caught.conflictRoot);
  board = await ops.conflictContinue(root, lane.index, caught.conflictRoot);
  assert.ok(board.lanes);
});


test('fresh lane is not safe; merged stays safe after push main', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'fresh', branch: 'feat/fresh' });
  const fresh = board.lanes.find((l) => l.name === 'feat/fresh');
  assert.equal(fresh.readiness, 'unmerged');
  fs.writeFileSync(path.join(fresh.path, 'z.txt'), 'z');
  board = await ops.commitLane(root, fresh.index, 'z');
  board = await ops.mergeLaneIntoMain(root, fresh.index, { mode: 'ff' });
  assert.equal(board.lanes.find((l) => l.name === 'feat/fresh').readiness, 'safe');
  await git(['push'], root);
  board = await loadBoard(root);
  assert.equal(board.lanes.find((l) => l.name === 'feat/fresh').readiness, 'safe');
});


test('primary push after merge publishes to origin', async () => {
  const { root } = await fixture();
  let board = await ops.createLane(root, { name: 'pub', branch: 'feat/pub' });
  const lane = board.lanes.find((l) => l.name === 'feat/pub');
  fs.writeFileSync(path.join(lane.path, 'p.txt'), 'p');
  board = await ops.commitLane(root, lane.index, 'pub tip');
  board = await ops.mergeLaneIntoMain(root, lane.index, { mode: 'ff' });
  assert.ok(board.lanes[0].ahead > 0);
  board = await ops.pushLane(root, 0);
  assert.equal(board.lanes[0].ahead, 0);
});


test('primary commit push pull', async () => {
  const { root } = await fixture();
  fs.writeFileSync(path.join(root, 'on-main.txt'), 'm');
  let board = await ops.commitLane(root, 0, 'main commit');
  assert.equal(board.lanes[0].dirty, 0);
  assert.ok(board.lanes[0].ahead >= 1);
  board = await ops.pushLane(root, 0);
  assert.equal(board.lanes[0].ahead, 0);
  // Advance remote via a second clone tip: commit locally then reset? Simpler: make another commit on a bare via worktree.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-other-'));
  await git(['clone', (await git(['remote', 'get-url', 'origin'], root)).trim(), other]);
  await git(['config', 'user.email', 't@e.com'], other);
  await git(['config', 'user.name', 'T'], other);
  await git(['config', 'commit.gpgsign', 'false'], other);
  fs.writeFileSync(path.join(other, 'remote.txt'), 'r');
  await git(['add', 'remote.txt'], other);
  await git(['commit', '-m', 'remote tip'], other);
  await git(['push'], other);
  await git(['fetch'], root);
  board = await loadBoard(root);
  assert.ok(board.lanes[0].behind >= 1);
  board = await ops.pullLane(root, 0);
  assert.equal(board.lanes[0].behind, 0);
  fs.rmSync(other, { recursive: true, force: true });
});

test('stash and pop uncommitted', async () => {
  const { root } = await fixture();
  fs.writeFileSync(path.join(root, 'stashed.txt'), 'hold');
  let board = await loadBoard(root);
  assert.equal(board.lanes[0].dirty, 1);
  board = await ops.stashLane(root, 0);
  assert.equal(board.lanes[0].dirty, 0);
  assert.ok(board.stashCount >= 1);
  board = await ops.stashPopLane(root, 0);
  assert.equal(board.lanes[0].dirty, 1);
});

function writeManifest(root, yaml) {
  const dir = path.join(root, '.overlook');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lane.yaml'), yaml);
}

test('createLane copies env and runs setup', async () => {
  const { root } = await fixture();
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  writeManifest(
    root,
    [
      'version: 1',
      'setup: node -e "require(\'fs\').writeFileSync(\'setup.ok\',\'1\')"',
      'env:',
      '  copy:',
      '    - .env',
      '',
    ].join('\n'),
  );
  const board = await ops.createLane(root, { name: 'env', branch: 'feat/env' });
  const lane = board.lanes.find((l) => l.name === 'feat/env');
  assert.ok(lane);
  assert.equal(fs.readFileSync(path.join(lane.path, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal(fs.readFileSync(path.join(lane.path, 'setup.ok'), 'utf8'), '1');
  assert.ok(!fs.existsSync(path.join(root, 'setup.ok')));
});

test('createLane throws when env.copy source missing', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    [
      'version: 1',
      'env:',
      '  copy:',
      '    - .env.missing',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    () => ops.createLane(root, { name: 'miss', branch: 'feat/miss' }),
    /env\.copy.*\.env\.missing|missing.*\.env\.missing/i,
  );
});

test('createLane throws setup stderr on non-zero exit', async () => {
  const { root } = await fixture();
  writeManifest(
    root,
    [
      'version: 1',
      'setup: node -e "console.error(\'boom-setup\'); process.exit(2)"',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    () => ops.createLane(root, { name: 'bad', branch: 'feat/bad' }),
    /boom-setup/,
  );
});
