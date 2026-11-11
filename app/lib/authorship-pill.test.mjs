import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorshipPillHTML } from './authorship-pill.js';

const icon = (name) => `[${name}]`;

test('assisted with known tool uses brand mark, not sparkle', () => {
  const html = authorshipPillHTML('assisted', 'Cursor', icon);
  assert.match(html, /Cursor/);
  assert.doesNotMatch(html, />Assisted</);
  assert.match(html, /title="Assisted by Cursor"/);
  assert.match(html, /ai-pill-icon/);
  assert.doesNotMatch(html, /\[sparkle\]/);
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

test('Devin uses brand mark', () => {
  const html = authorshipPillHTML('assisted', 'Devin', icon);
  assert.match(html, /Devin/);
  assert.match(html, /ai-pill-icon/);
  assert.doesNotMatch(html, /\[sparkle\]/);
});

test('unknown tool falls back to kind icon', () => {
  const html = authorshipPillHTML('assisted', 'MysteryBot', icon);
  assert.match(html, /MysteryBot/);
  assert.match(html, /\[sparkle\]/);
});

test('no tool shows kind label', () => {
  const html = authorshipPillHTML('assisted', null, icon);
  assert.match(html, /Assisted/);
  assert.match(html, /title="Assisted"/);
  assert.match(html, /\[sparkle\]/);
});

test('human returns empty', () => {
  assert.equal(authorshipPillHTML('human', null, icon), '');
});
