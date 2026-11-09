export function visibleRefs(refs, { max = 2, currentBranch = null } = {}) {
  const list = refs || [];
  if (list.length <= max) return { shown: list, overflow: 0 };
  const cur = currentBranch ? list.find((r) => r.name === currentBranch) : null;
  if (cur && list.indexOf(cur) >= max) {
    return {
      shown: [cur, ...list.filter((r) => r !== cur).slice(0, max - 1)],
      overflow: list.length - max,
    };
  }
  return { shown: list.slice(0, max), overflow: list.length - max };
}
