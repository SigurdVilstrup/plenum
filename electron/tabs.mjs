import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { listRepoImages, readRepoFaviconDataUrl, repoImageFileUrl } from './repo-favicon.mjs';

const ICONS = [
  'folder-simple', 'tree-structure', 'git-branch', 'git-commit',
  'sparkle', 'robot', 'shield-check', 'files', 'flask', 'database',
  'gear-six', 'command',
];

function storePath() {
  return path.join(app.getPath('userData'), 'tabs.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return { tabs: [], activeId: null };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2));
}

/** Attach a displayable favicon URL (data: or file:) without persisting file URLs. */
function hydrateTab(tab) {
  if (tab.favicon && String(tab.favicon).startsWith('data:')) return tab;
  if (tab.faviconRel) {
    const fileUrl = repoImageFileUrl(tab.path, tab.faviconRel);
    if (fileUrl) return { ...tab, favicon: fileUrl };
  }
  return tab;
}

function hydrate(data) {
  return { ...data, tabs: data.tabs.map(hydrateTab) };
}

function applyFavicon(tab, enabled) {
  // Manual preset or custom image - leave alone.
  if (tab.iconManual) return;
  tab.faviconRel = null;
  if (!enabled) {
    tab.favicon = null;
    return;
  }
  tab.favicon = readRepoFaviconDataUrl(tab.path);
}

export function listTabs() {
  return hydrate(read());
}

export function openTab(repoPath, title, { favicons = true } = {}) {
  const data = read();
  const abs = path.resolve(repoPath);
  const existing = data.tabs.find((t) => t.path === abs);
  if (existing) {
    data.activeId = existing.id;
    applyFavicon(existing, favicons);
    write(data);
    return hydrate(data);
  }
  const tab = {
    id: randomUUID(),
    path: abs,
    title: title || path.basename(abs),
    icon: 'folder-simple',
    iconManual: false,
    favicon: null,
    faviconRel: null,
  };
  applyFavicon(tab, favicons);
  data.tabs.push(tab);
  data.activeId = tab.id;
  write(data);
  return hydrate(data);
}

export function selectTab(id) {
  const data = read();
  if (!data.tabs.some((t) => t.id === id)) throw new Error('Tab not found.');
  data.activeId = id;
  write(data);
  return hydrate(data);
}

export function closeTab(id) {
  const data = read();
  const i = data.tabs.findIndex((t) => t.id === id);
  if (i < 0) return hydrate(data);
  data.tabs.splice(i, 1);
  if (data.activeId === id) {
    data.activeId = data.tabs[Math.min(i, data.tabs.length - 1)]?.id ?? null;
  }
  write(data);
  return hydrate(data);
}

function setTabIcon(tab, icon) {
  if (icon === 'auto') {
    tab.iconManual = false;
    tab.faviconRel = null;
    tab.favicon = readRepoFaviconDataUrl(tab.path);
    return;
  }
  tab.icon = ICONS.includes(icon) ? icon : 'folder-simple';
  tab.iconManual = true;
  tab.favicon = null;
  tab.faviconRel = null;
}

/** List PNG / JPEG / SVG in the tab's checkout for the picker. */
export function listTabImages(id) {
  const data = read();
  const tab = data.tabs.find((t) => t.id === id);
  if (!tab) throw new Error('Tab not found.');
  return listRepoImages(tab.path);
}

/** Set a custom image (repo-relative path) as the tab glyph. */
export function setTabImage(id, relPath) {
  const data = read();
  const tab = data.tabs.find((t) => t.id === id);
  if (!tab) throw new Error('Tab not found.');
  const fileUrl = repoImageFileUrl(tab.path, relPath);
  if (!fileUrl) throw new Error('No image found (PNG, JPEG, or SVG under the repo).');
  tab.iconManual = true;
  tab.favicon = null;
  tab.faviconRel = String(relPath).replace(/\\/g, '/').replace(/^[/\\]+/, '');
  write(data);
  return hydrate(data);
}

export function renameTab(id, title, icon) {
  const data = read();
  const tab = data.tabs.find((t) => t.id === id);
  if (!tab) throw new Error('Tab not found.');
  const trimmed = String(title || '').trim();
  tab.title = trimmed || path.basename(tab.path);
  if (icon != null) setTabIcon(tab, icon);
  write(data);
  return hydrate(data);
}

export function setIcon(id, icon) {
  const data = read();
  const tab = data.tabs.find((t) => t.id === id);
  if (!tab) throw new Error('Tab not found.');
  setTabIcon(tab, icon);
  write(data);
  return hydrate(data);
}

/** Re-scout favicons for tabs that still use auto icons. */
export function refreshFavicons(enabled = true) {
  const data = read();
  for (const tab of data.tabs) applyFavicon(tab, enabled);
  write(data);
  return hydrate(data);
}

export function reorderTabs(orderedIds) {
  const data = read();
  const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
  if (ids.length !== data.tabs.length) throw new Error('Invalid tab order.');
  const byId = new Map(data.tabs.map((t) => [t.id, t]));
  if (ids.some((id) => !byId.has(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid tab order.');
  }
  data.tabs = ids.map((id) => byId.get(id));
  write(data);
  return hydrate(data);
}

/** Put a tab back (undo of close) or overwrite its look (undo of rename/icon). Active tab is unchanged. */
export function restoreTab(snap, index) {
  const data = read();
  const tab = {
    id: String(snap?.id || ''),
    path: String(snap?.path || ''),
    title: String(snap?.title || '').trim() || path.basename(String(snap?.path || '')),
    icon: ICONS.includes(snap?.icon) ? snap.icon : 'folder-simple',
    iconManual: Boolean(snap?.iconManual),
    favicon: String(snap?.favicon || '').startsWith('data:') ? snap.favicon : null,
    faviconRel: snap?.faviconRel ? String(snap.faviconRel) : null,
  };
  const i = data.tabs.findIndex((t) => t.id === tab.id);
  if (!tab.id || !path.isAbsolute(tab.path) || tab.path !== path.resolve(tab.path)) throw new Error('Tab can’t be restored.');
  // An existing tab keeps its path; a closed one must come back to a real checkout.
  if (i >= 0 ? data.tabs[i].path !== tab.path : !fs.existsSync(path.join(tab.path, '.git'))) throw new Error('Tab can’t be restored.');
  if (tab.faviconRel) {
    tab.faviconRel = String(tab.faviconRel).replace(/\\/g, '/').replace(/^[/\\]+/, '');
    if (!repoImageFileUrl(tab.path, tab.faviconRel)) tab.faviconRel = null;
  }
  if (i >= 0) data.tabs[i] = tab;
  else if (data.tabs.some((t) => t.path === tab.path)) throw new Error('That repository is already open.');
  else data.tabs.splice(Math.min(Math.max(0, Number(index) || 0), data.tabs.length), 0, tab);
  write(data);
  return hydrate(data);
}

export { ICONS as TAB_ICONS };
