import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getIdentity, setIdentity } from './identity.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-ident-'));
process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'gitconfig'); // never touch the real global config
const repo = path.join(tmp, 'repo');
execFileSync('git', ['init', '-q', repo]);

test('global and local identity round trip', async () => {
  let id = await setIdentity(repo, { scope: 'global', name: 'Ada', email: 'ada@x.dev' });
  assert.deepEqual(id.global, { name: 'Ada', email: 'ada@x.dev' });
  assert.deepEqual(id.local, { name: '', email: '' });
  id = await setIdentity(repo, { scope: 'local', name: 'Ada W', email: '' });
  assert.equal(id.local.name, 'Ada W');
  assert.equal(id.global.name, 'Ada');
  id = await setIdentity(repo, { scope: 'local', name: '', email: '' });
  assert.deepEqual(id.local, { name: '', email: '' });
});

test('rejects bad scope and option-like values', async () => {
  await assert.rejects(setIdentity(repo, { scope: 'system', name: 'a', email: 'b' }), /scope/);
  await assert.rejects(setIdentity(repo, { scope: 'global', name: '--global', email: 'b' }), /name/);
  await assert.rejects(setIdentity(repo, { scope: 'global', name: 'a\nb', email: 'b' }), /name/);
  assert.equal((await getIdentity(null)).local, null);
});
