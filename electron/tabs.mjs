import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';

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

export function listTabs() {
  return read();
}

export function openTab(repoPath, title) {
  const data = read();
  const abs = path.resolve(repoPath);
  const existing = data.tabs.find((t) => t.path === abs);
  if (existing) {
    data.activeId = existing.id;
    write(data);
    return data;
  }
  const tab = {
    id: randomUUID(),
    path: abs,
    title: title || path.basename(abs),
    icon: 'folder-simple',
  };
  data.tabs.push(tab);
  data.activeId = tab.id;
  write(data);
  return data;
}

export function selectTab(id) {
  const data = read();
  if (!data.tabs.some((t) => t.id === id)) throw new Error('Tab not found.');
  data.activeId = id;
  write(data);
  return data;
}

export function closeTab(id) {
  const data = read();
  const i = data.tabs.findIndex((t) => t.id === id);
  if (i < 0) return data;
  data.tabs.splice(i, 1);
  if (data.activeId === id) {
    data.activeId = data.tabs[Math.min(i, data.tabs.length - 1)]?.id ?? null;
  }
  write(data);
  return data;
}

export function renameTab(id, title, icon) {
  const data = read();
  const tab = data.tabs.find((t) => t.id === id);
  if (!tab) throw new Error('Tab not found.');
  const trimmed = String(title || '').trim();
  tab.title = trimmed || path.basename(tab.path);
  if (icon != null) tab.icon = ICONS.includes(icon) ? icon : 'folder-simple';
  write(data);
  return data;
}

export function setIcon(id, icon) {
  const data = read();
  const tab = data.tabs.find((t) => t.id === id);
  if (!tab) throw new Error('Tab not found.');
  tab.icon = ICONS.includes(icon) ? icon : 'folder-simple';
  write(data);
  return data;
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
  return data;
}

export { ICONS as TAB_ICONS };
