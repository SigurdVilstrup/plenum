import path from 'node:path';
import { git } from './run.mjs';

/**
 * Diff of one file at a commit.
 *
 * Shape:
 * {
 *   sha: string,   // full
 *   path: string,
 *   hunks: Array<{
 *     header: string,  // e.g. "@@ -1,1 +1,2 @@"
 *     lines: Array<{ type: 'add'|'del'|'ctx', text: string }>
 *   }>
 * }
 */

/** Reject absolute paths and `..` segments before calling git. */
export function assertSafeRepoPath(filePath) {
  const p = String(filePath ?? '').replace(/\\/g, '/');
  if (!p || path.isAbsolute(p) || p.split('/').includes('..') || p.startsWith('-')) {
    throw new Error('Invalid path.');
  }
  return p;
}

function parseUnifiedHunks(patch) {
  const hunks = [];
  let cur = null;
  for (const raw of String(patch || '').split(/\n/)) {
    if (raw.startsWith('@@')) {
      cur = { header: raw.replace(/\s*$/, ''), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('+')) cur.lines.push({ type: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) cur.lines.push({ type: 'del', text: raw.slice(1) });
    else if (raw.startsWith(' ') || raw === '') cur.lines.push({ type: 'ctx', text: raw.slice(1) });
    // skip "\ No newline at end of file" and diff headers
  }
  return hunks;
}

/** Unified diff hunks for `filePath` as of commit `sha`. */
export async function loadFileDiff(repoPath, sha, filePath) {
  const cwd = path.resolve(repoPath);
  const id = String(sha || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(id)) throw new Error('Invalid commit.');
  const safe = assertSafeRepoPath(filePath);
  const full = (await git(['rev-parse', id], cwd)).trim();
  // --format= drops commit message; patch only for this path
  const patch = await git(['show', '--format=', '--unified=3', full, '--', safe], cwd);
  return { sha: full, path: safe, hunks: parseUnifiedHunks(patch) };
}
