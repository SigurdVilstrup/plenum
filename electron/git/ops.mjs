import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { git, gitOk } from './run.mjs';
import { loadBoard } from './board.mjs';
import { loadManifest, resolvePorts, renderTemplate } from '../lane/manifest.mjs';
import { down, getProc } from '../lane/supervisor.mjs';

function assertLane(board, laneIndex) {
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  if (lane.isPrimary) throw new Error('Plenum does not write in the protected checkout. Move this to a lane first.');
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

/** `lanesFolder`: relative to the primary checkout, or absolute. */
export async function createLane(root, { name, branch, lanesFolder, existing = false }) {
  const board = await loadBoard(root);
  const primary = board.lanes[0];
  let branchName = (branch || '').trim();
  let feature;
  if (existing) {
    if (!branchName) throw new Error('Branch required.');
    // origin/foo → ensure local foo tracks it, then use foo
    if (branchName.startsWith('origin/')) {
      const local = branchName.slice('origin/'.length);
      if (!local) throw new Error('Invalid branch name.');
      if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], primary.path))) {
        await git(['branch', '--track', local, branchName], primary.path);
      }
      branchName = local;
    }
    if (branchName.startsWith('-') || branchName.includes('..')) throw new Error('Invalid branch name.');
    if (board.lanes.some((l) => l.branch === branchName)) {
      throw new Error(`Branch ${branchName} already has a lane.`);
    }
    if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], primary.path))) {
      throw new Error(`Branch ${branchName} not found.`);
    }
    feature = assertFeatureName(name || branchName.split('/').pop());
  } else {
    feature = assertFeatureName(name);
    branchName = (branchName || `feat/${feature}`).trim();
    if (!branchName || branchName.startsWith('-') || branchName.includes('..')) {
      throw new Error('Invalid branch name.');
    }
  }
  const lanesDir = path.resolve(primary.path, String(lanesFolder || '').trim() || '.worktrees');
  if (lanesDir === path.resolve(primary.path)) throw new Error('Lanes folder cannot be the checkout itself.');
  const folder = path.join(lanesDir, feature);
  if (!folder.startsWith(lanesDir + path.sep)) throw new Error('Invalid lane folder.');
  if (fs.existsSync(folder)) throw new Error(`Folder already exists: ${folder}`);
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  const exclude = path.join(primary.path, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const rel = path.relative(primary.path, lanesDir);
  const stamp = `${rel}/`;
  const excludeText = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  // Only a folder inside the checkout needs hiding from `git status`.
  if (!rel.startsWith('..') && !path.isAbsolute(rel) && !excludeText.split(/\r?\n/).includes(stamp)) {
    fs.writeFileSync(exclude, `${excludeText}${excludeText && !excludeText.endsWith('\n') ? '\n' : ''}${stamp}\n`);
  }
  const base = board.teamRef;
  if (existing) {
    await git(['worktree', 'add', folder, branchName], primary.path);
  } else {
    await git(['worktree', 'add', '-b', branchName, folder, base], primary.path);
  }

  try {
    const manifest = await loadManifest(path.join(primary.path, '.overlook', 'lane.yaml'));
    if (manifest) {
      for (const rel of manifest.env.copy) {
        const src = resolveContained(primary.path, rel, 'primary');
        const dest = resolveContained(folder, rel, 'lane');
        if (!fs.existsSync(src)) throw new Error(`env.copy source missing: ${rel}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      if (manifest.setup) {
        const after = await loadBoard(root);
        const lane = after.lanes.find((l) => path.resolve(l.path) === path.resolve(folder));
        const laneIndex = lane?.index ?? after.lanes.length - 1;
        const ports = resolvePorts(manifest, laneIndex);
        const offset = (manifest.ports?.offset ?? 0) * laneIndex;
        const ctx = { offset, lane: laneIndex, port: ports, ports };
        const env = {
          ...process.env,
          OVERLOOK_LANE: String(laneIndex),
          OVERLOOK_OFFSET: String(offset),
        };
        for (const [k, v] of Object.entries(manifest.env.set ?? {})) {
          env[k] = renderTemplate(String(v), ctx);
        }
        await runSetup(renderTemplate(String(manifest.setup), ctx), folder, env);
      }
    }
  } catch (err) {
    await git(['worktree', 'remove', '--force', folder], primary.path).catch(() => {});
    if (!existing) await git(['branch', '-D', branchName], primary.path).catch(() => {});
    throw err;
  }
  return loadBoard(root);
}

/** Resolve `rel` under `base`; reject absolute paths and `..` escapes. */
function resolveContained(base, rel, label) {
  if (path.isAbsolute(rel)) throw new Error(`env.copy path escapes ${label}: ${rel}`);
  const root = path.resolve(base);
  const resolved = path.resolve(base, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`env.copy path escapes ${label}: ${rel}`);
  }
  return resolved;
}

function runSetup(command, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`setup failed (exit ${code}): ${stderr.trim() || '(no stderr)'}`));
    });
  });
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
  // Auto-down if still running so worktree remove doesn't orphan processes/registry.
  if (getProc(board.root, laneIndex)?.running) {
    await down(board.root, laneIndex).catch(() => {});
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
  const ref = lane.isPrimary ? board.teamBranch : lane.branch;
  if (!ref) throw new Error('Cannot pull a detached HEAD.');
  try {
    // Pass origin + ref explicitly. Bare `git pull --ff-only` depends on
    // upstream tracking and can no-op while origin/<team> is still ahead.
    await git(['pull', '--ff-only', 'origin', ref], lane.path);
  } catch (e) {
    if (lane.isPrimary) {
      throw new Error(`${e.message}\nPrimary only fast-forwards. Resolve divergence outside Plenum.`);
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

export async function stashLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  if (!lane.dirty) throw new Error('Nothing to stash.');
  await git(['stash', 'push', '-u', '-m', `overlook: ${lane.name}`], lane.path);
  return loadBoard(root);
}

export async function stashPopLane(root, laneIndex, ref = 'stash@{0}') {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  if (!board.stashCount) throw new Error('No stash to pop.');
  const target = String(ref || 'stash@{0}').trim();
  if (!/^stash@\{\d+\}$/.test(target)) throw new Error('Invalid stash ref.');
  await git(['stash', 'pop', target], lane.path);
  return loadBoard(root);
}

export async function stashShow(root, ref = 'stash@{0}') {
  const board = await loadBoard(root);
  const cwd = board.lanes[0]?.path || root;
  const target = String(ref || 'stash@{0}').trim();
  if (!/^stash@\{\d+\}$/.test(target)) throw new Error('Invalid stash ref.');
  let nameStatus = '';
  try { nameStatus = await git(['stash', 'show', '--name-status', '--include-untracked', target], cwd); } catch { /* empty */ }
  const files = nameStatus.split(/\n/).filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    if (tab < 0) return null;
    return { code: line.slice(0, tab), path: line.slice(tab + 1) };
  }).filter(Boolean);
  return { ref: target, files };
}
