import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FAME_CATEGORIES,
  FAME_CATEGORIES,
  filterAwardsByCategories,
  normalizeFameCategories,
} from './fame-categories.mjs';

test('normalizeFameCategories drops junk and falls back', () => {
  assert.deepEqual(normalizeFameCategories(null), [...DEFAULT_FAME_CATEGORIES]);
  assert.deepEqual(normalizeFameCategories([]), [...DEFAULT_FAME_CATEGORIES]);
  assert.deepEqual(normalizeFameCategories(['ai', 'nope', 'ai', 'file']), ['ai', 'file']);
});

test('filterAwardsByCategories keeps only selected ids', () => {
  const awards = FAME_CATEGORIES.map((c) => ({ id: c.id, title: c.title }));
  assert.deepEqual(
    filterAwardsByCategories(awards, ['fav', 'ai']).map((a) => a.id),
    ['ai', 'fav'],
  );
});
