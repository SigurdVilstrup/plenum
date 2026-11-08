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
  const id = (opts.createdAt || new Date().toISOString()).replace(/:/g, '-');
  const dir = path.join(baseDir, 'feedback', id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = buildMeta(opts);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'window.png'), opts.png);
  return dir;
}
