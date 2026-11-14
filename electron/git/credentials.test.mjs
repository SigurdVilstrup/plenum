import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeHost, credentialInput, upsertHost, removeHost, approve, reject } from './credentials.mjs';

test('sanitizeHost normalizes and rejects', () => {
  assert.equal(sanitizeHost('GitHub.com'), 'github.com');
  assert.equal(sanitizeHost('https://dev.azure.com/org/x?y#z'), 'dev.azure.com');
  assert.equal(sanitizeHost('git.corp.example:8443'), 'git.corp.example:8443');
  for (const bad of ['', ' ', 'http://github.com', 'a b', 'github.com\nhost=evil.com', 'host=evil', '-x.com', 'a..b/', '[::1]', 'x.com:99999x']) {
    assert.throws(() => sanitizeHost(bad), /host|https/i, JSON.stringify(bad));
  }
});

test('credentialInput refuses protocol-line injection', () => {
  assert.equal(
    credentialInput({ host: 'github.com', username: 'ada', password: 'ghp_x' }),
    'protocol=https\nhost=github.com\nusername=ada\npassword=ghp_x\n\n',
  );
  assert.throws(() => credentialInput({ host: 'github.com', username: 'ada\nhost=evil', password: 'p' }), /username/);
  assert.throws(() => credentialInput({ host: 'github.com', username: 'ada', password: 'p\nq' }), /token/);
  assert.throws(() => credentialInput({ host: 'github.com', username: '', password: 'p' }), /username/);
});

test('upsertHost / removeHost keep no secrets', () => {
  let l = upsertHost([], { host: 'github.com', username: 'ada', kind: 'github' });
  l = upsertHost(l, { host: 'github.com', username: 'ada', kind: 'github', password: 'nope' });
  assert.deepEqual(l, [{ host: 'github.com', username: 'ada', kind: 'github' }]);
  assert.deepEqual(removeHost(l, 'github.com', 'ada'), []);
});

test('approve then reject through a store helper', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-cred-'));
  const store = path.join(tmp, 'store');
  const cfg = path.join(tmp, 'gitconfig');
  fs.writeFileSync(cfg, `[credential]\n\thelper = store --file ${store}\n`);
  process.env.GIT_CONFIG_GLOBAL = cfg;
  process.env.GIT_CONFIG_NOSYSTEM = '1'; // Apple's system config adds osxkeychain; keep the test out of the real Keychain
  await approve({ host: 'github.com', username: 'ada', password: 'ghp_secret' });
  assert.match(fs.readFileSync(store, 'utf8'), /https:\/\/ada:ghp_secret@github\.com/);
  await reject({ host: 'github.com', username: 'ada' });
  assert.doesNotMatch(fs.readFileSync(store, 'utf8'), /ghp_secret/);
});
