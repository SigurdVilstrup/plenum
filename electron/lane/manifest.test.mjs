import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, resolvePorts } from './manifest.mjs';

test('loadManifest reads version, commands, ports', async () => {
  const m = await loadManifest('fixtures/lane/minimal.lane.yaml');
  assert.equal(m.version, 1);
  assert.equal(m.run, 'npm start');
  assert.equal(m.ports.offset, 100);
  const ports = resolvePorts(m, 1); // lane index 1 → offset 100
  assert.equal(ports.web, 5101);
});
