/**
 * Git-style graph column packing.
 * Input: commits newest-first (board history: `git log --date-order`).
 * Each commit: `{ id, parents: string[] }` (parents[0] = first parent).
 * Returns Map id → column index (0-based, left-packed).
 */
export function assignColumns(commits) {
  const cols = new Map();
  // active[i] = commit id expected next in that column, or null if free.
  // ponytail: O(n·w) ≈ O(n²) when width grows with n; fine for ≤120-row window. Upgrade: segment tree / free-list if window grows.
  const active = [];

  function alloc(id) {
    let i = active.indexOf(null);
    if (i === -1) {
      i = active.length;
      active.push(id);
    } else {
      active[i] = id;
    }
    return i;
  }

  for (const commit of commits) {
    const id = commit.id;
    let col = active.indexOf(id);
    if (col === -1) col = alloc(id);

    for (let i = 0; i < active.length; i++) {
      if (i !== col && active[i] === id) active[i] = null;
    }

    cols.set(id, col);

    const parents = commit.parents?.filter(Boolean) ?? [];
    if (parents.length === 0) {
      active[col] = null;
      continue;
    }

    active[col] = parents[0];
    for (let i = 1; i < parents.length; i++) {
      if (active.indexOf(parents[i]) === -1) alloc(parents[i]);
    }
  }

  return cols;
}
