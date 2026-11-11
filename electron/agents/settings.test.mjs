import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAgentSettings, getAgentSettings, setAgentSettings } from './settings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-agents-'));

test('missing file gives defaults', () => {
  assert.deepEqual(getAgentSettings(tmp()), { version: 1, run: true, create: true, remove: 'allow', writeSetup: 'never' });
});

test('set then get round-trips and creates the folder', () => {
  const home = path.join(tmp(), 'nested');
  setAgentSettings({ create: false, writeSetup: 'allow' }, home);
  assert.deepEqual(getAgentSettings(home), { ...defaultAgentSettings(), create: false, writeSetup: 'allow' });
});

test('bad file content falls back to defaults per key', () => {
  const home = tmp();
  for (const body of ['', '{not json', '[]', '{"remove":"ask","run":"yes","writeSetup":"allow","extra":1}']) {
    fs.writeFileSync(path.join(home, 'agents.json'), body);
    const s = getAgentSettings(home);
    assert.equal(s.remove, 'allow');
    assert.equal(s.run, true);
    assert.equal('extra' in s, false);
  }
  assert.equal(getAgentSettings(home).writeSetup, 'allow'); // the valid key in the last body is kept
});

test('set ignores unknown keys and invalid values', () => {
  const home = tmp();
  const s = setAgentSettings({ remove: 'ask', run: 0, nope: true }, home);
  assert.deepEqual(s, { ...defaultAgentSettings(), run: false });
});
