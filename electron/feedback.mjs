import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
