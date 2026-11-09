/** Escape git-sourced strings before innerHTML. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function diffLineMark(type) {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

/** Unified diff hunks → HTML for `.file-pane-diff`. */
export function renderDiffBody(hunks) {
  if (!hunks?.length) return '<div class="fx-empty">No textual changes</div>';
  return hunks.map((h) => `
    <div class="diff-hunk">
      <div class="diff-hunk-head">${esc(h.header)}</div>
      ${h.lines.map((l) =>
        `<div class="diff-line ${esc(l.type)}"><span class="diff-mark">${diffLineMark(l.type)}</span>${esc(l.text)}</div>`
      ).join('')}
    </div>`).join('');
}
