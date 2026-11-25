import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentPrompt } from './agent-prompt.mjs';

test('buildAgentPrompt includes dual-use rules and hit paths', () => {
  const text = buildAgentPrompt({
    canAccept: true,
    hasManifest: false,
    proposed: {
      run: 'npm run dev',
      ports: { offset: 100, expose: { web: 5173 } },
      env: { set: { PORT: '{port.web}' } },
    },
    hits: [{ path: 'vite.config.ts', line: 12, snippet: 'localhost:5173' }],
    wiring: { unused: [], proposedWires: {} },
    findings: [],
  });
  assert.match(text, /fallbacks to today's hard-coded values/);
  assert.match(text, /without Plenum/);
  assert.match(text, /vite\.config\.ts:12/);
  assert.match(text, /localhost:5173/);
  assert.match(text, /`run`: `npm run dev`/);
  assert.match(text, /`web`: 5173/);
  assert.match(text, /Done when/);
});

test('buildAgentPrompt notes aspire/compose from findings', () => {
  const text = buildAgentPrompt({
    canAccept: false,
    proposed: { ports: { offset: 100, expose: {} }, env: { set: {} } },
    hits: [],
    wiring: {},
    findings: ['found tools/aspire/apphost.mts — no auto start command; add a run: line'],
  });
  assert.match(text, /Aspire and\/or compose/);
  assert.match(text, /No acceptable `run` yet/);
  assert.match(text, /Superset|multi-frontend/);
});

test('buildAgentPrompt suggests expose from hits when recipe expose empty', () => {
  const text = buildAgentPrompt({
    canAccept: true,
    proposed: {
      run: 'npm run dev',
      ports: { offset: 100, expose: {} },
      env: { set: {} },
    },
    hits: [
      { path: 'a.ts', line: 1, snippet: 'localhost:5100' },
      { path: 'b.ts', line: 2, snippet: 'listen(6100' },
    ],
    wiring: {},
    findings: [],
  });
  assert.match(text, /Suggested `ports\.expose` from open hits/);
  assert.match(text, /`web`: 5100/);
  assert.match(text, /`api`: 6100/);
});
