/** Prefer one visible pill in the Branch/Tag lane; extras collapse to +N. */
export function visibleRefs(refs, { max = 1, currentBranch = null } = {}) {
  const list = refs || [];
  if (list.length <= max) return { shown: list, overflow: 0 };
  const cur = currentBranch ? list.find((r) => r.name === currentBranch) : null;
  if (cur) {
    const rest = list.filter((r) => r !== cur);
    const shown = [cur, ...rest.slice(0, Math.max(0, max - 1))];
    return { shown, overflow: list.length - shown.length };
  }
  return { shown: list.slice(0, max), overflow: list.length - max };
}
