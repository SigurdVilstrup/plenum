import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

// #5e6ad2 ≈ --primary; fill 25%, border stronger
const HL_R = 0x5e;
const HL_G = 0x6a;
const HL_B = 0xd2;
const FILL_A = 0.25;
const BORDER_A = 0.7;
const BORDER_PX = 2;

/** Blend lavender highlight into PNG. scaleX/Y map CSS rect → capture pixels. */
export function paintHighlight(pngBuffer, rect, { scaleX = 1, scaleY = 1 } = {}) {
  // ponytail: BGRA blend; drop if Electron gains a canvas/compositor API we prefer
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(pngBuffer);
  const { width, height } = img.getSize();
  const bitmap = Buffer.from(img.toBitmap()); // BGRA copy

  const x0 = Math.max(0, Math.floor(Number(rect.x) * scaleX));
  const y0 = Math.max(0, Math.floor(Number(rect.y) * scaleY));
  const x1 = Math.min(width, Math.ceil((Number(rect.x) + Number(rect.w)) * scaleX));
  const y1 = Math.min(height, Math.ceil((Number(rect.y) + Number(rect.h)) * scaleY));
  if (x1 <= x0 || y1 <= y0) return pngBuffer;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const onBorder =
        x < x0 + BORDER_PX || x >= x1 - BORDER_PX || y < y0 + BORDER_PX || y >= y1 - BORDER_PX;
      const a = onBorder ? BORDER_A : FILL_A;
      const i = (y * width + x) * 4;
      bitmap[i] = Math.round(bitmap[i] * (1 - a) + HL_B * a);
      bitmap[i + 1] = Math.round(bitmap[i + 1] * (1 - a) + HL_G * a);
      bitmap[i + 2] = Math.round(bitmap[i + 2] * (1 - a) + HL_R * a);
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}

export function buildMeta(input) {
  const target = input.target
    ? {
        label: String(input.target.label ?? ''),
        rect: {
          x: Number(input.target.rect.x),
          y: Number(input.target.rect.y),
          w: Number(input.target.rect.w),
          h: Number(input.target.rect.h),
        },
      }
    : null;
  return {
    version: 1,
    createdAt: input.createdAt || new Date().toISOString(),
    comment: String(input.comment || '').trim(),
    target,
    appVersion: input.appVersion,
    platform: input.platform,
    repoPath: input.repoPath ?? null,
  };
}

export async function writeFeedbackReport(baseDir, opts) {
  const now = new Date().toISOString();
  const id = `${now.replace(/:/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const feedbackRoot = path.resolve(baseDir, 'feedback');
  const dir = path.resolve(feedbackRoot, id);
  if (!dir.startsWith(feedbackRoot + path.sep)) throw new Error('bad report path');
  fs.mkdirSync(dir, { recursive: true });
  const meta = buildMeta({ ...opts, createdAt: opts.createdAt || now });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'window.png'), opts.png);
  return dir;
}
