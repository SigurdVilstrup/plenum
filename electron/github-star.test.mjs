import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghCandidates, starPlenumRepo, PLENUM_GITHUB } from './github-star.mjs';

test('ghCandidates prefers PATH then Homebrew locations', () => {
  const c = ghCandidates('/Users/me');
  assert.equal(c[0], 'gh');
  assert.ok(c.includes('/opt/homebrew/bin/gh'));
  assert.ok(c.includes('/Users/me/.local/bin/gh'));
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
