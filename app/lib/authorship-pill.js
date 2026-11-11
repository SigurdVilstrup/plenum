import { aiToolPillIconHTML } from './ai-tool-badge.js';

const authorIcon = { human: 'user', assisted: 'sparkle', agent: 'robot', mixed: 'git-merge' };
const authorLabel = { human: 'Human', assisted: 'Assisted', agent: 'Agent', mixed: 'Mixed' };

function pillTitle(kind, tool) {
  if (tool) {
    if (kind === 'assisted') return `Assisted by ${tool}`;
    if (kind === 'agent') return `Agent: ${tool}`;
    if (kind === 'mixed') return `Mixed authorship (${tool})`;
  }
  return authorLabel[kind] || '';
}

/**
 * @param {string} kind
 * @param {string|null|undefined} tool
 * @param {(name: string, cls?: string) => string} iconFn
 */
export function authorshipPillHTML(kind, tool, iconFn) {
  if (!kind || kind === 'human' || !authorLabel[kind]) return '';
  const label = tool || authorLabel[kind];
  const title = pillTitle(kind, tool);
  const escTitle = String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const escLabel = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mark = aiToolPillIconHTML(tool) || iconFn(authorIcon[kind]);
  return `<span class="pill ${kind}" title="${escTitle}">${mark}${escLabel}</span>`;
}

export { authorIcon, authorLabel };
