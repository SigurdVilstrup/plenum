/** Product marks for known AI tools (authorship badge + pill). */

/** Day-one tools with a brand mark, display order. */
export const AI_BADGE_TOOLS = ['Cursor', 'Claude', 'Codex', 'Copilot', 'Gemini', 'Muse', 'Windsurf', 'Devin', 'Aider'];

/** Static new URL() so Vite emits every asset (dynamic paths are dropped). */
const TOOL_URLS = {
  Cursor: { href: new URL('../ai-badges/cursor.png', import.meta.url).href, tone: 'light' },
  Claude: { href: new URL('../ai-badges/claude.png', import.meta.url).href, tone: 'light' },
  Codex: { href: new URL('../ai-badges/codex.svg', import.meta.url).href, tone: 'light' },
  Copilot: { href: new URL('../ai-badges/copilot.svg', import.meta.url).href, tone: 'dark' },
  Gemini: { href: new URL('../ai-badges/gemini.png', import.meta.url).href, tone: 'light' },
  Muse: { href: new URL('../ai-badges/muse.png', import.meta.url).href, tone: 'light' },
  Windsurf: { href: new URL('../ai-badges/windsurf.svg', import.meta.url).href, tone: 'light' },
  Devin: { href: new URL('../ai-badges/devin.png', import.meta.url).href, tone: 'light' },
  Aider: { href: new URL('../ai-badges/aider.png', import.meta.url).href, tone: 'light' },
};

/** @param {string|null|undefined} tool */
export function aiToolBadge(tool) {
  const t = String(tool || '');
  return TOOL_URLS[t] || null;
}

/** Absolute URL Vite/Node can resolve for a badge asset. */
export function aiToolBadgeUrl(tool) {
  return aiToolBadge(tool)?.href || '';
}

/**
 * Corner badge HTML for graph avatars. Empty when tool is unknown.
 * @param {string|null|undefined} tool
 */
export function aiToolBadgeHTML(tool) {
  const meta = aiToolBadge(tool);
  if (!meta) return '';
  const tone = meta.tone === 'dark' ? ' dark' : '';
  const esc = String(meta.href).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<span class="ai-badge${tone}" aria-hidden="true"><img src="${esc}" alt="" width="8" height="8" decoding="async" /></span>`;
}

/**
 * Inline mark for authorship pills (replaces sparkle/robot when known).
 * @param {string|null|undefined} tool
 */
export function aiToolPillIconHTML(tool) {
  const meta = aiToolBadge(tool);
  if (!meta) return '';
  const tone = meta.tone === 'dark' ? ' dark' : '';
  const esc = String(meta.href).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<span class="ai-pill-icon${tone}" aria-hidden="true"><img src="${esc}" alt="" width="12" height="12" decoding="async" /></span>`;
}

/**
 * Settings Appearance legend: sample avatars + tool names.
 * @param {(name: string, cls?: string) => string} [iconFn]
 */
export function authorshipBadgeLegendHTML(iconFn) {
  const samples = AI_BADGE_TOOLS.map((tool, i) => {
    const letter = tool[0];
    const hue = (i * 47 + 210) % 360;
    return `<div class="ab-sample" title="Assisted by ${tool}">
      <span class="who-mark">
        <span class="avatar" style="--avatar-hue:${hue}">${letter}</span>
        ${aiToolBadgeHTML(tool)}
      </span>
      <span class="ab-name">${tool}</span>
    </div>`;
  }).join('');
  const human = `<div class="ab-sample" title="Human, no badge">
    <span class="who-mark"><span class="avatar" style="--avatar-hue:210">H</span></span>
    <span class="ab-name">Human</span>
  </div>`;
  const pill = iconFn
    ? `<span class="pill assisted" title="Assisted by Cursor">${aiToolPillIconHTML('Cursor') || iconFn('sparkle')}Cursor</span>`
    : '';
  return `<div class="authorship-preview" aria-hidden="true">
    <div class="ab-row">${samples}${human}</div>
    ${pill ? `<div class="ab-pill-row"><span class="ab-label">Lane tip</span>${pill}</div>` : ''}
  </div>`;
}

export { TOOL_URLS };
