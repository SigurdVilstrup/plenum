import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  imageNameScore,
  listRepoImages,
  readRepoFaviconDataUrl,
  repoImageFileUrl,
} from './repo-favicon.mjs';

function tmpRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-favicon-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

test('readRepoFaviconDataUrl returns null when nothing matches', () => {
  const dir = tmpRepo({ 'README.md': '# hi' });
  assert.equal(readRepoFaviconDataUrl(dir), null);
});

test('readRepoFaviconDataUrl prefers root favicon.ico', () => {
  const dir = tmpRepo({
    'favicon.ico': Buffer.from([0, 0, 1, 0]),
    'public/favicon.png': Buffer.from([1, 2, 3]),
  });
  const url = readRepoFaviconDataUrl(dir);
  assert.match(url, /^data:image\/x-icon;base64,/);
});

test('readRepoFaviconDataUrl finds public/favicon.svg', () => {
  const dir = tmpRepo({ 'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  const url = readRepoFaviconDataUrl(dir);
  assert.match(url, /^data:image\/svg\+xml;base64,/);
});

test('readRepoFaviconDataUrl skips oversized files', () => {
  const dir = tmpRepo({ 'favicon.png': Buffer.alloc(80 * 1024, 1) });
  assert.equal(readRepoFaviconDataUrl(dir), null);
});

test('readRepoFaviconDataUrl ignores symlinks that escape the repo', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-favicon-out-'));
  const target = path.join(outside, 'secret.ico');
  fs.writeFileSync(target, Buffer.from([0, 0, 1, 0]));
  const dir = tmpRepo();
  fs.symlinkSync(target, path.join(dir, 'favicon.ico'));
  assert.equal(readRepoFaviconDataUrl(dir), null);
});

test('readRepoFaviconDataUrl skips oversized symlink targets', () => {
  const dir = tmpRepo({ 'big.png': Buffer.alloc(80 * 1024, 1) });
  fs.symlinkSync(path.join(dir, 'big.png'), path.join(dir, 'favicon.png'));
  assert.equal(readRepoFaviconDataUrl(dir), null);
});

test('imageNameScore prefers logo/icon/glyph names', () => {
  assert.ok(imageNameScore('assets/logo.png') > imageNameScore('assets/photo.png'));
  assert.ok(imageNameScore('icon.svg') > imageNameScore('shot.jpg'));
  assert.ok(imageNameScore('brand/glyph.png') > imageNameScore('docs/diagram.png'));
});

test('listRepoImages lists png/jpeg/svg, suggests logo names, no size/square filter', () => {
  const dir = tmpRepo({
    'photo.png': Buffer.alloc(100 * 1024, 2),
    'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'wide.jpg': Buffer.alloc(8, 3),
    'docs/note.txt': 'x',
  });
  const list = listRepoImages(dir);
  const rels = list.map((x) => x.rel);
  assert.deepEqual(rels.sort(), ['assets/logo.svg', 'photo.png', 'wide.jpg'].sort());
  const logo = list.find((x) => x.rel === 'assets/logo.svg');
  assert.equal(logo.suggested, true);
  assert.ok(logo.score > list.find((x) => x.rel === 'photo.png').score);
  assert.match(logo.fileUrl, /^plenum-img:\/\//);
  assert.equal(list[0].rel, 'assets/logo.svg'); // highest score first
});

test('listRepoImages skips node_modules', () => {
  const dir = tmpRepo({
    'ok.png': Buffer.from([1]),
    'node_modules/pkg/icon.png': Buffer.from([1]),
  });
  const list = listRepoImages(dir);
  assert.deepEqual(list.map((x) => x.rel), ['ok.png']);
});

test('repoImageFileUrl rejects path escape', () => {
  const dir = tmpRepo({ 'ok.png': Buffer.from([1]) });
  assert.equal(repoImageFileUrl(dir, '../ok.png'), null);
  assert.match(repoImageFileUrl(dir, 'ok.png'), /^plenum-img:\/\//);
});
