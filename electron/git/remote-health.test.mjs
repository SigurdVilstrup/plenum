import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGithubRemote, probeOrigin } from './remote-health.mjs';

function sh(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || args.join(' '));
  return r.stdout;
}

test('parseGithubRemote covers https and ssh', () => {
  assert.deepEqual(parseGithubRemote('https://github.com/SigurdVilstrup/overlook.git'), {
    owner: 'SigurdVilstrup',
    repo: 'overlook',
  });
  assert.deepEqual(parseGithubRemote('git@github.com:SigurdVilstrup/plenum.git'), {
    owner: 'SigurdVilstrup',
    repo: 'plenum',
  });
  assert.equal(parseGithubRemote('https://gitlab.com/x/y.git'), null);
});

test('probeOrigin reports missing GitHub repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-remote-'));
  sh(['init'], dir);
  sh(['remote', 'add', 'origin', 'https://github.com/SigurdVilstrup/overlook.git'], dir);
  const fetchImpl = async () => ({ status: 404, headers: { get: () => null } });
  const info = await probeOrigin(dir, { fetchImpl });
  assert.equal(info.status, 'missing');
  assert.match(info.detail, /overlook/);
  assert.equal(info.display, 'github.com/SigurdVilstrup/overlook');
});

test('probeOrigin reports renamed GitHub repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-remote-'));
  sh(['init'], dir);
  sh(['remote', 'add', 'origin', 'https://github.com/Acme/old.git'], dir);
  const fetchImpl = async () => ({
    status: 301,
    headers: { get: () => 'https://github.com/Acme/new' },
  });
  const info = await probeOrigin(dir, { fetchImpl });
  assert.equal(info.status, 'renamed');
  assert.match(info.detail, /Acme\/new/);
});

test('probeOrigin none when no origin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-remote-'));
  sh(['init'], dir);
  const info = await probeOrigin(dir, { fetchImpl: async () => ({ status: 200, headers: { get: () => null } }) });
  assert.equal(info.status, 'none');
});
