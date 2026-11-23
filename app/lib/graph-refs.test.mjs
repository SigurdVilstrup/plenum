import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRefs } from './graph-refs.js';

test('default max is one pill; rest become overflow', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs), {
    shown: [{ name: 'a' }],
    overflow: 2,
  });
});

test('overflow when more than max', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs, { max: 2 }), {
    shown: [{ name: 'a' }, { name: 'b' }],
    overflow: 1,
  });
});

test('pins current as the single shown pill', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs, { currentBranch: 'c' }), {
    shown: [{ name: 'c' }],
    overflow: 2,
  });
});

test('pins current first when max is 2', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs, { max: 2, currentBranch: 'c' }), {
    shown: [{ name: 'c' }, { name: 'a' }],
    overflow: 1,
  });
});
