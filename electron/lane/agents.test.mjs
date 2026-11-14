import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFromArgs, parseLsofCwd, agentsInLane } from './agents.mjs';

test('agentFromArgs spots agent CLIs only', () => {
  assert.equal(agentFromArgs('claude --output-format stream-json --model=x'), 'Claude');
  assert.equal(agentFromArgs('/opt/homebrew/bin/codex'), 'Codex');
  assert.equal(agentFromArgs('/usr/local/bin/node /opt/homebrew/lib/node_modules/@google/gemini-cli/bin/gemini --yolo'), 'Gemini');
  assert.equal(agentFromArgs('/Users/me/.local/bin/cursor-agent -p fix'), 'Cursor');
  assert.equal(agentFromArgs('/Users/me/Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent --use-system-ca'), null);
  assert.equal(agentFromArgs('/Applications/Claude.app/Contents/MacOS/Claude'), null);
  assert.equal(agentFromArgs('grep -r claude .'), null);
  assert.equal(agentFromArgs('/bin/zsh -l'), null);
});

test('parseLsofCwd maps pid to cwd', () => {
  const out = 'p12\nfcwd\nn/repo/a\np34\nfcwd\nn/repo/b with space\n';
  assert.deepEqual([...parseLsofCwd(out)], [[12, '/repo/a'], [34, '/repo/b with space']]);
});

test('agentsInLane keeps nested lanes and lookalike paths apart', () => {
  const agents = [
    { name: 'Claude', cwd: '/repo' },
    { name: 'Codex', cwd: '/repo/.worktrees/feat/src' },
    { name: 'Claude', cwd: '/repo/app' },
    { name: 'Aider', cwd: '/repo-other' },
  ];
  const lanes = ['/repo', '/repo/.worktrees/feat'];
  assert.deepEqual(agentsInLane('/repo', agents, lanes), ['Claude']);
  assert.deepEqual(agentsInLane('/repo/.worktrees/feat', agents, lanes), ['Codex']);
});
