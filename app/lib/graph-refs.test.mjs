import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRefs } from './graph-refs.js';

test('overflow when more than max', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs, { max: 2 }), {
    shown: [{ name: 'a' }, { name: 'b' }],
    overflow: 1,
  });
});

test('pins current when beyond max', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs, { max: 2, currentBranch: 'c' }), {
    shown: [{ name: 'c' }, { name: 'a' }],
    overflow: 1,
  });
});
