#!/usr/bin/env node
/** Rebuild build/icon.icns (+ png) from planning/assets/app-icon-1024.png */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'planning/assets/app-icon-1024.png');
const outDir = path.join(root, 'build');
const iconset = path.join(outDir, 'icon.iconset');

if (!fs.existsSync(src)) {
  console.error(`missing ${src}`);
  process.exit(1);
}

fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });

// iconutil rejects 64×64 — Apple iconset is 16/32/128/256/512 (+ @2x)
const sizes = [16, 32, 128, 256, 512];
for (const s of sizes) {
  execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)]);
  execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)]);
}
fs.copyFileSync(src, path.join(iconset, 'icon_512x512@2x.png'));
fs.copyFileSync(src, path.join(outDir, 'icon.png'));
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });
console.log('wrote build/icon.icns and build/icon.png');
