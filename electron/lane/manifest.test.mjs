import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, resolvePorts } from './manifest.mjs';

test('loadManifest reads version, commands, ports', async () => {
  const m = await loadManifest('fixtures/lane/minimal.lane.yaml');
  assert.equal(m.version, 1);
  assert.equal(m.run, 'npm start');
  assert.equal(m.ports.offset, 100);
  const ports = resolvePorts(m, 1); // lane index 1 → offset 100
  assert.equal(ports.web, 5101);
});

test('loadManifest missing file returns null', async () => {
  assert.equal(await loadManifest('fixtures/lane/does-not-exist.lane.yaml'), null);
});

test('loadManifest unsupported version throws', async () => {
  const file = path.join(os.tmpdir(), `plenum-lane-${Date.now()}.yaml`);
  fs.writeFileSync(file, 'version: 2\nrun: echo hi\n');
  try {
    await assert.rejects(() => loadManifest(file), /unsupported lane manifest version/);
  } finally {
    fs.unlinkSync(file);
  }
});

test('loadManifest keeps services.*.snapshot and teardown', async () => {
  const file = path.join(os.tmpdir(), `plenum-lane-snap-${Date.now()}.yaml`);
  fs.writeFileSync(
    file,
    [
      'version: 1',
      'run: npm start',
      'services:',
      '  db:',
      '    mode: snapshot',
      '    snapshot: echo seed',
      '    teardown: echo drop',
      'data:',
      '  snapshot: echo default-seed',
      '',
    ].join('\n'),
  );
  try {
    const m = await loadManifest(file);
    assert.equal(m.services.db.mode, 'snapshot');
    assert.equal(m.services.db.snapshot, 'echo seed');
    assert.equal(m.services.db.teardown, 'echo drop');
    assert.equal(m.data.snapshot, 'echo default-seed');
  } finally {
    fs.unlinkSync(file);
  }
});
