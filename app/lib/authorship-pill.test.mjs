import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorshipPillHTML } from './authorship-pill.js';

const icon = (name) => `[${name}]`;

test('assisted with tool shows tool name and Assisted-by title', () => {
  const html = authorshipPillHTML('assisted', 'Cursor', icon);
  assert.match(html, /Cursor/);
  assert.doesNotMatch(html, />Assisted</);
  assert.match(html, /title="Assisted by Cursor"/);
  assert.match(html, /\[sparkle\]/);
});

test('agent with tool', () => {
  const html = authorshipPillHTML('agent', 'Cursor', icon);
  assert.match(html, /Cursor/);
  assert.match(html, /title="Agent: Cursor"/);
});

test('mixed with tool', () => {
  const html = authorshipPillHTML('mixed', 'Cursor', icon);
  assert.match(html, /title="Mixed authorship \(Cursor\)"/);
});

test('no tool shows kind label', () => {
  const html = authorshipPillHTML('assisted', null, icon);
  assert.match(html, /Assisted/);
  assert.match(html, /title="Assisted"/);
});

test('human returns empty', () => {
  assert.equal(authorshipPillHTML('human', null, icon), '');
});
