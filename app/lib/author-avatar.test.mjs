import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorInitial, authorHue } from './author-avatar.js';

test('authorInitial uses first letter', () => {
  assert.equal(authorInitial('Ada Lovelace'), 'A');
  assert.equal(authorInitial('sigurd'), 'S');
  assert.equal(authorInitial(''), '?');
});

test('authorHue is stable and in range', () => {
  assert.equal(authorHue('ada@ex.com'), authorHue('ada@ex.com'));
  assert.ok(authorHue('ada@ex.com') >= 0 && authorHue('ada@ex.com') < 360);
  assert.notEqual(authorHue('ada@ex.com'), authorHue('bob@ex.com'));
});
