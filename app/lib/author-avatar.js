/** First grapheme of the author name (or `?`). */
export function authorInitial(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  return [...s][0].toLocaleUpperCase();
}

/** Stable hue 0–359 from name/email for letter-avatar wash. */
export function authorHue(key) {
  let h = 2166136261;
  for (const c of String(key || '')) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
