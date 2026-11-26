#!/usr/bin/env node
/**
 * Rebuild branding/app-icon-1024.png + build/icon.{png,ico,icns}
 * from branding/app-icon.svg.
 *
 * On macOS, Swift/AppKit renders the SVG onto a clear canvas so Dock corners
 * stay transparent. Non-Mac reuses the committed PNG but still refuses opaque
 * white corner pools (the failure mode that drew white triangles in the Dock).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgSrc = path.join(root, 'branding/app-icon.svg');
const masterPng = path.join(root, 'branding/app-icon-1024.png');
const swiftSrc = path.join(root, 'scripts/render-app-icon.swift');
const outDir = path.join(root, 'build');
const iconset = path.join(outDir, 'icon.iconset');
const MASTER_SIZE = 1024;

if (!fs.existsSync(svgSrc)) {
  console.error(`missing ${svgSrc}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

/** Decode an 8-bit RGBA PNG into { width, height, rgba }. */
function decodeRgbaPng(buf) {
  if (buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('not a PNG');
  }
  let off = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    off += 4;
    const type = buf.toString('ascii', off, off + 4);
    off += 4;
    const data = buf.subarray(off, off + len);
    off += len + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`expected 8-bit RGBA PNG, got depth=${bitDepth} type=${colorType}`);
  }
  const bpp = 4;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let o = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[o++];
    const scan = raw.subarray(o, o + stride);
    o += stride;
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let v = scan[i];
      if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(left, up, upLeft)) & 255;
      cur[i] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, rgba: out };
}

/** Encode filter-0 RGBA PNG. */
function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (type, data) => {
    let c = 0xffffffff;
    for (let i = 0; i < type.length; i++) c = crcTable[(c ^ type.charCodeAt(i)) & 255] ^ (c >>> 8);
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(type, data), 8 + data.length);
    return out;
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function cornerAlphaOk(rgba, width, height) {
  const spots = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [8, 8],
    [width - 9, 8],
    [8, height - 9],
    [width - 9, height - 9],
  ];
  for (const [x, y] of spots) {
    if (rgba[(y * width + x) * 4 + 3] !== 0) return false;
  }
  return true;
}

/** rx from the tile rect in branding/app-icon.svg (scaled to size). */
function tileCornerRadius(size) {
  const svg = fs.readFileSync(svgSrc, 'utf8');
  const m = svg.match(/<rect\b[^>]*\brx="(\d+)"/);
  const rxMaster = m ? Number(m[1]) : 228;
  return (rxMaster / MASTER_SIZE) * size;
}

/** Clear pixels outside the rounded tile so white export corners cannot ship. */
function punchTransparentCorners(rgba, width, height) {
  const rx = tileCornerRadius(width);
  const ry = tileCornerRadius(height);
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x + 0.5, rx), width - rx);
    const cy = Math.min(Math.max(y + 0.5, ry), height - ry);
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= rx * ry;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) {
        const i = (y * width + x) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      }
    }
  }
}

function renderMasterFromSvg() {
  const bin = path.join(outDir, '.render-app-icon');
  execFileSync('swiftc', ['-O', swiftSrc, '-o', bin], { stdio: 'inherit' });
  try {
    execFileSync(bin, [svgSrc, masterPng, String(MASTER_SIZE)], { stdio: 'inherit' });
  } finally {
    fs.rmSync(bin, { force: true });
  }
}

if (process.platform === 'darwin') {
  if (!fs.existsSync(swiftSrc)) {
    console.error(`missing ${swiftSrc}`);
    process.exit(1);
  }
  renderMasterFromSvg();
} else if (!fs.existsSync(masterPng)) {
  console.error(`missing ${masterPng} (render on macOS first: npm run icons)`);
  process.exit(1);
}

{
  const decoded = decodeRgbaPng(fs.readFileSync(masterPng));
  if (decoded.width !== MASTER_SIZE || decoded.height !== MASTER_SIZE) {
    console.error(`expected ${MASTER_SIZE}×${MASTER_SIZE} master, got ${decoded.width}×${decoded.height}`);
    process.exit(1);
  }
  if (!cornerAlphaOk(decoded.rgba, decoded.width, decoded.height)) {
    console.warn('master had opaque corners — punching transparent corner pools to match the SVG tile');
    punchTransparentCorners(decoded.rgba, decoded.width, decoded.height);
    fs.writeFileSync(masterPng, encodeRgbaPng(decoded.width, decoded.height, decoded.rgba));
  }
  if (!cornerAlphaOk(decodeRgbaPng(fs.readFileSync(masterPng)).rgba, MASTER_SIZE, MASTER_SIZE)) {
    console.error('icon master still has opaque corners after punch; refusing to ship Dock-breaking assets');
    process.exit(1);
  }
}

const src = masterPng;
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
  console.log('wrote branding/app-icon-1024.png, build/icon.icns, build/icon.ico, and build/icon.png');
} else {
  console.log('wrote build/icon.ico and build/icon.png (icns skipped: not macOS)');
}
