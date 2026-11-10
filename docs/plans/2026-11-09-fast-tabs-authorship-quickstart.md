# Fast tabs, authorship pills, quick start — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instant feel when hopping back to a recently left repo tab (warm board cache + background refresh, default 2 min TTL), quieter AI authorship pills (sparkle + tool name, detail on hover), and an on-demand Quick start sheet from the palette.

**Architecture:** Keep one BrowserWindow and string-built `paint()`. Add renderer warm-cache module + tiny `prefs.json` for TTL. Authorship pill helper shared by header + graph. Quick start reuses `sheet-layer`. No multi-view, no first-run tour.

**Tech Stack:** Existing Electron main + vanilla renderer, `node:test`, `userData` JSON prefs (same pattern as `electron/tabs.mjs`).

**Source of truth:** `docs/plans/2026-11-09-fast-tabs-authorship-quickstart-design.md`, `planning/PRODUCT.md` vocabulary.

**Non-goals:** BrowserView per tab, mounted DOM boards, auto onboarding, full Settings UI.

---

### Task 1: Authorship pill helper

**Files:**
- Create: `app/lib/authorship-pill.js`
- Create: `app/lib/authorship-pill.test.mjs`
- Modify: `app/main.js` (replace inline pill HTML in `paintHeader`)
- Modify: `app/lib/graph-live.js` (replace inline tip pill)

**Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorshipPillHTML } from './authorship-pill.js';

test('assisted with tool shows tool name and Assisted-by title', () => {
  const html = authorshipPillHTML('assisted', 'Cursor', (name) => `[${name}]`);
  assert.match(html, /Cursor/);
  assert.doesNotMatch(html, />Assisted</);
  assert.match(html, /title="Assisted by Cursor"/);
});

test('human returns empty', () => {
  assert.equal(authorshipPillHTML('human', null, () => ''), '');
});
```

Pass `icon` as a function argument so the test does not need the SVG sprite.

**Step 2: Run test — expect FAIL**

Run: `node --test app/lib/authorship-pill.test.mjs`  
Expected: FAIL (module missing)

**Step 3: Minimal implementation**

```js
const TITLES = {
  assisted: (t) => (t ? `Assisted by ${t}` : 'Assisted'),
  agent: (t) => (t ? `Agent: ${t}` : 'Agent'),
  mixed: (t) => (t ? `Mixed authorship (${t})` : 'Mixed'),
};

export function authorshipPillHTML(kind, tool, iconFn) {
  if (!kind || kind === 'human') return '';
  const label = tool || { assisted: 'Assisted', agent: 'Agent', mixed: 'Mixed' }[kind];
  if (!label) return '';
  const title = (TITLES[kind] || (() => label))(tool);
  const iconName = { assisted: 'sparkle', agent: 'robot', mixed: 'git-merge' }[kind] || 'user';
  return `<span class="pill ${kind}" title="${title}">${iconFn(iconName)}${escapeHtml(label)}</span>`;
}
```

Use the same escaping style as the rest of the app (`esc` / local escape). Wire `app/main.js` and `graph-live.js` to call this helper instead of `Assisted, Cursor`.

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add app/lib/authorship-pill.js app/lib/authorship-pill.test.mjs app/main.js app/lib/graph-live.js
git commit -m "feat(ui): show tool name on authorship pills, detail on hover"
```

---

### Task 2: Prefs store (warm TTL)

**Files:**
- Create: `electron/prefs.mjs`
- Create: `electron/prefs.test.mjs`
- Modify: `electron/main.mjs` — `ipcMain.handle('prefs.get'|'prefs.set', …)`

**Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Export _setStorePathForTest or pass path via env — keep it tiny.
test('get returns default warmTabTtlMs', async () => {
  const { getPrefs, DEFAULTS } = await import('./prefs.mjs');
  const p = getPrefs();
  assert.equal(p.warmTabTtlMs, DEFAULTS.warmTabTtlMs);
  assert.equal(DEFAULTS.warmTabTtlMs, 120_000);
});

test('set clamps warmTabTtlMs', async () => {
  const { setPrefs, getPrefs } = await import('./prefs.mjs');
  setPrefs({ warmTabTtlMs: 1 });
  assert.equal(getPrefs().warmTabTtlMs, 30_000);
  setPrefs({ warmTabTtlMs: 999_999_999 });
  assert.equal(getPrefs().warmTabTtlMs, 600_000);
});
```

If `app.getPath` blocks unit tests, mirror `tabs.mjs` but inject path:

```js
let storePathOverride = null;
export function _setStorePathForTest(p) { storePathOverride = p; }
```

Use a temp dir in the test `before`/`after`.

**Step 2: Run — expect FAIL**

**Step 3: Implement** `prefs.json` under `userData`, merge patch on set, clamp `warmTabTtlMs` to `[30_000, 600_000]`. Wire IPC.

**Step 4: Tests PASS**

**Step 5: Commit**

```bash
git add electron/prefs.mjs electron/prefs.test.mjs electron/main.mjs
git commit -m "feat(prefs): persist warmTabTtlMs with clamp"
```

---

### Task 3: Warm tab cache module

**Files:**
- Create: `app/lib/warm-tabs.js`
- Create: `app/lib/warm-tabs.test.mjs`

**Step 1: Failing tests for pure logic**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WarmTabs } from './warm-tabs.js';

test('entry freezes after ttl', () => {
  const w = new WarmTabs({ ttlMs: 100, maxEntries: 4, now: () => 1000 });
  w.park('a', { path: '/r', board: { root: '/r' }, selectedLane: 1 });
  assert.equal(w.get('a').frozen, false);
  w.now = () => 1101;
  w.tick(); // or check on get
  assert.equal(w.get('a').frozen, true);
  assert.ok(w.get('a').board);
});

test('evicts oldest when over max', () => {
  const w = new WarmTabs({ ttlMs: 60_000, maxEntries: 2, now: () => 0 });
  w.park('a', { path: '/a', board: {}, selectedLane: 0 });
  w.now = () => 1;
  w.park('b', { path: '/b', board: {}, selectedLane: 0 });
  w.now = () => 2;
  w.park('c', { path: '/c', board: {}, selectedLane: 0 });
  assert.equal(w.get('a'), null);
  assert.ok(w.get('b'));
  assert.ok(w.get('c'));
});

test('drop removes entry', () => {
  const w = new WarmTabs({ ttlMs: 60_000, maxEntries: 4, now: () => 0 });
  w.park('a', { path: '/a', board: {}, selectedLane: 0 });
  w.drop('a');
  assert.equal(w.get('a'), null);
});
```

**Step 2: Run — FAIL**

**Step 3: Implement `WarmTabs`**

API sketch:

- `park(id, { path, board, selectedLane })` — snapshot + mark `leftAt`
- `get(id)` — returns entry or null; marks frozen if `now - leftAt >= ttlMs`
- `updateBoard(id, board)` — for background refresh while not frozen
- `drop(id)` / `setTtl(ms)` / `tick()` if timers are external

Keep **timers outside** the class (renderer owns `setInterval`); the class only decides frozen + eviction. Document that `paint` is still the ceiling:

```js
// ponytail: warm board JSON only; escalate to hide/show DOM if paint dominates switch cost
```

**Step 4: Tests PASS**

**Step 5: Commit**

```bash
git add app/lib/warm-tabs.js app/lib/warm-tabs.test.mjs
git commit -m "feat(tabs): warm cache with ttl freeze and eviction"
```

---

### Task 4: Wire warm cache into tab select / close / refresh

**Files:**
- Modify: `app/main.js` — `selectTab`, close-tab handler, `boot`, `refresh`

**Step 1: Manual checklist as the “test” (no Electron harness)**

Behavior to hit after wiring:

1. Open two repos as tabs.  
2. Switch A → B → A within 2 minutes: A paints without loading screen.  
3. Wait past TTL on a background tab; switch back: still paints from frozen cache, then refreshes.  
4. Close a tab: no leaked interval (DevTools / no errors).  
5. Cold tab (never warmed): still uses loading + `tabs.select` board.

**Step 2: Implement wiring**

- On leave: `warm.park(prevId, { path, board: state.board, selectedLane })`; start/reuse interval that `invoke('board.get', path)` → `warm.updateBoard` if `!entry.frozen`.
- On enter with `warm.get(id)?.board`: `applyBoard` + restore `selectedLane` immediately; still `await invoke('tabs.select', id)` for store; if frozen, call `refresh()` after paint.
- On cold: unchanged loading path.
- On close: `warm.drop(id)` + clear that tab’s interval.
- Load `warmTabTtlMs` from `prefs.get` at boot; `warm.setTtl(...)`.

**Step 3: Dogfood the checklist above**

**Step 4: Commit**

```bash
git add app/main.js
git commit -m "feat(tabs): apply warm board cache on tab switch"
```

---

### Task 5: Palette — set tab warm time

**Files:**
- Modify: `app/main.js` — `paletteCommands`, new sheet opener
- Modify: `app/index.html` only if sheet markup must be static (prefer string HTML like other sheets)

**Step 1:** Add command `{ id: 'warmTtl', label: 'Tab warm time…', run: openWarmTtlSheet }` (always available).

**Step 2:** Sheet with buttons/radios: 30 seconds / 2 minutes / 5 minutes / 10 minutes → `prefs.set({ warmTabTtlMs })` → `warm.setTtl` → close.

**Step 3:** Manual: change to 30s, confirm background freeze sooner.

**Step 4: Commit**

```bash
git add app/main.js
git commit -m "feat(prefs): palette sheet to set tab warm TTL"
```

---

### Task 6: Quick start sheet

**Files:**
- Modify: `app/main.js` — `openQuickStartSheet`, palette entry
- Touch CSS only if sheet body needs a short definition list (prefer existing sheet classes)

**Step 1:** Palette commands (always available):

- `{ id: 'quickstart', label: 'Quick start', run: openQuickStartSheet }`
- Optional second entry with same `run`: `{ id: 'lanes-help', label: 'What are lanes?', run: openQuickStartSheet }`

**Step 2:** Sheet copy (keep short; PRODUCT vocabulary):

- Title: Quick start  
- Lede: Plenum is a git client built around lanes (worktrees), not a single checkout.  
- **Lane** — a worktree on its own branch. Several features in progress at once.  
- **Protected main** — the team-branch checkout; Plenum watches it and does not work in it.  
- **Behind** — commits on team main this lane does not have (vs `origin/main`, not the lane upstream).  
- **Authorship** — from author + trailers (`Co-authored-by`, …). Humans get no badge.  
- Footer line: Phase two makes lanes runnable; this board is the client you use every day first.  
- Button: Done

**Step 3:** Manual — boot app, open palette, open sheet, Esc closes; does **not** open on its own.

**Step 4: Commit**

```bash
git add app/main.js app/styles/*.css
git commit -m "feat(ui): on-demand Quick start sheet from palette"
```

---

### Task 7: Verify + dogfood pass

**Step 1:** Run unit tests

```bash
node --test app/lib/authorship-pill.test.mjs app/lib/warm-tabs.test.mjs electron/prefs.test.mjs
```

Expected: all PASS

**Step 2:** Smoke in the app

- Authorship: assisted tip shows `Cursor` (or tool), hover explains  
- Tabs: warm hop feels instant; TTL configurable  
- Quick start: palette only  

**Step 3:** Final commit only if verify fixed anything; otherwise done.

---

## Execution note

Implement in order 1 → 6; Task 4 depends on 2–3; Task 5–6 are independent of each other after Task 2 exists (Task 6 does not need prefs).
