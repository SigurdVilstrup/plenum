import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCleanup,
  resolveCleanupCandidate,
  orderCleanupActions,
} from './cleanup.mjs';

function board(partial = {}) {
  return {
    root: '/repo',
    teamBranch: 'main',
    teamRef: 'main',
    lanes: [],
    branches: [],
    ...partial,
  };
}

function lane(partial) {
  return {
    index: 1,
    name: 'feat/x',
    path: '/repo/.worktrees/feat-x',
    folder: 'feat-x',
    branch: 'feat/x',
    isPrimary: false,
    ahead: 0,
    behind: 0,
    dirty: 0,
    dirtyFiles: [],
    onTeamBranch: false,
    readiness: 'safe',
    prepared: true,
    running: false,
    ...partial,
  };
}

function br(partial) {
  return {
    name: 'feat/orphan',
    short: 'feat/orphan',
    remote: false,
    head: 'abc',
    hasLane: false,
    laneIndex: null,
    isPrimary: false,
    isTeam: false,
    ahead: 0,
    behind: 0,
    ...partial,
  };
}

test('planCleanup: safe lane and orphan tip default to safe', () => {
  const b = board({
    lanes: [
      lane({ index: 0, name: 'main', path: '/repo', folder: null, branch: 'main', isPrimary: true, readiness: 'protected', onTeamBranch: true }),
      lane({ readiness: 'safe' }),
    ],
    branches: [
      br({ name: 'main', isTeam: true, hasLane: true, laneIndex: 0, isPrimary: true }),
      br({ name: 'feat/x', hasLane: true, laneIndex: 1 }),
      br({ name: 'feat/done', ahead: 0 }),
    ],
  });
  const plan = planCleanup(b);
  assert.equal(plan.safe.length, 2);
  assert.ok(plan.safe.some((c) => c.kind === 'lane' && c.path === '/repo/.worktrees/feat-x'));
  assert.ok(plan.safe.some((c) => c.kind === 'branch' && c.branch === 'feat/done'));
  assert.ok(plan.blocked.some((c) => c.kind === 'protected' || (c.reason || '').includes('Protected')));
  assert.ok(plan.blocked.some((c) => (c.reason || '').includes('Team')));
  assert.equal(plan.confirm.length, 0);
});

test('planCleanup: dirty / unmerged → Needs confirm; protected blocked', () => {
  const b = board({
    lanes: [
      lane({ index: 0, name: 'main', path: '/repo', folder: null, branch: 'main', isPrimary: true, readiness: 'protected' }),
      lane({ index: 1, name: 'feat/dirty', path: '/a', folder: 'dirty', branch: 'feat/dirty', readiness: 'working', dirty: 3 }),
      lane({
        index: 2,
        name: 'feat/open',
        path: '/b',
        folder: 'open',
        branch: 'feat/open',
        readiness: 'unmerged',
        ahead: 2,
        prepared: false,
      }),
    ],
    branches: [
      br({ name: 'main', isTeam: true, hasLane: true, laneIndex: 0, isPrimary: true }),
      br({ name: 'feat/dirty', hasLane: true, laneIndex: 1 }),
      br({ name: 'feat/open', hasLane: true, laneIndex: 2 }),
      br({ name: 'feat/ahead', ahead: 4 }),
    ],
  });
  const plan = planCleanup(b);
  assert.ok(plan.confirm.some((c) => c.kind === 'lane' && c.path === '/a' && /uncommitted/.test(c.reason)));
  assert.ok(plan.confirm.some((c) => c.kind === 'worktree' && c.path === '/b' && /not merged/.test(c.reason)));
  assert.ok(plan.confirm.some((c) => c.kind === 'branch' && c.branch === 'feat/ahead' && /force delete/.test(c.reason)));
  assert.ok(!plan.safe.length);
  assert.ok(plan.blocked.every((c) => c.tier === 'blocked'));
});

test('planCleanup: skips remote tips and duplicate hasLane branches', () => {
  const b = board({
    lanes: [
      lane({ index: 0, isPrimary: true, path: '/repo', folder: null, branch: 'main', readiness: 'protected', name: 'main' }),
      lane({ readiness: 'safe' }),
    ],
    branches: [
      br({ name: 'main', isTeam: true, hasLane: true, laneIndex: 0, isPrimary: true }),
      br({ name: 'feat/x', hasLane: true, laneIndex: 1 }),
      br({ name: 'origin/stale', remote: true, short: 'stale', ahead: 0 }),
    ],
  });
  const plan = planCleanup(b);
  assert.ok(!plan.safe.some((c) => c.branch === 'feat/x' && c.kind === 'branch'));
  assert.ok(!plan.safe.some((c) => String(c.branch || '').startsWith('origin/')));
  assert.ok(!plan.confirm.some((c) => String(c.branch || '').startsWith('origin/')));
});

test('resolveCleanupCandidate: re-finds by path after index shift', () => {
  const before = board({
    lanes: [
      lane({ index: 0, isPrimary: true, path: '/repo', folder: null, branch: 'main', readiness: 'protected', name: 'main' }),
      lane({ index: 1, path: '/a', folder: 'a', branch: 'a', readiness: 'safe' }),
      lane({ index: 2, path: '/b', folder: 'b', branch: 'b', readiness: 'safe' }),
    ],
  });
  const cand = planCleanup(before).safe.find((c) => c.path === '/b');
  assert.equal(cand.laneIndex, 2);

  const after = board({
    lanes: [
      lane({ index: 0, isPrimary: true, path: '/repo', folder: null, branch: 'main', readiness: 'protected', name: 'main' }),
      lane({ index: 1, path: '/b', folder: 'b', branch: 'b', readiness: 'safe' }),
    ],
  });
  const resolved = resolveCleanupCandidate(after, cand);
  assert.ok(resolved);
  assert.equal(resolved.laneIndex, 1);
  assert.equal(resolved.path, '/b');
});

test('resolveCleanupCandidate: branch gone or still hasLane → null', () => {
  const b = board({
    lanes: [lane({ index: 0, isPrimary: true, path: '/repo', folder: null, branch: 'main', readiness: 'protected', name: 'main' })],
    branches: [br({ name: 'feat/gone', ahead: 0 })],
  });
  assert.equal(resolveCleanupCandidate(b, { id: 'br:missing', kind: 'branch', branch: 'missing' }), null);
  assert.ok(resolveCleanupCandidate(b, { id: 'br:feat/gone', kind: 'branch', branch: 'feat/gone' }));

  const withLane = board({
    lanes: [
      lane({ index: 0, isPrimary: true, path: '/repo', folder: null, branch: 'main', readiness: 'protected', name: 'main' }),
      lane({ index: 1, path: '/x', branch: 'feat/gone', readiness: 'safe' }),
    ],
    branches: [br({ name: 'feat/gone', hasLane: true, laneIndex: 1 })],
  });
  assert.equal(
    resolveCleanupCandidate(withLane, { id: 'br:feat/gone', kind: 'branch', branch: 'feat/gone' }),
    null,
  );
});

test('orderCleanupActions: remove before delete; optional after-remove branch delete', () => {
  const selected = [
    {
      id: 'wt:/a',
      kind: 'lane',
      path: '/a',
      branch: 'feat/a',
      tier: 'safe',
      readiness: 'safe',
      ahead: 0,
    },
    {
      id: 'br:feat/b',
      kind: 'branch',
      branch: 'feat/b',
      tier: 'safe',
      ahead: 0,
    },
  ];
  const without = orderCleanupActions(selected, { deleteBranchAfter: false });
  assert.deepEqual(without.map((s) => s.type), ['remove', 'deleteBranch']);
  assert.equal(without[0].path, '/a');
  assert.equal(without[1].branch, 'feat/b');

  const withAfter = orderCleanupActions(selected, { deleteBranchAfter: true });
  assert.deepEqual(withAfter.map((s) => s.type), ['remove', 'deleteBranch', 'deleteBranch']);
  assert.equal(withAfter[0].path, '/a');
  assert.equal(withAfter[1].branch, 'feat/a');
  assert.equal(withAfter[1].afterRemove, true);
  assert.equal(withAfter[2].branch, 'feat/b');
});

test('orderCleanupActions: confirm lanes force remove; ahead branches force delete', () => {
  const steps = orderCleanupActions([
    {
      id: 'wt:/d',
      kind: 'worktree',
      path: '/d',
      branch: 'feat/d',
      tier: 'confirm',
      readiness: 'working',
      ahead: 1,
    },
    {
      id: 'br:feat/e',
      kind: 'branch',
      branch: 'feat/e',
      tier: 'confirm',
      ahead: 3,
    },
  ], { deleteBranchAfter: true });
  assert.equal(steps[0].force, true);
  assert.equal(steps[1].type, 'deleteBranch');
  assert.equal(steps[1].force, true);
  assert.equal(steps[2].force, true);
});
