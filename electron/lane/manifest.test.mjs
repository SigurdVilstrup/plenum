import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, resolvePorts, dumpManifest, normalizeManifestInput, getManifest } from './manifest.mjs';
import { writeManifest } from './doctor.mjs';
import { writeManifestDir } from '../paths.mjs';

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

test('dumpManifest round-trips services and data', async () => {
  const file = path.join(os.tmpdir(), `plenum-lane-dump-${Date.now()}.yaml`);
  const yaml = dumpManifest({
    version: 1,
    run: 'npm start',
    services: { db: { mode: 'snapshot', snapshot: 'echo seed', teardown: 'echo drop' } },
    data: { migrations: 'db/mig', snapshot: 'echo default' },
    env: { copy: [], set: {} },
    ports: { offset: 100, expose: { web: 5001 } },
  });
  fs.writeFileSync(file, yaml);
  try {
    const m = await loadManifest(file);
    assert.equal(m.services.db.mode, 'snapshot');
    assert.equal(m.services.db.snapshot, 'echo seed');
    assert.equal(m.data.migrations, 'db/mig');
    assert.equal(m.data.snapshot, 'echo default');
    assert.equal(m.ports.expose.web, 5001);
  } finally {
    fs.unlinkSync(file);
  }
});

test('dumpManifest omits empty services and data', () => {
  const yaml = dumpManifest({
    version: 1,
    run: 'npm start',
    env: { copy: [], set: {} },
    ports: { offset: 100, expose: {} },
    services: {},
    data: {},
  });
  assert.ok(!yaml.includes('services:'));
  assert.ok(!yaml.includes('data:'));
});

test('getManifest soft-fails with raw text on bad version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-get-manifest-'));
  try {
    fs.mkdirSync(path.join(root, '.plenum'));
    fs.writeFileSync(path.join(root, '.plenum', 'lane.yaml'), 'version: 2\nrun: echo hi\n');
    const res = await getManifest(root);
    assert.equal(res.hasManifest, true);
    assert.equal(res.manifest, null);
    assert.match(res.error || '', /unsupported/);
    assert.match(res.text, /version: 2/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeManifest rejects empty run and snapshot without seed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-write-manifest-'));
  try {
    await assert.rejects(() => writeManifest(root, { run: '' }), /run command/);
    await assert.rejects(
      () => writeManifest(root, normalizeManifestInput({
        run: 'npm start',
        services: { db: { mode: 'snapshot' } },
      })),
      /snapshot/,
    );
    await writeManifest(root, {
      run: 'npm start',
      services: { db: { mode: 'snapshot', snapshot: 'echo seed' } },
    });
    const m = await loadManifest(path.join(writeManifestDir(root), 'lane.yaml'));
    assert.equal(m.services.db.snapshot, 'echo seed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dumpManifest omits an empty env block', () => {
  const out = dumpManifest({ version: 1, run: 'npm run dev', env: { copy: [], set: {} }, ports: { offset: 100, expose: {} } });
  assert.ok(!out.includes('env:'), out);
});
