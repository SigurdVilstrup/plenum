import fs from 'node:fs';
import path from 'node:path';

/**
 * Watch a repo's .git (and worktree gitdir) so the UI can refresh as soon as
 * commits / checkouts / index changes land — even when Plenum is in the background (#99).
 */

const watchers = new Map(); // root → { watchers: FSWatcher[], timer, onChange }
const DEBOUNCE_MS = 350;

function gitDir(root) {
  const gitPath = path.join(root, '.git');
  try {
    const st = fs.statSync(gitPath);
    if (st.isDirectory()) return gitPath;
    // worktree: .git is a file "gitdir: /path/to/main/.git/worktrees/name"
    const raw = fs.readFileSync(gitPath, 'utf8');
    const m = raw.match(/gitdir:\s*(.+)/i);
    if (m) return path.resolve(root, m[1].trim());
  } catch { /* missing */ }
  return null;
}

function watchPaths(root) {
  const dir = gitDir(root);
  if (!dir) return [];
  const out = [dir, path.join(dir, 'refs'), path.join(dir, 'HEAD'), path.join(dir, 'index')];
  // Common worktree pointers live under the main .git
  const wt = path.join(dir, 'worktrees');
  if (fs.existsSync(wt)) out.push(wt);
  return out.filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

export function watchRepo(root, onChange) {
  if (!root) return () => {};
  stopWatch(root);
  const paths = watchPaths(root);
  if (!paths.length) return () => {};

  const entry = { watchers: [], timer: null, onChange };
  const fire = () => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      try { entry.onChange?.(root); } catch { /* swallow */ }
    }, DEBOUNCE_MS);
  };

  for (const p of paths) {
    try {
      const w = fs.watch(p, { persistent: false }, fire);
      w.on('error', () => {});
      entry.watchers.push(w);
    } catch { /* some volumes refuse watch */ }
  }
  watchers.set(root, entry);
  return () => stopWatch(root);
}

export function stopWatch(root) {
  const entry = watchers.get(root);
  if (!entry) return;
  clearTimeout(entry.timer);
  for (const w of entry.watchers) {
    try { w.close(); } catch { /* already closed */ }
  }
  watchers.delete(root);
}

export function stopAllWatches() {
  for (const root of [...watchers.keys()]) stopWatch(root);
}
