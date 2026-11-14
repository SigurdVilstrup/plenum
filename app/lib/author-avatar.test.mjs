import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorInitial, authorHue, gravatarUrl } from './author-avatar.js';

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

test('gravatarUrl builds SHA-256 avatar URL or empty', () => {
  const hash = 'a'.repeat(64);
  assert.equal(
    gravatarUrl(hash, 36),
    `https://www.gravatar.com/avatar/${hash}?s=36&d=404`,
  );
  assert.equal(gravatarUrl(''), '');
  assert.equal(gravatarUrl('nope'), '');
  assert.equal(gravatarUrl(hash.toUpperCase(), 80), `https://www.gravatar.com/avatar/${hash}?s=80&d=404`);
});
