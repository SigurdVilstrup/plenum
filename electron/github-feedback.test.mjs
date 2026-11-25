import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildFeedbackIssueBody,
  feedbackIssueTitle,
  ghFeedbackAvailable,
  createFeedbackIssueViaGh,
} from './github-feedback.mjs';

test('feedbackIssueTitle truncates long comments', () => {
  assert.equal(feedbackIssueTitle('short'), 'short');
  const long = 'x'.repeat(80);
  assert.equal(feedbackIssueTitle(long), `${'x'.repeat(69)}…`);
});

test('buildFeedbackIssueBody includes env and via-gh note', () => {
  const body = buildFeedbackIssueBody({
    comment: 'Toast has no link',
    target: { label: 'Send feedback' },
    reporterEmail: 'a@b.com',
    appVersion: '0.2.14',
    platform: 'darwin',
    osVersion: '25.0',
    arch: 'arm64',
    electronVersion: '39.0.0',
    locale: 'en-GB',
    windowSize: { width: 1280, height: 800 },
  }, { viaGh: true });
  assert.match(body, /Toast has no link/);
  assert.match(body, /\*\*Target:\*\* Send feedback/);
  assert.match(body, /\*\*Reported by\*\* a@b\.com/);
  assert.match(body, /App: 0\.2\.14/);
  assert.match(body, /Screenshot stayed on this Mac/);
  assert.match(body, /via `gh`/);
});

test('ghFeedbackAvailable is false when no bins exist', async () => {
  assert.equal(await ghFeedbackAvailable({ bins: [], existsSync: () => false }), false);
});

test('ghFeedbackAvailable is true via Homebrew when PATH lacks gh (#130)', async () => {
  assert.equal(await ghFeedbackAvailable({
    home: '/Users/me',
    pathEnv: '/usr/bin:/bin',
    platform: 'darwin',
    existsSync: (p) => p === '/opt/homebrew/bin/gh',
  }), true);
});

test('createFeedbackIssueViaGh posts via gh api and returns the issue', async () => {
  const calls = [];
  const out = await createFeedbackIssueViaGh({
    comment: 'Link the toast',
    appVersion: '0.2.14',
    platform: 'darwin',
  }, {
    bins: ['/fake/gh'],
    existsSync: () => true,
    execFileImpl: async (bin, args) => {
      calls.push({ bin, args });
      const input = args[args.indexOf('--input') + 1];
      const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
      assert.equal(payload.title, 'Link the toast');
      assert.deepEqual(payload.labels, ['feedback']);
      assert.match(payload.body, /Link the toast/);
      return {
        stdout: JSON.stringify({
          html_url: 'https://github.com/SigurdVilstrup/plenum/issues/99',
          number: 99,
        }),
      };
    },
  });
  assert.deepEqual(out, {
    issueUrl: 'https://github.com/SigurdVilstrup/plenum/issues/99',
    issueNumber: 99,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, '/fake/gh');
  assert.ok(calls[0].args.includes('--input'));
  // temp payload file is removed after the call
  const input = calls[0].args[calls[0].args.indexOf('--input') + 1];
  assert.equal(fs.existsSync(input), false);
});

test('createFeedbackIssueViaGh uses Homebrew when bare gh is missing from PATH (#130)', async () => {
  const calls = [];
  const out = await createFeedbackIssueViaGh({
    comment: 'spawn gh ENOENT',
    appVersion: '0.2.16',
    platform: 'darwin',
  }, {
    home: '/Users/me',
    pathEnv: '/usr/bin:/bin',
    platform: 'darwin',
    existsSync: (p) => p === '/opt/homebrew/bin/gh',
    execFileImpl: async (bin, args) => {
      calls.push({ bin, args });
      return {
        stdout: JSON.stringify({
          html_url: 'https://github.com/SigurdVilstrup/plenum/issues/130',
          number: 130,
        }),
      };
    },
  });
  assert.equal(calls[0].bin, '/opt/homebrew/bin/gh');
  assert.equal(out.issueNumber, 130);
});
test('createFeedbackIssueViaGh surfaces gh failures', async () => {
  await assert.rejects(
    () => createFeedbackIssueViaGh({ comment: 'x' }, {
      bins: ['/fake/gh'],
      existsSync: () => true,
      execFileImpl: async () => {
        const err = new Error('boom');
        err.stderr = 'HTTP 401';
        throw err;
      },
    }),
    /Couldn’t create the GitHub issue/,
  );
});
