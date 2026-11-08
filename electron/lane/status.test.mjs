import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneStatus } from './status.mjs';

const base = {
  ports: { offset: 100, expose: { web: 5001 } },
};

test('dataMode is snapshot when any service is snapshot', () => {
  const status = laneStatus(
    { ...base, services: { db: { mode: 'snapshot' }, cache: { mode: 'shared' } } },
    1,
  );
  assert.equal(status.dataMode, 'snapshot');
});

test('dataMode stays shared/isolated when no snapshot services', () => {
  assert.equal(laneStatus({ ...base, services: { db: { mode: 'shared' } } }, 1).dataMode, 'shared');
  assert.equal(laneStatus({ ...base, services: { db: { mode: 'isolated' } } }, 1).dataMode, 'isolated');
});
