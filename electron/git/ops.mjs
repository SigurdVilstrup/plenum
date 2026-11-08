import path from 'node:path';
import fs from 'node:fs';
import { git } from './run.mjs';
import { loadBoard } from './board.mjs';

function assertLane(board, laneIndex) {
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  if (lane.isPrimary) throw new Error('Overlook does not write in the protected checkout. Move this to a lane first.');
  return lane;
}

function assertFeatureName(name) {
  const feature = (name || '').trim().replace(/\s+/g, '-');
  if (!feature) throw new Error('Feature name required.');
  if (/[\/\\]/.test(feature) || feature.includes('..') || feature.startsWith('-')) {
    throw new Error('Feature name cannot contain path separators or "..".');
  }
  return feature;
}

export async function createLane(root, { name, branch }) {
  const board = await loadBoard(root);
  const primary = board.lanes[0];
  const feature = assertFeatureName(name);
  const branchName = (branch || `feat/${feature}`).trim();
  if (!branchName || branchName.startsWith('-') || branchName.includes('..')) {
    throw new Error('Invalid branch name.');
  }
  const folder = path.join(primary.path, '.worktrees', feature);
  if (!folder.startsWith(path.join(primary.path, '.worktrees') + path.sep)) {
    throw new Error('Invalid lane folder.');
  }
  if (fs.existsSync(folder)) throw new Error(`Folder already exists: ${folder}`);
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  const exclude = path.join(primary.path, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const stamp = '.worktrees/';
  const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes(stamp)) {
    fs.writeFileSync(exclude, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${stamp}\n`);
  }
  const base = board.teamRef;
  await git(['worktree', 'add', '-b', branchName, folder, base], primary.path);
  return loadBoard(root);
}

export async function removeLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  if (lane.isPrimary) throw new Error('Cannot remove the protected checkout.');
  if (lane.readiness !== 'safe') {
    const reasons = [];
    if (lane.dirty) reasons.push(`${lane.dirty} uncommitted file(s)`);
    if (lane.readiness === 'unmerged' || lane.readiness === 'working') reasons.push('branch not safely merged into the team branch');
    throw new Error(`Not safe to remove: ${reasons.join('; ') || 'lane is not marked safe'}.`);
  }
  await git(['worktree', 'remove', lane.path], board.root);
  return loadBoard(root);
}

function laneOrPrimary(board, laneIndex) {
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  return lane;
}

export async function commitLane(root, laneIndex, message) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  const status = await conflictStatusAt(lane.path);
  if (status.operation) throw new Error(`Cannot commit while ${status.operation} is in progress. Resolve conflicts first.`);
  const msg = (message || '').trim();
  if (!msg) throw new Error('Commit message required.');
  await git(['add', '-A'], lane.path);
  await git(['commit', '-m', msg], lane.path);
  return loadBoard(root);
}

/** Primary uses a normal push; lanes may force-with-lease after rebase. */
export async function pushLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  if (lane.isPrimary) {
    await git(['push', '-u', 'origin', 'HEAD'], lane.path).catch(async (e) => {
      await git(['push'], lane.path).catch(() => { throw e; });
    });
    return loadBoard(root);
  }
  try {
    await git(['push', '--force-with-lease', '-u', 'origin', 'HEAD'], lane.path);
  } catch (e) {
    await git(['push', '--force-with-lease'], lane.path).catch(() => { throw e; });
  }
  return loadBoard(root);
}

export async function pullLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  try {
    await git(['pull', '--ff-only'], lane.path);
  } catch (e) {
    if (lane.isPrimary) {
      throw new Error(`${e.message}\nPrimary only fast-forwards. Resolve divergence outside Overlook.`);
    }
    throw new Error(`${e.message}\nTry Rebase on main instead.`);
  }
  return loadBoard(root);
}

export async function rebaseLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = assertLane(board, laneIndex);
  try {
    await git(['rebase', board.teamRef], lane.path);
  } catch (e) {
    const conflicts = await listConflicts(lane.path);
    if (conflicts.length) {
      const err = new Error('Rebase paused on conflicts.');
      err.code = 'CONFLICT';
      err.conflicts = conflicts;
      err.operation = 'rebase';
      err.conflictRoot = lane.path;
      throw err;
    }
    throw e;
  }
  return loadBoard(root);
}

export async function mergeLaneIntoMain(root, laneIndex, { mode = 'merge' } = {}) {
  const board = await loadBoard(root);
  const lane = assertLane(board, laneIndex);
  const primary = board.lanes[0];
  if (primary.dirty) throw new Error('Primary checkout has uncommitted work. Clean it before merging into main.');
  if (!primary.onTeamBranch) throw new Error(`Primary must be on ${board.teamBranch} before merging.`);
  if (lane.dirty) throw new Error('Lane has uncommitted work.');
  const args = mode === 'ff'
    ? ['merge', '--ff-only', lane.branch]
    : ['merge', '--no-ff', '-m', `Merge branch '${lane.branch}'`, lane.branch];
  try {
    await git(args, primary.path);
  } catch (e) {
    const conflicts = await listConflicts(primary.path);
    if (conflicts.length) {
      const err = new Error('Merge paused on conflicts in the primary checkout.');
      err.code = 'CONFLICT';
      err.conflicts = conflicts;
      err.operation = 'merge';
      err.conflictRoot = primary.path;
      throw err;
    }
    throw e;
  }
  return loadBoard(root);
}

export async function listConflicts(cwd) {
  try {
    const raw = await git(['diff', '--name-only', '--diff-filter=U'], cwd);
    return raw.split(/\n/).filter(Boolean);
  } catch {
    return [];
  }
}

async function detectOperation(cwd) {
  try {
    const gitDir = (await git(['rev-parse', '--git-dir'], cwd)).trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir);
    if (fs.existsSync(path.join(abs, 'rebase-merge')) || fs.existsSync(path.join(abs, 'rebase-apply'))) {
      return 'rebase';
    }
    if (fs.existsSync(path.join(abs, 'MERGE_HEAD'))) return 'merge';
  } catch { /* ignore */ }
  return null;
}

export async function conflictStatusAt(cwd) {
  const conflicts = await listConflicts(cwd);
  const operation = await detectOperation(cwd);
  return { path: cwd, conflicts, operation };
}

export async function conflictStatus(root, laneIndex, conflictRoot) {
  if (conflictRoot) return conflictStatusAt(path.resolve(conflictRoot));
  const board = await loadBoard(root);
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  // Prefer a path that actually has an in-progress operation.
  for (const candidate of [lane.path, board.lanes[0].path]) {
    const status = await conflictStatusAt(candidate);
    if (status.operation || status.conflicts.length) return status;
  }
  return conflictStatusAt(lane.path);
}

export async function conflictStage(root, laneIndex, file, conflictRoot) {
  const status = await conflictStatus(root, laneIndex, conflictRoot);
  await git(['add', '--', file], status.path);
  return conflictStatusAt(status.path);
}

export async function conflictContinue(root, laneIndex, conflictRoot) {
  const status = await conflictStatus(root, laneIndex, conflictRoot);
  if (status.conflicts.length) throw new Error('Resolve and stage every conflicted file first.');
  try {
    if (status.operation === 'rebase') {
      await git(['-c', 'core.editor=true', 'rebase', '--continue'], status.path);
    } else if (status.operation === 'merge') {
      await git(['-c', 'core.editor=true', 'commit', '--no-edit'], status.path);
    } else {
      throw new Error('No rebase or merge in progress.');
    }
  } catch (e) {
    const again = await conflictStatusAt(status.path);
    if (again.conflicts.length || again.operation) {
      return { conflict: true, conflicts: again.conflicts, operation: again.operation, conflictRoot: status.path, path: status.path };
    }
    throw e;
  }
  return loadBoard(root);
}

export async function conflictAbort(root, laneIndex, conflictRoot) {
  const status = await conflictStatus(root, laneIndex, conflictRoot);
  if (status.operation === 'rebase') await git(['rebase', '--abort'], status.path);
  else if (status.operation === 'merge') await git(['merge', '--abort'], status.path);
  else throw new Error('No rebase or merge in progress.');
  return loadBoard(root);
}
