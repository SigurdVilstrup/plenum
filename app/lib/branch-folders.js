/** Group `a/b/c` into expandable folders by first path segment. */
export function groupBranchesByPrefix(branches) {
  const singles = [];
  const folders = new Map();
  for (const br of branches) {
    const short = br.short || String(br.name || '').replace(/^origin\//, '');
    const i = short.indexOf('/');
    if (i > 0) {
      const folder = short.slice(0, i);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push({ br, label: short.slice(i + 1) });
    } else {
      singles.push({ br, label: short });
    }
  }
  return { singles, folders };
}
