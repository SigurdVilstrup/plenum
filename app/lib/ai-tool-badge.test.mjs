import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_BADGE_TOOLS, aiToolBadge, aiToolBadgeHTML, aiToolPillIconHTML, authorshipBadgeLegendHTML } from './ai-tool-badge.js';

test('maps day-one tools', () => {
  for (const t of ['Cursor', 'Claude', 'Codex', 'Copilot', 'Gemini', 'Muse', 'Windsurf', 'Devin', 'Aider']) {
    assert.ok(aiToolBadge(t), t);
  }
  assert.equal(aiToolBadge('OpenAI'), null);
  assert.equal(aiToolBadge(null), null);
});

test('badge HTML for Cursor', () => {
  const html = aiToolBadgeHTML('Cursor');
  assert.match(html, /class="ai-badge"/);
  assert.match(html, /cursor/);
  assert.equal(aiToolBadgeHTML('UnknownTool'), '');
});

test('Copilot uses dark chip', () => {
  assert.match(aiToolBadgeHTML('Copilot'), /ai-badge dark/);
  assert.match(aiToolPillIconHTML('Copilot'), /ai-pill-icon dark/);
});

test('pill icon for Muse', () => {
  const html = aiToolPillIconHTML('Muse');
  assert.match(html, /ai-pill-icon/);
  assert.match(html, /muse/);
});

test('Devin and Windsurf badges render', () => {
  assert.match(aiToolBadgeHTML('Devin'), /devin/);
  assert.match(aiToolBadgeHTML('Windsurf'), /windsurf/);
  assert.match(aiToolPillIconHTML('Aider'), /aider/);
});

test('settings legend lists day-one tools plus human', () => {
  const html = authorshipBadgeLegendHTML((n) => `[${n}]`);
  for (const t of AI_BADGE_TOOLS) assert.match(html, new RegExp(t));
  assert.match(html, /Human/);
  assert.match(html, /authorship-preview/);
  assert.match(html, /pill assisted/);
});
