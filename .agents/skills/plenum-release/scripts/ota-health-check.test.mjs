import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmpSemver, parseLatestMacYml, PUBLIC_FEED_URL } from './ota-health-check.mjs';

test('PUBLIC_FEED_URL is plenum.sh updates', () => {
  assert.equal(PUBLIC_FEED_URL, 'https://plenum.sh/updates/');
});

test('cmpSemver orders versions', () => {
  assert.equal(cmpSemver('0.2.21', '0.2.20'), 1);
  assert.equal(cmpSemver('0.2.20', '0.2.21'), -1);
  assert.equal(cmpSemver('0.2.21', '0.2.21'), 0);
  assert.equal(cmpSemver('v1.0.0', '1.0.0'), 0);
});

test('parseLatestMacYml reads electron-builder feed', () => {
  const yml = `version: 0.2.21
files:
  - url: Plenum-0.2.21-arm64-mac.zip
    sha512: abc
    size: 12
  - url: Plenum-0.2.21-arm64.dmg
    sha512: def
    size: 34
path: Plenum-0.2.21-arm64-mac.zip
sha512: abc
releaseDate: '2026-11-23T16:44:16.398Z'
`;
  const p = parseLatestMacYml(yml);
  assert.equal(p.version, '0.2.21');
  assert.equal(p.path, 'Plenum-0.2.21-arm64-mac.zip');
  assert.equal(p.sha512, 'abc');
  assert.equal(p.files.length, 2);
  assert.equal(p.files[0].url, 'Plenum-0.2.21-arm64-mac.zip');
});
