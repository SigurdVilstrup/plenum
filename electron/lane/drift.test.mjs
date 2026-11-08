import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPendingMigrations, usesSharedData } from './drift.mjs';

function tmpRoot(migrations = ['20260101_a.sql', '20260102_b.sql'], applied = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-drift-'));
  const migDir = path.join(root, 'migrations');
  fs.mkdirSync(migDir, { recursive: true });
  for (const name of migrations) fs.writeFileSync(path.join(migDir, name), '--\n');
  fs.mkdirSync(path.join(root, '.overlook'), { recursive: true });
  if (applied != null) {
    fs.writeFileSync(path.join(root, '.overlook', 'applied-migrations'), applied);
  }
  return root;
}

test('usesSharedData: empty services or any shared → true', () => {
  assert.equal(usesSharedData({ services: {} }), true);
  assert.equal(usesSharedData({ services: { db: { mode: 'shared' } } }), true);
  assert.equal(usesSharedData({ services: { db: { mode: 'snapshot' }, cache: { mode: 'shared' } } }), true);
  assert.equal(usesSharedData({ services: { db: { mode: 'snapshot' }, cache: { mode: 'isolated' } } }), false);
});

test('listPendingMigrations: no migrations path → []', async () => {
  const root = tmpRoot();
  try {
    assert.deepEqual(await listPendingMigrations({ laneRoot: root, manifest: { data: {} } }), []);
    assert.deepEqual(await listPendingMigrations({ laneRoot: root, manifest: {} }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listPendingMigrations: missing applied file → all migration filenames', async () => {
  const root = tmpRoot(['20260101_a.sql', '20260102_b.sql']);
  try {
    const pending = await listPendingMigrations({
      laneRoot: root,
      manifest: { data: { migrations: 'migrations' } },
    });
    assert.deepEqual(pending, ['20260101_a.sql', '20260102_b.sql']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listPendingMigrations: subtracts applied set (name-only)', async () => {
  const root = tmpRoot(['20260101_a.sql', '20260102_b.sql', '20260103_c.sql'], '20260101_a.sql\n20260102_b.sql\n');
  try {
    const pending = await listPendingMigrations({
      laneRoot: root,
      manifest: { data: { migrations: 'migrations' } },
    });
    assert.deepEqual(pending, ['20260103_c.sql']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listPendingMigrations: zero when all applied', async () => {
  const root = tmpRoot(['a.sql'], 'a.sql\n');
  try {
    assert.deepEqual(await listPendingMigrations({
      laneRoot: root,
      manifest: { data: { migrations: 'migrations' } },
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listPendingMigrations: pluggable adapter', async () => {
  const root = tmpRoot(['a.sql', 'b.sql']);
  try {
    const pending = await listPendingMigrations({
      laneRoot: root,
      manifest: { data: { migrations: 'migrations' } },
      adapter: async () => new Set(['a.sql']),
    });
    assert.deepEqual(pending, ['b.sql']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listPendingMigrations: missing migrations dir → []', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-drift-'));
  try {
    assert.deepEqual(await listPendingMigrations({
      laneRoot: root,
      manifest: { data: { migrations: 'nope' } },
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listPendingMigrations: scans laneRoot, marker from markerRoot', async () => {
  const primary = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-drift-pri-'));
  const lane = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-drift-lane-'));
  try {
    fs.mkdirSync(path.join(primary, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(primary, 'migrations', '20260101_a.sql'), '--\n');
    fs.mkdirSync(path.join(primary, '.overlook'), { recursive: true });
    fs.writeFileSync(path.join(primary, '.overlook', 'applied-migrations'), '20260101_a.sql\n');

    fs.mkdirSync(path.join(lane, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(lane, 'migrations', '20260101_a.sql'), '--\n');
    fs.writeFileSync(path.join(lane, 'migrations', '20260104_branch.sql'), '--\n');

    const pending = await listPendingMigrations({
      laneRoot: lane,
      markerRoot: primary,
      manifest: { data: { migrations: 'migrations' } },
    });
    assert.deepEqual(pending, ['20260104_branch.sql']);
  } finally {
    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(lane, { recursive: true, force: true });
  }
});
