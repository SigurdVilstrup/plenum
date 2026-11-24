import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { git, gitOk } from './run.mjs';
import { loadBoard, PREPARED_STAMP } from './board.mjs';
import { loadManifest, resolvePorts, renderTemplate } from '../lane/manifest.mjs';
import { down, getProc } from '../lane/supervisor.mjs';
import { manifestPath } from '../paths.mjs';

function writePreparedStamp(lanePath) {
  const stamp = path.join(lanePath, PREPARED_STAMP);
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, `${new Date().toISOString()}\n`);
}

function assertLane(board, laneIndex) {
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  if (lane.isPrimary) throw new Error('Protected checkout. Open this in a lane first.');
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
    const manifest = await loadManifest(manifestPath(primary.path));
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
          PLENUM_LANE: String(laneIndex),
          PLENUM_OFFSET: String(offset),
        };
        for (const [k, v] of Object.entries(manifest.env.set ?? {})) {
          env[k] = renderTemplate(String(v), ctx);
        }
        await runSetup(renderTemplate(String(manifest.setup), ctx), folder, env);
      }
      writePreparedStamp(folder);
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

export async function removeLane(root, laneIndex, { force = false } = {}) {
  const board = await loadBoard(root);
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  if (lane.isPrimary) throw new Error('Can’t remove the protected checkout.');
  if (lane.readiness !== 'safe' && !force) {
    const reasons = [];
    if (lane.dirty) reasons.push(`${lane.dirty} uncommitted file(s)`);
    if (lane.readiness === 'unmerged') reasons.push('branch not safely merged into the team branch');
    else if (lane.readiness === 'working') reasons.push('working tree is dirty');
    throw new Error(`Not safe to remove: ${reasons.join('; ') || 'lane isn’t marked safe'}. Pass force to remove anyway.`);
  }
  // Auto-down if still running so worktree remove doesn't orphan processes/registry.
  if (getProc(board.root, laneIndex)?.running) {
    await down(board.root, laneIndex).catch(() => {});
  }
  const args = ['worktree', 'remove', lane.path];
  if (force || lane.readiness !== 'safe') args.push('--force');
  await git(args, board.root);
  return loadBoard(root);
}

function laneOrPrimary(board, laneIndex) {
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  return lane;
}

function selectedDirtyPaths(lane, paths) {
  const requested = [...new Set((Array.isArray(paths) ? paths : []).map((p) => String(p || '')))];
  if (!requested.length) return [];
  const dirty = new Set((lane.dirtyFiles || []).map((f) => f.path));
  for (const file of requested) {
    if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || !dirty.has(file)) {
      throw new Error(`File is not a current uncommitted change: ${file || '(empty)'}`);
    }
  }
  return requested;
}

export async function commitLane(root, laneIndex, message, paths) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  const status = await conflictStatusAt(lane.path);
  if (status.operation) throw new Error(`Can’t commit while ${status.operation} is in progress. Resolve conflicts first.`);
  const msg = (message || '').trim();
  if (!msg) throw new Error('Commit message required.');
  const selected = selectedDirtyPaths(lane, paths);
  if (selected.length) {
    await git(['add', '--', ...selected], lane.path);
    await git(['commit', '-m', msg, '--', ...selected], lane.path);
  } else {
    await git(['add', '-A'], lane.path);
    await git(['commit', '-m', msg], lane.path);
  }
  return loadBoard(root);
}

export async function revertLaneChanges(root, laneIndex, paths) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  const selected = selectedDirtyPaths(lane, paths);
  if (!selected.length) throw new Error('Select at least one uncommitted file.');
  const tracked = selected.filter((file) => (lane.dirtyFiles || []).find((f) => f.path === file)?.code !== '??');
  const untracked = selected.filter((file) => (lane.dirtyFiles || []).find((f) => f.path === file)?.code === '??');
  if (tracked.length) await git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked], lane.path);
  if (untracked.length) await git(['clean', '-f', '--', ...untracked], lane.path);
  return loadBoard(root);
}

/**
 * Push the lane tip to origin.
 * Default is a normal fast-forward push for every lane.
 * Opt into rewrite only via confirm sheet: `{ force: 'lease'|'force' }` or `{ forceWithLease: true }`.
 * Primary never force-pushes.
 */
export async function pushLane(root, laneIndex, opts = {}) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  const forceOpt = opts.forceWithLease === true ? 'lease' : opts?.force;
  const mode = normalizeForcePush(forceOpt);
  if (mode && lane.isPrimary) throw new Error('Protected primary never force-pushes.');
  // Never default feature lanes to lease — Push must stay a plain git push.
  const flags = forcePushFlags(mode, { defaultLease: false });
  try {
    await git(['push', ...flags, '-u', 'origin', 'HEAD'], lane.path);
  } catch (e) {
    try {
      await git(['push', ...flags], lane.path);
    } catch {
      throw annotatePushReject(e, lane.branch || 'HEAD');
    }
  }
  return loadBoard(root);
}

export async function pullLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = laneOrPrimary(board, laneIndex);
  const ref = lane.isPrimary ? board.teamBranch : lane.branch;
  if (!ref) throw new Error('Can’t pull a detached HEAD.');
  if (lane.dirty > 0) {
    throw new Error(
      `Can’t pull: ${lane.dirty} uncommitted change${lane.dirty === 1 ? '' : 's'} would be overwritten. Commit or stash first.`,
    );
  }
  try {
    // Pass origin + ref explicitly. Bare `git pull --ff-only` depends on
    // upstream tracking and can no-op while origin/<team> is still ahead.
    await git(['pull', '--ff-only', 'origin', ref], lane.path);
  } catch (e) {
    const msg = e?.message || String(e);
    if (/would be overwritten|local changes/i.test(msg)) {
      throw new Error('Can’t pull: uncommitted changes would be overwritten. Commit or stash first.');
    }
    if (lane.isPrimary) {
      throw new Error(`${msg}\nPrimary only fast-forwards. Fix the divergence outside Plenum.`);
    }
    throw new Error(`${msg}\nTry Rebase onto main instead.`);
  }
  return loadBoard(root);
}

export async function rebaseLane(root, laneIndex, onto) {
  const board = await loadBoard(root);
  const lane = assertLane(board, laneIndex);
  const target = String(onto || '').trim() || board.teamRef;
  if (target.startsWith('-') || target.includes('..')) throw new Error('Invalid rebase target.');
  try {
    await git(['rebase', target], lane.path);
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

function assertBranchName(name, label = 'Branch') {
  const n = String(name || '').trim();
  if (!n) throw new Error(`${label} required.`);
  if (n.startsWith('-') || n.includes('..') || /\s/.test(n)) throw new Error(`Invalid ${label.lower()} name.`);
  return n;
}

/** Ensure local tracking branch exists for origin/foo; return local short name. */
async function ensureLocalBranch(cwd, branch) {
  let name = assertBranchName(branch);
  if (name.startsWith('origin/')) {
    const local = name.slice('origin/'.length);
    if (!local) throw new Error('Invalid branch name.');
    if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], cwd))) {
      if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/remotes/${name}`], cwd))) {
        throw new Error(`Remote branch ${name} not found.`);
      }
      await git(['branch', '--track', local, name], cwd);
    }
    return local;
  }
  if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], cwd))) {
    if (await gitOk(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`], cwd)) {
      await git(['branch', '--track', name, `origin/${name}`], cwd);
      return name;
    }
    throw new Error(`Branch ${name} not found.`);
  }
  return name;
}

/**
 * Fast-forward a local branch tip from origin without checking it out (#40).
 * Remote-only names (`origin/foo`) just refresh the remote-tracking tip via fetch.
 */
export async function updateBranchFromRemote(root, { branch } = {}) {
  const board = await loadBoard(root);
  let name = assertBranchName(branch);
  if (name.startsWith('origin/')) {
    const short = name.slice('origin/'.length);
    if (!short) throw new Error('Invalid branch name.');
    await git(['fetch', 'origin', short], board.root);
    return loadBoard(root);
  }
  const holder = board.lanes.find((l) => l.branch === name);
  if (holder) {
    throw new Error(`${name} is checked out in ${holder.isPrimary ? 'primary' : `lane ${holder.name}`}. Pull there instead.`);
  }
  if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], board.root))) {
    throw new Error(`Local branch ${name} not found.`);
  }
  if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`], board.root))) {
    throw new Error(`No origin/${name}. Fetch or set upstream first.`);
  }
  // `src:dst` without + is fast-forward only - refuses diverge.
  try {
    await git(['fetch', 'origin', `${name}:${name}`], board.root);
  } catch (e) {
    const msg = e?.message || String(e);
    if (/non-fast-forward|rejected|failed to update/i.test(msg)) {
      throw new Error(`${name} has diverged from origin/${name}. Check it out and pull or rebase.`);
    }
    throw e;
  }
  return loadBoard(root);
}

/** Push a local tip to origin (no checkout required). Sets upstream on first push. */
export async function pushBranchToRemote(root, { branch, force } = {}) {
  const board = await loadBoard(root);
  const name = assertBranchName(branch);
  if (name.startsWith('origin/')) throw new Error('That tip is already on origin. Nothing to push.');
  if (!(await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], board.root))) {
    throw new Error(`Local branch ${name} not found.`);
  }
  const mode = normalizeForcePush(force);
  const flags = forcePushFlags(mode, { defaultLease: false });
  try {
    await git(['push', ...flags, '-u', 'origin', name], board.root);
  } catch (e) {
    throw annotatePushReject(e, name);
  }
  return loadBoard(root);
}

function normalizeForcePush(force) {
  if (force === true || force === 'force') return 'force';
  if (force === 'lease') return 'lease';
  return null;
}

function forcePushFlags(mode, { defaultLease = false } = {}) {
  if (mode === 'force') return ['--force'];
  if (mode === 'lease' || (!mode && defaultLease)) return ['--force-with-lease'];
  return [];
}

function annotatePushReject(err, name) {
  const msg = err?.message || String(err);
  if (/non-fast-forward|rejected|stale info|failed to push|fetch first/i.test(msg)) {
    const e = new Error(
      `${name} was rejected by origin (non-fast-forward). Pull or rebase, or use Force push…`,
    );
    e.code = 'PUSH_REJECTED';
    e.cause = err;
    return e;
  }
  return err;
}

/** Check out a branch in the chosen worktree (lane or primary). Open as lane is separate.
 * Dirty trees auto-stash then pop so a switch never dead-ends on uncommitted work (#136). */
export async function checkoutBranch(root, { branch, laneIndex = 0 } = {}) {
  const board = await loadBoard(root);
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  const local = await ensureLocalBranch(board.root, branch);
  const holder = board.lanes.find((l) => l.branch === local);
  if (holder && holder.index !== lane.index) {
    throw new Error(`${local} is already checked out in ${holder.isPrimary ? 'primary' : `lane ${holder.name}`}. Select that worktree.`);
  }
  if (lane.branch === local) return board;
  let stashed = false;
  if (lane.dirty) {
    await git(['stash', 'push', '-u', '-m', `plenum: switch ${lane.branch} → ${local}`], lane.path);
    stashed = true;
  }
  await git(['checkout', local], lane.path);
  if (stashed) {
    try {
      await git(['stash', 'pop', 'stash@{0}'], lane.path);
    } catch {
      // Checkout already landed. Leave the stash entry for Pop stash / conflict walk.
    }
  }
  return loadBoard(root);
}

export async function renameBranch(root, from, to) {
  const board = await loadBoard(root);
  const src = assertBranchName(from, 'Current branch');
  const dest = assertBranchName(to, 'New branch');
  if (src === board.teamBranch) throw new Error(`Cannot rename team branch ${board.teamBranch}.`);
  if (src === dest) return board;
  if (await gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${dest}`], board.root)) {
    throw new Error(`Branch ${dest} already exists.`);
  }
  // Rename works from any worktree; prefer primary path.
  await git(['branch', '-m', src, dest], board.root);
  return loadBoard(root);
}

export async function deleteBranch(root, name, { force = false, remote = false } = {}) {
  const board = await loadBoard(root);
  let ref = assertBranchName(name);
  if (remote || ref.startsWith('origin/')) {
    const short = ref.startsWith('origin/') ? ref.slice(7) : ref;
    if (short === board.teamBranch) throw new Error(`Cannot delete remote team branch ${short}.`);
    await git(['push', 'origin', '--delete', short], board.root);
    return loadBoard(root);
  }
  if (ref === board.teamBranch) throw new Error(`Cannot delete team branch ${ref}.`);
  const holder = board.lanes.find((l) => l.branch === ref);
  if (holder) throw new Error(`Branch ${ref} is checked out in ${holder.isPrimary ? 'primary' : `lane ${holder.name}`}.`);
  await git(['branch', force ? '-D' : '-d', ref], board.root);
  return loadBoard(root);
}

export async function mergeLaneIntoMain(root, laneIndex, { mode = 'merge', into } = {}) {
  const board = await loadBoard(root);
  const lane = assertLane(board, laneIndex);
  const targetName = String(into || '').trim() || board.teamBranch;
  let target = board.lanes.find((l) => l.branch === targetName || l.name === targetName);
  // Default Finish/merge into Protected’s checkout when the tip isn’t open elsewhere.
  if (!target && targetName === board.teamBranch) target = board.lanes[0];
  if (!target) {
    throw new Error(`No worktree checked out for ${targetName}. Open that branch first.`);
  }
  if (target.index === lane.index) throw new Error('Cannot merge a lane into itself.');
  if (target.dirty) throw new Error(`${targetName} has uncommitted work. Clean it before merging.`);
  if (lane.dirty) throw new Error('Lane has uncommitted work.');
  if (target.isPrimary && targetName === board.teamBranch && !target.onTeamBranch) {
    throw new Error(`Primary must be on ${board.teamBranch} before merging.`);
  }
  const args = mode === 'ff'
    ? ['merge', '--ff-only', lane.branch]
    : ['merge', '--no-ff', '-m', `Merge branch '${lane.branch}'`, lane.branch];
  try {
    await git(args, target.path);
  } catch (e) {
    const conflicts = await listConflicts(target.path);
    if (conflicts.length) {
      const err = new Error(`Merge paused on conflicts in ${targetName}.`);
      err.code = 'CONFLICT';
      err.conflicts = conflicts;
      err.operation = 'merge';
      err.conflictRoot = target.path;
      throw err;
    }
    throw e;
  }
  return loadBoard(root);
}

/** Merge → stop → remove. `remove: false` keeps the worktree after merge. */
export async function finishLane(root, laneIndex, { mode = 'merge', into, remove = true } = {}) {
  const before = await loadBoard(root);
  const lane = before.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  const branch = lane.branch;
  const lanePath = lane.path;
  let board = await mergeLaneIntoMain(root, laneIndex, { mode, into });
  const still = board.lanes.find((l) => path.resolve(l.path) === path.resolve(lanePath) || l.branch === branch);
  const idx = still?.index ?? laneIndex;
  if (still && getProc(board.root, idx)?.running) {
    await down(board.root, idx).catch(() => {});
  }
  if (remove && still && !still.isPrimary) {
    board = await removeLane(root, still.index, { force: true });
  }
  return board;
}

/** Re-apply env.copy + setup for an existing worktree (Repair / Open as lane). */
export async function repairLane(root, laneIndex) {
  const board = await loadBoard(root);
  const lane = board.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error('Lane not found.');
  const primary = board.lanes[0];
  const manifest = await loadManifest(manifestPath(primary.path));
  if (!manifest) throw new Error('No .plenum/lane.yaml — run Lane setup first.');
  for (const rel of manifest.env.copy) {
    const src = resolveContained(primary.path, rel, 'primary');
    const dest = resolveContained(lane.path, rel, 'lane');
    if (!fs.existsSync(src)) throw new Error(`env.copy source missing: ${rel}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  if (manifest.setup) {
    const ports = resolvePorts(manifest, laneIndex);
    const offset = (manifest.ports?.offset ?? 0) * laneIndex;
    const ctx = { offset, lane: laneIndex, port: ports, ports };
    const env = {
      ...process.env,
      PLENUM_LANE: String(laneIndex),
      PLENUM_OFFSET: String(offset),
    };
    for (const [k, v] of Object.entries(manifest.env.set ?? {})) {
      env[k] = renderTemplate(String(v), ctx);
    }
    await runSetup(renderTemplate(String(manifest.setup), ctx), lane.path, env);
  }
  writePreparedStamp(lane.path);
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
  await git(['stash', 'push', '-u', '-m', `plenum: ${lane.name}`], lane.path);
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
