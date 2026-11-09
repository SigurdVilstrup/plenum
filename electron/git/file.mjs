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
    else if (raw.startsWith(' ')) cur.lines.push({ type: 'ctx', text: raw.slice(1) });
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

/**
 * Recent commits that touched `filePath` (follows renames).
 * Shape: [{ sha, short, author, at, subject }, ...]
 */
export async function loadFileHistory(repoPath, filePath) {
  const cwd = path.resolve(repoPath);
  const safe = assertSafeRepoPath(filePath);
  const raw = await git(
    ['log', '--follow', '-n', '50', '--format=%H%x1f%h%x1f%an%x1f%at%x1f%s', '--', safe],
    cwd,
  );
  return String(raw || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, short, author, at, subject] = line.split('\x1f');
      return { sha, short, author, at: Number(at), subject };
    });
}

/**
 * Parse `git blame -p` into contiguous same-commit blocks.
 * Headers (author/summary) appear once per commit; later lines only have the sha header.
 */
export function parseBlamePorcelain(porcelain) {
  const meta = new Map(); // sha -> { author, subject }
  const blocks = [];
  let cur = null;

  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  for (const raw of String(porcelain || '').split('\n')) {
    if (raw.startsWith('\t')) continue;
    const m = /^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/i.exec(raw);
    if (m) {
      const sha = m[1];
      const startLine = Number(m[3]);
      const info = meta.get(sha) || { author: '', subject: '' };
      if (cur && cur.sha === sha && startLine === cur.endLine + 1) {
        cur.endLine = startLine;
      } else {
        flush();
        cur = {
          sha,
          short: sha.slice(0, 7),
          author: info.author,
          subject: info.subject,
          startLine,
          endLine: startLine,
        };
      }
      continue;
    }
    if (raw.startsWith('author ')) {
      const sha = cur?.sha;
      if (!sha) continue;
      const author = raw.slice(7);
      const prev = meta.get(sha) || { author: '', subject: '' };
      meta.set(sha, { ...prev, author });
      if (cur) cur.author = author;
      continue;
    }
    if (raw.startsWith('summary ')) {
      const sha = cur?.sha;
      if (!sha) continue;
      const subject = raw.slice(8);
      const prev = meta.get(sha) || { author: '', subject: '' };
      meta.set(sha, { ...prev, subject });
      if (cur) cur.subject = subject;
    }
  }
  flush();
  return blocks;
}

/** Blame blocks for `filePath` as of commit `sha`. */
export async function loadFileBlame(repoPath, sha, filePath) {
  const cwd = path.resolve(repoPath);
  const id = String(sha || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(id)) throw new Error('Invalid commit.');
  const safe = assertSafeRepoPath(filePath);
  const full = (await git(['rev-parse', id], cwd)).trim();
  const porcelain = await git(['blame', '-p', full, '--', safe], cwd);
  return { sha: full, path: safe, blocks: parseBlamePorcelain(porcelain) };
}

/** Full file text at `sha:path` (`git show`). */
export async function loadFileShow(repoPath, sha, filePath) {
  const cwd = path.resolve(repoPath);
  const id = String(sha || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(id)) throw new Error('Invalid commit.');
  const safe = assertSafeRepoPath(filePath);
  const full = (await git(['rev-parse', id], cwd)).trim();
  const text = await git(['show', `${full}:${safe}`], cwd);
  return { sha: full, path: safe, text: String(text ?? '') };
}
