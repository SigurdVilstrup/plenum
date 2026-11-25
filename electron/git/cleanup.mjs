/**
 * Cleanup planner — classify board tips into Safe / Needs confirm / Blocked.
 * Pure over board JSON; renderer applies via existing lane.remove / branch.delete.
 */

function laneKind(lane) {
  if (lane?.isPrimary) return 'protected';
  return lane?.prepared === false ? 'worktree' : 'lane';
}

function laneLabel(lane) {
  if (!lane) return '';
  if (lane.folder) return lane.folder;
  if (lane.name && lane.name !== '(detached)') return lane.name;
  return lane.branch || lane.path || '';
}

function laneBlockedReason(lane, teamBranch) {
  if (lane.isPrimary) return 'Protected checkout';
  if (lane.branch && lane.branch === teamBranch && lane.onTeamBranch) {
    return `Team tip (${teamBranch})`;
  }
  return null;
}

function laneConfirmReason(lane, teamBranch) {
  const bits = [];
  if (lane.dirty > 0) {
    bits.push(`${lane.dirty} uncommitted file${lane.dirty === 1 ? '' : 's'}`);
  }
  if (lane.readiness === 'unmerged') {
    bits.push(`not merged into ${teamBranch || 'team'}`);
  } else if (lane.readiness === 'working' && !lane.dirty) {
    bits.push('working tree not clean');
  }
  if (lane.running) bits.push('running');
  if (lane.ahead > 0) {
    bits.push(`${lane.ahead} ahead of ${teamBranch || 'team'}`);
  }
  if (!bits.length) bits.push('needs confirmation');
  return bits.join(' · ');
}

function branchBlockedReason(br, board) {
  if (br.isTeam || br.name === board.teamBranch) return `Team branch (${board.teamBranch})`;
  if (br.isPrimary) return 'Protected tip';
  if (br.hasLane && br.laneIndex === 0) return 'Checked out in Protected';
  if (br.hasLane) {
    const holder = (board.lanes || []).find((l) => l.index === br.laneIndex);
    const where = holder?.isPrimary ? 'Protected' : (holder?.name || holder?.folder || `lane ${br.laneIndex}`);
    return `Checked out in ${where}`;
  }
  return null;
}

/**
 * @param {object} board
 * @returns {{ safe: object[], confirm: object[], blocked: object[] }}
 */
export function planCleanup(board) {
  const safe = [];
  const confirm = [];
  const blocked = [];
  if (!board) return { safe, confirm, blocked };

  const team = board.teamBranch || 'main';

  for (const lane of board.lanes || []) {
    const kind = laneKind(lane);
    const id = `wt:${lane.path}`;
    const base = {
      id,
      kind,
      path: lane.path,
      branch: lane.branch || null,
      laneIndex: lane.index,
      label: laneLabel(lane),
      readiness: lane.readiness,
      dirty: lane.dirty || 0,
      ahead: lane.ahead || 0,
      behind: lane.behind || 0,
      running: Boolean(lane.running),
      prepared: lane.prepared !== false,
    };

    const blockedReason = laneBlockedReason(lane, team);
    if (blockedReason) {
      blocked.push({ ...base, tier: 'blocked', reason: blockedReason });
      continue;
    }

    if (lane.readiness === 'safe') {
      safe.push({ ...base, tier: 'safe', reason: `Safe to remove · merged into ${team}` });
    } else {
      confirm.push({
        ...base,
        tier: 'confirm',
        reason: laneConfirmReason(lane, team),
      });
    }
  }

  for (const br of board.branches || []) {
    if (br.remote) continue; // remote delete out of v1

    const id = `br:${br.name}`;
    const base = {
      id,
      kind: 'branch',
      path: null,
      branch: br.name,
      laneIndex: br.laneIndex,
      label: br.name,
      readiness: null,
      dirty: 0,
      ahead: br.ahead || 0,
      behind: br.behind || 0,
      running: false,
      prepared: false,
      hasLane: Boolean(br.hasLane),
    };

    const blockedReason = branchBlockedReason(br, board);
    if (blockedReason) {
      // Always list team / protected tips. Skip other checked-out branches —
      // the lane/worktree row already explains them.
      if (br.isTeam || br.name === board.teamBranch || br.isPrimary || (br.hasLane && br.laneIndex === 0)) {
        blocked.push({ ...base, tier: 'blocked', reason: blockedReason });
      } else if (!br.hasLane) {
        blocked.push({ ...base, tier: 'blocked', reason: blockedReason });
      }
      continue;
    }

    if (br.hasLane) {
      // Selectable remove is the worktree row, not a separate branch delete.
      continue;
    }

    // Orphan local tip (no worktree).
    if (br.ahead === 0) {
      safe.push({
        ...base,
        tier: 'safe',
        reason: `Local tip · 0 ahead of ${team}`,
      });
    } else {
      confirm.push({
        ...base,
        tier: 'confirm',
        reason: `${br.ahead} ahead of ${team} · force delete`,
      });
    }
  }

  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label));
  safe.sort(byLabel);
  confirm.sort(byLabel);
  blocked.sort(byLabel);
  return { safe, confirm, blocked };
}

/**
 * Resolve a candidate against a fresh board (indexes shift after remove).
 * @param {object} board
 * @param {{ id: string, kind: string, path?: string|null, branch?: string|null }} candidate
 */
export function resolveCleanupCandidate(board, candidate) {
  if (!board || !candidate) return null;
  if (candidate.kind === 'lane' || candidate.kind === 'worktree') {
    const path = candidate.path;
    if (!path) return null;
    const lane = (board.lanes || []).find((l) => l.path === path);
    if (!lane || lane.isPrimary) return null;
    return {
      ...candidate,
      laneIndex: lane.index,
      branch: lane.branch || candidate.branch,
      readiness: lane.readiness,
      dirty: lane.dirty || 0,
      running: Boolean(lane.running),
      label: laneLabel(lane) || candidate.label,
    };
  }
  if (candidate.kind === 'branch') {
    const name = candidate.branch;
    if (!name) return null;
    const br = (board.branches || []).find((b) => !b.remote && b.name === name);
    if (!br) return null;
    if (br.hasLane) return null; // still checked out — cannot delete yet
    return {
      ...candidate,
      laneIndex: null,
      ahead: br.ahead || 0,
      behind: br.behind || 0,
      hasLane: false,
    };
  }
  return null;
}

/**
 * Ordered apply steps for selected candidates.
 * Worktree/lane removes first; optional branch delete after each remove;
 * standalone branch deletes last.
 *
 * @param {object[]} selected
 * @param {{ deleteBranchAfter?: boolean }} [opts]
 * @returns {{ type: 'remove'|'deleteBranch', candidateId: string, path?: string, branch?: string, force?: boolean }[]}
 */
export function orderCleanupActions(selected, { deleteBranchAfter = false } = {}) {
  const removes = [];
  const branchDeletes = [];
  const seenBranch = new Set();

  for (const c of selected || []) {
    if (c.kind === 'lane' || c.kind === 'worktree') {
      removes.push({
        type: 'remove',
        candidateId: c.id,
        path: c.path,
        branch: c.branch || null,
        force: c.tier !== 'safe' && c.readiness !== 'safe',
      });
      if (deleteBranchAfter && c.branch && !seenBranch.has(c.branch)) {
        seenBranch.add(c.branch);
        removes.push({
          type: 'deleteBranch',
          candidateId: c.id,
          branch: c.branch,
          force: c.tier !== 'safe' || (c.ahead || 0) > 0,
          afterRemove: true,
        });
      }
    } else if (c.kind === 'branch' && c.branch && !seenBranch.has(c.branch)) {
      seenBranch.add(c.branch);
      branchDeletes.push({
        type: 'deleteBranch',
        candidateId: c.id,
        branch: c.branch,
        force: c.tier !== 'safe' || (c.ahead || 0) > 0,
        afterRemove: false,
      });
    }
  }
  return [...removes, ...branchDeletes];
}
