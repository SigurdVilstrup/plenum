import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { git, gitOk } from './run.mjs';
import { loadBoard } from './board.mjs';

const SHA = /^[0-9a-f]{40}$/;

function sha(v) {
  if (!SHA.test(String(v))) throw new Error('Invalid commit id.');
  return String(v);
}

/** Only snapshots this module wrote (they live under refs/plenum/undo/) may be replayed. */
async function ours(cwd, v) {
  const id = sha(v);
  if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/plenum/undo/${id}`], cwd))) throw new Error('Unknown undo snapshot.');
  return id;
}

/** Lanes removed through lane.remove, keyed by path. The renderer only names the path. */
const removed = new Map();
export function rememberLane(root, lane) {
  removed.set(lane.path, { root, branch: lane.branch, head: lane.head });
}

function relPaths(paths) {
  const list = [...new Set((Array.isArray(paths) ? paths : []).map(String))];
  for (const p of list) {
    if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw new Error(`Invalid path: ${p}`);
  }
  return list;
}

async function laneAt(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  return { board, lane };
}

/**
 * Commit the lane's working tree (tracked + untracked, optionally only `paths`) onto a
 * private ref so destructive ops can be undone. Uses a throwaway index: the real index
 * and worktree are untouched. Refs live under refs/plenum/undo/ and keep the objects from gc.
 */
export async function snapshotLane(root, laneIndex, paths) {
  const { lane } = await laneAt(root, laneIndex);
  const only = paths?.length ? relPaths(paths) : [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-undo-'));
  const env = {
    GIT_INDEX_FILE: path.join(dir, 'index'),
    GIT_AUTHOR_NAME: 'Plenum', GIT_AUTHOR_EMAIL: 'undo@plenum.local',
    GIT_COMMITTER_NAME: 'Plenum', GIT_COMMITTER_EMAIL: 'undo@plenum.local',
  };
  try {
    await git(['read-tree', 'HEAD'], lane.path, env);
    await git(['add', '-A', ...(only.length ? ['--', ...only] : [])], lane.path, env);
    const tree = (await git(['write-tree'], lane.path, env)).trim();
    const snap = (await git(['commit-tree', tree, '-p', 'HEAD', '-m', 'plenum undo snapshot'], lane.path, env)).trim();
    await git(['update-ref', `refs/plenum/undo/${snap}`, snap], lane.path);
    return { sha: snap, head: lane.head, branch: lane.branch, path: lane.path };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Put `paths` back the way the snapshot had them. Refuses if they changed since the revert. */
export async function restorePaths(root, laneIndex, { sha: snap, paths }) {
  const { lane } = await laneAt(root, laneIndex);
  const list = relPaths(paths);
  await ours(lane.path, snap);
  if (!list.length) throw new Error('Nothing to restore.');
  if ((await git(['status', '--porcelain', '--', ...list], lane.path)).trim()) {
    throw new Error('Those files changed since the revert — not restored.');
  }
  const present = [];
  const gone = [];
  for (const p of list) (await gitOk(['cat-file', '-e', `${snap}:${p}`], lane.path) ? present : gone).push(p);
  if (present.length) {
    await git(['checkout', snap, '--', ...present], lane.path);
    await git(['reset', '-q', '--', ...present], lane.path);
  }
  const top = fs.realpathSync(lane.path);
  for (const p of gone) {
    const target = path.join(lane.path, p);
    // Never follow a symlinked directory out of the lane.
    const parent = fs.existsSync(path.dirname(target)) ? fs.realpathSync(path.dirname(target)) : null;
    if (parent && (parent === top || parent.startsWith(top + path.sep))) fs.rmSync(target, { force: true });
  }
  return loadBoard(root);
}

/**
 * Re-add a removed worktree on its branch (or detached head) and replay the snapshot
 * of its uncommitted files. Ignored files (node_modules, .env) are not recreated.
 */
export async function restoreLane(root, { path: lanePath, sha: snap }) {
  const board = await loadBoard(root);
  const primary = board.lanes[0].path;
  const rec = removed.get(lanePath);
  if (!rec || rec.root !== root) throw new Error('Nothing to restore for that lane.');
  const { branch, head } = rec;
  if (fs.existsSync(lanePath)) throw new Error('Lane folder is already back or taken.');
  sha(head);
  if (snap) await ours(primary, snap);
  await git(['worktree', 'prune'], primary);
  if (branch && (await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], primary))) {
    await git(['worktree', 'add', lanePath, branch], primary);
  } else {
    await git(['worktree', 'add', '--detach', lanePath, head], primary);
  }
  if (snap) {
    await git(['read-tree', '--reset', '-u', snap], lanePath);
    await git(['reset', '-q'], lanePath);
  }
  removed.delete(lanePath);
  return loadBoard(root);
}

/** Undo the commit at the tip: only if it is still the tip and not on any remote. */
export async function uncommit(root, laneIndex, tip) {
  const { lane } = await laneAt(root, laneIndex);
  sha(tip);
  if ((await git(['rev-parse', 'HEAD'], lane.path)).trim() !== tip) throw new Error('The branch has moved since that commit — not undone.');
  if ((await git(['branch', '-r', '--contains', tip], lane.path)).trim()) throw new Error('Already pushed — can’t undo that commit.');
  await git(['reset', '--soft', 'HEAD~1'], lane.path);
  return loadBoard(root);
}

/** Recreate a deleted local branch at its old tip. */
export async function restoreBranch(root, name, tip) {
  const board = await loadBoard(root);
  sha(tip);
  const n = String(name || '').trim();
  if (!n || n.startsWith('-') || !(await gitOk(['check-ref-format', '--branch', n], board.lanes[0].path))) throw new Error('Invalid branch name.');
  if (await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${n}`], board.lanes[0].path)) throw new Error(`Branch ${n} exists again.`);
  await git(['branch', n, tip], board.lanes[0].path);
  return loadBoard(root);
}
