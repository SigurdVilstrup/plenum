#!/usr/bin/env node
/** Rebuild build/icon.icns (+ png + ico) from branding/app-icon-1024.png */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'branding/app-icon-1024.png');
const outDir = path.join(root, 'build');
const iconset = path.join(outDir, 'icon.iconset');

if (!fs.existsSync(src)) {
  console.error(`missing ${src}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, path.join(outDir, 'icon.png'));

/** Write a multi-size ICO that embeds PNG payloads (Vista+). */
function writeIco(pngBuffers, dest) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];
  for (const png of pngBuffers) {
    entries.push({ png, bytes: png.length, offset });
    offset += png.length;
  }
  const buf = Buffer.alloc(offset);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(count, 4);
  let entryAt = 6;
  for (const e of entries) {
    // 0 width/height means 256 in the classic ICONDIRENTRY fields.
    buf.writeUInt8(0, entryAt);
    buf.writeUInt8(0, entryAt + 1);
    buf.writeUInt8(0, entryAt + 2);
    buf.writeUInt8(0, entryAt + 3);
    buf.writeUInt16LE(1, entryAt + 4);
    buf.writeUInt16LE(32, entryAt + 6);
    buf.writeUInt32LE(e.bytes, entryAt + 8);
    buf.writeUInt32LE(e.offset, entryAt + 12);
    entryAt += 16;
  }
  for (const e of entries) {
    e.png.copy(buf, e.offset);
  }
  fs.writeFileSync(dest, buf);
}

function resizePng(size, dest) {
  if (process.platform === 'darwin') {
    execFileSync('sips', ['-z', String(size), String(size), src, '--out', dest]);
    return;
  }
  // Non-Mac: reuse the master PNG for every slot (electron-builder still accepts it).
  fs.copyFileSync(src, dest);
}

const icoTmp = path.join(outDir, '.ico-tmp');
fs.rmSync(icoTmp, { recursive: true, force: true });
fs.mkdirSync(icoTmp, { recursive: true });
const icoSizes = [16, 32, 48, 256];
const pngs = [];
for (const s of icoSizes) {
  const p = path.join(icoTmp, `${s}.png`);
  resizePng(s, p);
  pngs.push(fs.readFileSync(p));
}
writeIco(pngs, path.join(outDir, 'icon.ico'));
fs.rmSync(icoTmp, { recursive: true, force: true });

if (process.platform === 'darwin') {
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  // iconutil rejects 64×64 — Apple iconset is 16/32/128/256/512 (+ @2x)
  const sizes = [16, 32, 128, 256, 512];
  for (const s of sizes) {
    execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)]);
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)]);
  }
  fs.copyFileSync(src, path.join(iconset, 'icon_512x512@2x.png'));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('wrote build/icon.icns, build/icon.ico, and build/icon.png');
} else {
  console.log('wrote build/icon.ico and build/icon.png (icns skipped: not macOS)');
}
