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

/** Gravatar URL from a SHA-256 email hash. `d=404` so missing faces fall back to the letter glyph. */
export function gravatarUrl(hash, size = 36) {
  const h = String(hash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h)) return '';
  const s = Math.max(1, Math.min(512, Number(size) || 36));
  return `https://www.gravatar.com/avatar/${h}?s=${s}&d=404`;
}
