export function visibleRefs(refs, { max = 2 } = {}) {
  const list = refs || [];
  if (list.length <= max) return { shown: list, overflow: 0 };
  return { shown: list.slice(0, max), overflow: list.length - max };
}
