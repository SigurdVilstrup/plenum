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

function fmtHistoryAt(at) {
  if (!at) return '';
  try { return new Date(Number(at) * 1000).toLocaleDateString(); }
  catch { return ''; }
}

/** File history rows → HTML for `.file-history`. */
export function renderHistoryList(entries, activeSha = null) {
  if (!entries?.length) return '<div class="fx-empty">No history</div>';
  return entries.map((e) => {
    const on = activeSha && e.sha === activeSha ? ' on' : '';
    const when = fmtHistoryAt(e.at);
    return `<button type="button" class="file-history-row${on}" data-jump-sha="${esc(e.sha)}" title="${esc(e.subject)}">
      <span class="subj">${esc(e.subject)}</span>
      <span class="meta">${esc(e.author)}${when ? ` · ${esc(when)}` : ''} · <span class="sha">${esc(e.short)}</span></span>
    </button>`;
  }).join('');
}

/**
 * File text + grouped blame blocks → HTML for `.blame-body`.
 * One gutter label per contiguous same-sha block (not per line).
 */
export function renderBlameBody(text, blocks) {
  const lines = String(text ?? '').split('\n');
  // git show keeps a trailing newline → drop phantom empty last cell
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) return '<div class="fx-empty">Empty file</div>';
  if (!blocks?.length) {
    return `<div class="blame-body">${lines.map((t, i) =>
      `<div class="blame-line"><span class="blame-ln">${i + 1}</span><span class="blame-text">${esc(t)}</span></div>`
    ).join('')}</div>`;
  }
  return `<div class="blame-body">${blocks.map((b) => {
    const slice = lines.slice(b.startLine - 1, b.endLine);
    const meta = `${esc(b.short)} · ${esc(b.author)}`;
    return `<div class="blame-block" role="button" tabindex="0" data-jump-sha="${esc(b.sha)}" title="${esc(b.subject)}">
      <div class="blame-gutter">
        <div class="blame-meta">
          <span class="blame-head">${meta}</span>
          <span class="blame-subject">${esc(b.subject)}</span>
        </div>
      </div>
      <div class="blame-lines">${slice.map((t, i) =>
        `<div class="blame-line"><span class="blame-ln">${b.startLine + i}</span><span class="blame-text">${esc(t)}</span></div>`
      ).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}
