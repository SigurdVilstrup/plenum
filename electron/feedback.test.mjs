import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_FEEDBACK_URL,
  buildMeta,
  buildUploadPayload,
  collectFeedbackEnv,
  patchFeedbackMeta,
  sanitizeReporterEmail,
  sendCheckin,
  readFeedbackReport,
  retryUnsentFeedback,
  listUnsentFeedback,
  sendFeedbackReport,
  writeFeedbackReport,
} from './feedback.mjs';

test('packaged builds have a relay endpoint without .env', () => {
  const url = new URL(DEFAULT_FEEDBACK_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/functions/v1/submit-feedback');
});

test('buildMeta shapes v2 report', () => {
  const meta = buildMeta({
    comment: '  Behind is too quiet  ',
    target: { label: 'Behind', rect: { x: 1, y: 2, w: 3, h: 4 } },
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: '/tmp/repo',
    reporterEmail: 'Sigurd@Example.com',
    createdAt: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(meta.version, 2);
  assert.equal(meta.createdAt, '2026-11-09T00:00:00.000Z');
  assert.equal(meta.comment, 'Behind is too quiet');
  assert.deepEqual(meta.target, { label: 'Behind', rect: { x: 1, y: 2, w: 3, h: 4 } });
  assert.equal(meta.appVersion, '0.0.0');
  assert.equal(meta.platform, 'darwin');
  assert.equal(meta.repoPath, '/tmp/repo');
  assert.equal(meta.reporterEmail, 'sigurd@example.com');
  assert.equal(meta.status, 'pending');
  assert.equal(meta.issueUrl, null);
  assert.equal(meta.omitScreenshot, false);
  assert.equal(buildMeta({ comment: 'x', omitScreenshot: true }).omitScreenshot, true);

  assert.equal(buildMeta({ comment: '', appVersion: '1', platform: 'darwin' }).target, null);
  assert.equal(buildMeta({ comment: '', target: null, appVersion: '1', platform: 'darwin' }).target, null);
});

test('buildMeta passes through env fields', () => {
  const meta = buildMeta({
    comment: 'x',
    appVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '25.3.0',
    electronVersion: '39.0.0',
    locale: 'en-US',
    screens: [{ width: 1512, height: 982, scaleFactor: 2, primary: true }],
    windowSize: { width: 1280, height: 800 },
    repoPath: null,
    createdAt: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(meta.arch, 'arm64');
  assert.equal(meta.osVersion, '25.3.0');
  assert.equal(meta.electronVersion, '39.0.0');
  assert.equal(meta.locale, 'en-US');
  assert.deepEqual(meta.screens, [{ width: 1512, height: 982, scaleFactor: 2, primary: true }]);
  assert.deepEqual(meta.windowSize, { width: 1280, height: 800 });
});

test('sanitizeReporterEmail accepts emails and rejects junk', () => {
  assert.equal(sanitizeReporterEmail(null), null);
  assert.equal(sanitizeReporterEmail(''), null);
  assert.equal(sanitizeReporterEmail('  Ada@Example.COM '), 'ada@example.com');
  assert.throws(() => sanitizeReporterEmail('not-an-email'), /Invalid/);
  assert.throws(() => sanitizeReporterEmail('a\nb@x.com'), /Invalid/);
});

test('buildUploadPayload strips repoPath', () => {
  const meta = buildMeta({
    comment: 'hi',
    appVersion: '0.1.0',
    platform: 'darwin',
    repoPath: '/Users/someone/secret-repo',
    reporterEmail: 'ada@example.com',
  });
  const payload = buildUploadPayload(meta, Buffer.from('png'));
  assert.equal(payload.comment, 'hi');
  assert.equal(payload.reporterEmail, 'ada@example.com');
  assert.equal(payload.env.appVersion, '0.1.0');
  assert.equal('repoPath' in payload, false);
  assert.equal('repoPath' in payload.env, false);
  assert.ok(payload.pngBase64);
  assert.equal('omitScreenshot' in payload, false);
});

test('buildUploadPayload omits png when screenshot is skipped', () => {
  const meta = buildMeta({
    comment: 'text only',
    appVersion: '0.1.0',
    platform: 'darwin',
    omitScreenshot: true,
  });
  const payload = buildUploadPayload(meta, null);
  assert.equal(payload.omitScreenshot, true);
  assert.equal('pngBase64' in payload, false);
  assert.equal(payload.comment, 'text only');
});

test('collectFeedbackEnv shapes display + window facts', () => {
  const env = collectFeedbackEnv({
    getVersion: () => '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    getSystemVersion: () => '25.3.0',
    electronVersion: '39.0.0',
    locale: 'en-US',
    getAllDisplays: () => [
      { bounds: { width: 1512, height: 982 }, scaleFactor: 2, id: 1 },
      { bounds: { width: 1920, height: 1080 }, scaleFactor: 1, id: 2 },
    ],
    primaryDisplayId: 1,
    getContentSize: () => [1280, 800],
  });
  assert.equal(env.appVersion, '0.1.0');
  assert.equal(env.platform, 'darwin');
  assert.equal(env.arch, 'arm64');
  assert.equal(env.osVersion, '25.3.0');
  assert.equal(env.screens[0].primary, true);
  assert.equal(env.screens[1].primary, false);
  assert.deepEqual(env.windowSize, { width: 1280, height: 800 });
});

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('writeFeedbackReport writes meta.json and window.png', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'hi',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    png: tinyPng,
  });
  assert.ok(path.isAbsolute(out));
  assert.equal(out, path.resolve(out));
  assert.ok(out.startsWith(path.resolve(dir, 'feedback') + path.sep));
  assert.ok(fs.existsSync(path.join(out, 'meta.json')));
  assert.ok(fs.existsSync(path.join(out, 'window.png')));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.comment, 'hi');
  assert.equal(meta.target, null);
  assert.equal(meta.status, 'pending');
  assert.equal(meta.version, 2);
  assert.equal(meta.omitScreenshot, false);
  assert.deepEqual(fs.readFileSync(path.join(out, 'window.png')), tinyPng);
});

test('writeFeedbackReport skips window.png when omitScreenshot is set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'no shot',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    omitScreenshot: true,
  });
  assert.ok(fs.existsSync(path.join(out, 'meta.json')));
  assert.equal(fs.existsSync(path.join(out, 'window.png')), false);
  const { meta, png } = readFeedbackReport(out);
  assert.equal(meta.omitScreenshot, true);
  assert.equal(meta.comment, 'no shot');
  assert.equal(png, null);
});

test('sendFeedbackReport posts without png when screenshot omitted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'relay text only',
    target: null,
    appVersion: '0.2.0',
    platform: 'darwin',
    repoPath: '/Users/secret/repo',
    omitScreenshot: true,
  });
  let posted = null;
  const meta = await sendFeedbackReport(out, {
    endpoint: 'https://example.test/submit-feedback',
    anonKey: 'anon',
    fetchImpl: async (url, init) => {
      posted = { url, body: JSON.parse(init.body), headers: init.headers };
      return {
        ok: true,
        async json() {
          return {
            issueUrl: 'https://github.com/SigurdVilstrup/plenum/issues/99',
            issueNumber: 99,
            screenshot: false,
          };
        },
      };
    },
  });
  assert.equal(posted.body.omitScreenshot, true);
  assert.equal('pngBase64' in posted.body, false);
  assert.equal(posted.body.comment, 'relay text only');
  assert.equal('repoPath' in posted.body, false);
  assert.equal(meta.status, 'sent');
  assert.equal(meta.screenshot, false);
  assert.equal(fs.existsSync(out), false);
});

test('writeFeedbackReport dirs are unique under baseDir/feedback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const opts = {
    comment: 'hi',
    target: null,
    appVersion: '0.0.0',
    platform: 'darwin',
    repoPath: null,
    png: tinyPng,
    createdAt: '2026-11-09T00:00:00.000Z',
  };
  const a = await writeFeedbackReport(dir, opts);
  const b = await writeFeedbackReport(dir, opts);
  const root = path.resolve(dir, 'feedback') + path.sep;
  assert.ok(a.startsWith(root));
  assert.ok(b.startsWith(root));
  assert.notEqual(a, b);
  const metaA = JSON.parse(fs.readFileSync(path.join(a, 'meta.json'), 'utf8'));
  assert.equal(metaA.createdAt, '2026-11-09T00:00:00.000Z');
  assert.notEqual(path.basename(a), '2026-11-09T00-00-00.000Z');
});

test('sendFeedbackReport patches sent meta and never posts repoPath', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'lane truncates',
    target: null,
    appVersion: '0.2.0',
    platform: 'darwin',
    repoPath: '/Users/secret/repo',
    png: tinyPng,
  });
  let posted = null;
  const meta = await sendFeedbackReport(out, {
    endpoint: 'https://example.test/submit-feedback',
    anonKey: 'anon',
    fetchImpl: async (url, init) => {
      posted = { url, body: JSON.parse(init.body), headers: init.headers };
      return {
        ok: true,
        async json() {
          return {
            issueUrl: 'https://github.com/SigurdVilstrup/plenum/issues/12',
            issueNumber: 12,
          };
        },
      };
    },
  });
  assert.equal(posted.url, 'https://example.test/submit-feedback');
  assert.equal(posted.headers.Authorization, 'Bearer anon');
  assert.equal('repoPath' in posted.body, false);
  assert.equal(posted.body.comment, 'lane truncates');
  assert.equal(meta.status, 'sent');
  assert.equal(fs.existsSync(out), false);
  assert.equal(meta.issueNumber, 12);
  assert.match(meta.issueUrl, /plenum\/issues\/12/);
  assert.ok(meta.sentAt);
});

test('sendFeedbackReport marks failed on HTTP error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'x',
    appVersion: '0.0.0',
    platform: 'darwin',
    png: tinyPng,
  });
  await assert.rejects(
    () => sendFeedbackReport(out, {
      endpoint: 'https://example.test/submit-feedback',
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        async json() { return { error: 'Too many reports' }; },
      }),
    }),
    /Too many reports/,
  );
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'failed');
  assert.match(meta.error, /Too many/);
});

test('patchFeedbackMeta merges fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const out = await writeFeedbackReport(dir, {
    comment: 'x',
    appVersion: '0.0.0',
    platform: 'darwin',
    png: tinyPng,
  });
  const next = patchFeedbackMeta(out, { status: 'sent', issueNumber: 3 });
  assert.equal(next.status, 'sent');
  assert.equal(next.issueNumber, 3);
  assert.equal(next.comment, 'x');
});

test('sendCheckin posts rating + trimmed comment + env, no screenshot', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true }; };
  await sendCheckin(
    { rating: 'down', context: 'update', comment: '  slow  ' },
    { appVersion: '1.2.3', platform: 'darwin' },
    { endpoint: 'https://relay.test/x', fetchImpl },
  );
  assert.equal(sent.body.kind, 'checkin');
  assert.equal(sent.body.rating, 'down');
  assert.equal(sent.body.context, 'update');
  assert.equal(sent.body.comment, 'slow');
  assert.equal(sent.body.env.appVersion, '1.2.3');
  assert.equal('pngBase64' in sent.body, false);
});

test('sendCheckin rejects a missing rating and surfaces relay errors', async () => {
  const opts = { endpoint: 'https://relay.test/x', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'Slow down' }) }) };
  await assert.rejects(sendCheckin({ rating: 'meh' }, {}, opts), /rating/);
  await assert.rejects(sendCheckin({ rating: 'up' }, {}, opts), /Slow down/);
});

test('retryUnsentFeedback resends failed reports and stops at the first failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const mk = () => writeFeedbackReport(dir, { comment: 'x', appVersion: '0.0.0', platform: 'darwin', png: tinyPng });
  const a = await mk();
  const b = await mk();
  const ok = { ok: true, json: async () => ({ issueUrl: 'https://github.com/o/r/issues/1', issueNumber: 1, screenshot: false }) };
  const down = { ok: false, status: 500, json: async () => ({ error: 'db timeout' }) };
  const opts = (res) => ({ endpoint: 'https://example.test/s', fetchImpl: async () => res });
  assert.equal(await retryUnsentFeedback(dir, opts(down)), 0);
  // Same-millisecond ids sort either way: exactly one was tried before the stop.
  assert.deepEqual([a, b].map((d) => readFeedbackReport(d).meta.status).sort(), ['failed', 'pending']);
  assert.equal(await retryUnsentFeedback(dir, opts(ok)), 2);
  assert.equal(fs.existsSync(a) || fs.existsSync(b), false); // sent reports leave the queue
  assert.equal(await retryUnsentFeedback(dir, opts(ok)), 0); // already sent
});

test('a report in flight is not filed twice by the outbox flush (#110-#115)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  await writeFeedbackReport(dir, { comment: 'x', appVersion: '0.0.0', platform: 'darwin', png: tinyPng });
  const [name] = fs.readdirSync(path.join(dir, 'feedback'));
  let posts = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async () => {
    posts++;
    await gate;
    return { ok: true, json: async () => ({ issueUrl: 'https://github.com/o/r/issues/1', issueNumber: 1 }) };
  };
  const opts = { endpoint: 'https://example.test/s', fetchImpl };
  const button = sendFeedbackReport(path.join(dir, 'feedback', name), opts);
  assert.equal(await retryUnsentFeedback(dir, opts), 0);
  release();
  await button;
  assert.equal(posts, 1);
});

test('listUnsentFeedback shows waiting reports oldest first, flags expired, hides sent (#104)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plenum-fb-'));
  const old = await writeFeedbackReport(dir, { comment: 'old one', appVersion: '0', platform: 'darwin', png: tinyPng, createdAt: '2020-01-01T00:00:00Z' });
  const fresh = await writeFeedbackReport(dir, { comment: 'fresh\nmore', appVersion: '0', platform: 'darwin', png: tinyPng });
  const sent = await writeFeedbackReport(dir, { comment: 'gone', appVersion: '0', platform: 'darwin', png: tinyPng });
  patchFeedbackMeta(sent, { status: 'sent' });
  patchFeedbackMeta(fresh, { status: 'failed', error: 'db timeout' });
  const list = listUnsentFeedback(dir);
  assert.deepEqual(list.map((x) => x.comment).sort(), ['fresh\nmore', 'old one']);
  assert.equal(list.find((x) => x.comment === 'old one').expired, true);
  assert.equal(list.find((x) => x.comment.startsWith('fresh')).error, 'db timeout');
  assert.equal('png' in list[0] || 'repoPath' in list[0], false);
  assert.ok(old);
  assert.deepEqual(listUnsentFeedback(path.join(dir, 'nope')), []);
});
