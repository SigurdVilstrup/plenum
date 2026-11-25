import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghCandidates, resolveGhBin, starPlenumRepo, PLENUM_GITHUB } from './github-star.mjs';

test('ghCandidates prefers PATH then Homebrew locations', () => {
  const c = ghCandidates('/Users/me', 'darwin');
  assert.equal(c[0], 'gh');
  assert.ok(c.includes('/opt/homebrew/bin/gh'));
  assert.ok(c.includes('/Users/me/.local/bin/gh'));
});

test('ghCandidates on Windows prefers gh.exe then Program Files', () => {
  const c = ghCandidates('C:\\Users\\me', 'win32');
  assert.equal(c[0], 'gh.exe');
  assert.ok(c.some((p) => /GitHub CLI/i.test(p)));
});

test('resolveGhBin skips bare gh when PATH is slim and uses Homebrew', () => {
  // Dock-launched Electron: PATH has no Homebrew, but the absolute binary exists.
  const bin = resolveGhBin({
    home: '/Users/me',
    pathEnv: '/usr/bin:/bin',
    platform: 'darwin',
    existsSync: (p) => p === '/opt/homebrew/bin/gh',
  });
  assert.equal(bin, '/opt/homebrew/bin/gh');
});

test('resolveGhBin uses PATH when gh is present there', () => {
  const bin = resolveGhBin({
    home: '/Users/me',
    pathEnv: '/custom/bin:/usr/bin',
    platform: 'darwin',
    existsSync: (p) => p === '/custom/bin/gh',
  });
  assert.equal(bin, '/custom/bin/gh');
});

// Host-agnostic: exercises win32 ';' PATH + gh.exe joining on Mac CI too.
test('resolveGhBin uses Windows PATH when gh.exe is present there', () => {
  const bin = resolveGhBin({
    home: 'C:\\Users\\me',
    pathEnv: 'C:\\custom\\bin;C:\\Windows\\System32',
    platform: 'win32',
    existsSync: (p) => p === 'C:\\custom\\bin\\gh.exe',
  });
  assert.equal(bin, 'C:\\custom\\bin\\gh.exe');
});

test('resolveGhBin returns null when nothing exists', () => {
  assert.equal(resolveGhBin({
    home: '/Users/me',
    pathEnv: '/usr/bin',
    platform: 'darwin',
    existsSync: () => false,
  }), null);
});

test('starPlenumRepo uses gh when the API call succeeds', async () => {
  const calls = [];
  const opened = [];
  const out = await starPlenumRepo({
    bins: ['/fake/gh'],
    execFileImpl: async (bin, args) => { calls.push({ bin, args }); },
    openExternal: async (url) => { opened.push(url); },
  });
  assert.deepEqual(out, { via: 'gh' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, '/fake/gh');
  assert.deepEqual(calls[0].args, ['api', '-X', 'PUT', `/user/starred/${PLENUM_GITHUB.owner}/${PLENUM_GITHUB.repo}`]);
  assert.equal(opened.length, 0);
});

test('starPlenumRepo skips missing bins and opens the browser when gh fails', async () => {
  const opened = [];
  const tried = [];
  const out = await starPlenumRepo({
    bins: ['/missing/gh', '/broken/gh'],
    execFileImpl: async (bin) => {
      tried.push(bin);
      if (bin === '/missing/gh') {
        const err = new Error('not found');
        err.code = 'ENOENT';
        throw err;
      }
      throw new Error('HTTP 401');
    },
    openExternal: async (url) => { opened.push(url); },
  });
  assert.deepEqual(out, { via: 'browser' });
  assert.deepEqual(tried, ['/missing/gh', '/broken/gh']);
  assert.deepEqual(opened, [PLENUM_GITHUB.url]);
});

test('starPlenumRepo opens the browser when no gh binary is available', async () => {
  const opened = [];
  const out = await starPlenumRepo({
    bins: [],
    execFileImpl: async () => { throw new Error('should not run'); },
    openExternal: async (url) => { opened.push(url); },
  });
  assert.deepEqual(out, { via: 'browser' });
  assert.deepEqual(opened, [PLENUM_GITHUB.url]);
});
