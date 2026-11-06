/* Shared mock behavior: theme, command palette, live sync tick. */

// Theme: first load follows the OS, then the toggle persists.
(function theme() {
  const saved = localStorage.getItem('overlook-theme');
  const os = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const fromUrl = new URLSearchParams(location.search).get('theme');
  document.documentElement.dataset.theme = fromUrl || saved || os;

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    const paint = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      btn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${dark ? 'sun' : 'moon'}"></use></svg>`;
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    };
    btn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('overlook-theme', next);
      paint();
    });
    paint();
  });
})();

// Command palette: Cmd+K or Cmd+P, Esc closes. ?palette=<query> opens it pre-filled.
(function palette() {
  const staticLanes = [
    { g: 'Lanes', icon: 'tree-structure', label: 'feat/search-filters', hint: '.worktrees/search-filters' },
    { g: 'Lanes', icon: 'tree-structure', label: 'feat/export-csv', hint: '.worktrees/export-csv' },
    { g: 'Lanes', icon: 'tree-structure', label: 'fix/flaky-upload', hint: '.worktrees/flaky-upload' },
    { g: 'Lanes', icon: 'tree-structure', label: 'feat/invoice-pdf', hint: '.worktrees/invoice-pdf-2' },
  ];
  // Lanes come from the active board scenario when one is loaded.
  const laneItems = () => {
    const sc = window.OverlookScenarios?.[new URLSearchParams(location.search).get('scenario')] || window.OverlookScenarios?.normal;
    return sc ? sc.lanes.map((l) => ({ g: 'Lanes', icon: 'tree-structure', label: l.name, hint: l.folder })) : staticLanes;
  };
  const rest = [
    { g: 'Branches', icon: 'git-branch', label: 'main', hint: 'protected' },
    { g: 'Branches', icon: 'git-branch', label: 'fix/session-expiry', hint: 'merged, no worktree' },
    { g: 'Branches', icon: 'git-branch', label: 'chore/eslint-9', hint: 'no worktree' },
    { g: 'Files in feat/search-filters', icon: 'files', label: 'src/search/FacetChips.tsx', hint: 'modified' },
    { g: 'Files in feat/search-filters', icon: 'files', label: 'src/search/useSearchQuery.ts', hint: 'modified' },
    { g: 'Files in feat/search-filters', icon: 'files', label: 'src/search/query.test.ts', hint: 'new' },
    { g: 'Repos', icon: 'folder-simple', label: 'Mobaro Web', hint: '~/Dev/mobaro-web' },
    { g: 'Repos', icon: 'folder-simple', label: 'mobaro-core', hint: '~/Dev/mobaro-core' },
    { g: 'Commands', icon: 'plus', label: 'New lane from main', hint: '⌘N' },
    { g: 'Commands', icon: 'play', label: 'Run selected lane', hint: '⌘R' },
    { g: 'Commands', icon: 'stop', label: 'Stop selected lane', hint: '⌘.' },
    { g: 'Commands', icon: 'flask', label: 'Run tests in selected lane', hint: '⌘U' },
    { g: 'Commands', icon: 'globe-simple', label: 'Open web :5101', hint: 'feat/search-filters' },
    { g: 'Commands', icon: 'stethoscope', label: 'Lane setup: check this repo', hint: 'setup.html', href: 'setup.html' },
    { g: 'Commands', icon: 'arrow-square-out', label: 'Open selected lane in Cursor', hint: '⌘O' },
    { g: 'Commands', icon: 'arrows-clockwise', label: 'Sync now', hint: '⇧⌘R' },
    { g: 'Commands', icon: 'pencil-simple', label: 'Rename repo tab' },
    { g: 'Commands', icon: 'moon', label: 'Switch theme' },
    { g: 'Pages', icon: 'git-commit', label: 'Board', hint: 'board.html', href: 'board.html' },
    { g: 'Pages', icon: 'gear-six', label: 'Settings: Integrations', hint: 'settings.html', href: 'settings.html' },
    { g: 'Pages', icon: 'folder-simple', label: 'Settings: Repositories', hint: 'settings.html?page=repositories', href: 'settings.html?page=repositories' },
  ];

  const fuzzy = (q, s) => {
    // Subsequence match; returns highlighted html or null.
    if (!q) return s;
    let qi = 0;
    let out = '';
    const lq = q.toLowerCase();
    for (const ch of s) {
      if (qi < lq.length && ch.toLowerCase() === lq[qi]) {
        out += `<mark>${ch}</mark>`;
        qi += 1;
      } else out += ch;
    }
    return qi === lq.length ? out : null;
  };

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const icon = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"></use></svg>`;

  document.addEventListener('DOMContentLoaded', () => {
    const layer = document.querySelector('.palette-layer');
    if (!layer) return;
    const input = layer.querySelector('input');
    const results = layer.querySelector('.results');

    const render = () => {
      const q = input.value.trim();
      let html = '';
      let group = '';
      let first = true;
      [...laneItems(), ...rest].forEach((it) => {
        const hit = fuzzy(q, esc(it.label));
        if (hit == null) return;
        if (it.g !== group) {
          group = it.g;
          html += `<div class="group">${group}</div>`;
        }
        const hintCls = it.hint && /[\/.~]/.test(it.hint) ? 'hint mono' : 'hint';
        html += `<div class="item${first ? ' active' : ''}">${icon(it.icon)}<span>${hit}</span><span class="${hintCls}">${it.hint || ''}</span></div>`;
        first = false;
      });
      results.innerHTML = html || `<div class="empty">No matches for "${esc(q)}"</div>`;
    };

    const open = (q = '') => {
      layer.classList.add('open');
      input.value = q;
      render();
      input.focus();
      input.setSelectionRange(q.length, q.length);
    };
    const close = () => layer.classList.remove('open');

    input.addEventListener('input', render);
    layer.addEventListener('click', (e) => e.target === layer && close());
    document.querySelectorAll('[data-palette-open]').forEach((b) => b.addEventListener('click', () => open()));
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        layer.classList.contains('open') ? close() : open();
      } else if (e.key === 'Escape' && layer.classList.contains('open')) close();
    });

    const pre = new URLSearchParams(location.search).get('palette');
    if (pre != null) open(pre);
  });
})();

// Live sync tick: every field is a subscription, so the sync readout just moves on its own.
(function liveTick() {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('[data-live-since]');
    if (!el) return;
    let s = 0;
    setInterval(() => {
      s += 1;
      el.textContent = s < 60 ? `synced ${s}s ago` : `synced ${Math.floor(s / 60)}m ago`;
    }, 1000);
  });
})();
