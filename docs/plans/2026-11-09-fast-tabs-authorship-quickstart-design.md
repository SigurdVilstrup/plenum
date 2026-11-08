# Design: fast tabs, authorship pills, quick start

Written 9 November 2026. Approved direction from product chat.

## Goal

Make Overlook feel snappy when hopping between repo tabs, make AI authorship quieter in the graph, and teach the lane/worktree model on demand — without a first-run tour.

## Non-goals

- Multiple `BrowserWindow` / `BrowserView` per tab
- Mounted/hidden DOM boards (escalate later only if warm cache still feels slow)
- Auto-showing onboarding on first launch
- Full Settings app (TTL config is a tiny prefs store + palette/sheet)

---

## 1. Authorship pill

### Behavior

For tip commits and lane headers where authorship is not `human`:

| Kind | Visible | `title` (hover) |
| --- | --- | --- |
| assisted + tool | sparkle + tool name (`Cursor`) | `Assisted by Cursor` |
| agent + tool | robot + tool name | `Agent: Cursor` |
| mixed + tool | git-merge + tool name | `Mixed authorship (Cursor)` |
| any kind, no tool | icon + kind label (`Assisted`) | same as today’s kind word |
| human | no pill (unchanged) | — |

Author name column stays as today (icon + quoted name). Only the pill text changes: prefer **tool name** over `Assisted, Cursor`.

### Implementation notes

- Detection unchanged: `classifyAuthorship` in `electron/git/board.mjs`.
- UI strings in `app/main.js` and `app/lib/graph-live.js` (both build the pill). Share one small helper (e.g. `authorshipPillHTML(kind, tool)`) in a tiny shared module or duplicate the one-liner twice — prefer one helper next to the existing `authorIcon` / `authorLabel` maps.
- CSS: keep `.pill.assisted` etc.; no new badge chrome.

---

## 2. Warm tab cache

### Problem

Tab chrome updates immediately on click, but the board waits on `tabs.select` → `loadBoard` → `paint()`. Users want hop-back within a short window to feel interactive, with background freshness, then intentional staleness.

### Model

Still **one window, one painted board**. Add a **renderer-side warm cache** keyed by tab id:

```
WarmEntry = {
  path,
  board,           // last loadBoard result
  selectedLane,
  // optional: graph scrollTop, open changes key — restore if cheap
  leftAt,          // Date.now() when deactivated
  timerId,         // interval for background refresh
  frozen,          // true after TTL: stop refreshing, keep last board
}
```

### Lifecycle

1. **Leave tab A → B**  
   Snapshot A into the cache (`board`, `selectedLane`, …). Start a refresh interval for A. Apply B: if B has a warm entry, `applyBoard` + restore selection **synchronously** (no loading screen), then optionally kick a background refresh for B. If B has no entry, keep today’s `tabs.select` + `loadBoard` path (loading OK).

2. **Background refresh (warm, not frozen)**  
   Call existing `board.get(path)` (not `repo.refresh`, which is active-path-only). Write into the cache only. Do **not** paint unless that tab is active again. Interval ~ every 15–30s (fixed; not user-facing). Refresh errors: leave last good board, do not toast spam.

3. **TTL**  
   Default **2 minutes** after `leftAt`. When elapsed: clear the interval, set `frozen: true`, **keep** the last board for one more instant switch. Next visit while frozen: paint from cache immediately, then full refresh, and re-enter warm mode (reset `leftAt` / clear `frozen`).

4. **Hard drop**  
   Drop the entry when the tab is closed, or when the path is re-opened as a new tab id. Cap: at most **N** warm entries (recommend **4**); evict oldest `leftAt` first. No mounted DOM.

5. **Active tab**  
   Keep today’s focus/`refresh()` behavior for the visible board. Warm cache does not replace that.

### Configurable TTL

- New prefs file: `userData/prefs.json` via `electron/prefs.mjs` (same shape as `tabs.mjs`: read/write).
- Field: `warmTabTtlMs` (number), default `120_000`. Clamp e.g. 30_000 … 600_000.
- IPC: `prefs.get` / `prefs.set` (merge patch).
- UI: palette command **“Tab warm time…”** opens a small sheet with presets: 30s / 2 min / 5 min / 10 min (and maybe a custom number). No full Settings page in this work.
- Renderer reads TTL once at boot and again after the sheet saves.

### Main-process change

Minimal. `tabs.select` can still return a fresh board for cold tabs. For warm hits, renderer may skip waiting on the IPC board and use cache; still call `tabs.select` to persist `activeId` (fire-and-apply: update store from response, prefer cache board if present and not forcing cold load).

Suggested `selectTab` flow:

```
optimistic: paintTabs with new activeId
if warm[id]?.board:
  applyBoard(warm.board); restore selectedLane; paint()
storeRes = await tabs.select(id)   // persist activeId
applyStore(storeRes.store)
if !usedWarm:
  applyBoard(storeRes.board)       // cold path
else if !warm.frozen:
  // already showing cache; optional: refresh active in background
else:
  // frozen hit: showing cache; then refresh() to thaw
```

### Success criteria

- Switching back to a tab left &lt; TTL ago: board visible without the loading screen, within one frame of the click when cache exists.
- Background git work for inactive warm tabs stops after TTL.
- Closing a tab frees its cache entry.

---

## 3. Quick start (on demand)

### Behavior

- Never auto-opens.
- Always available: palette **“Quick start”** / **“What are lanes?”** (one command, two searchable labels or one label that matches both).
- Opens an existing-style **sheet** (`sheet-layer`), dismiss with Esc / backdrop / Done.

### Content (short)

One screen, product vocabulary only — not the full PRODUCT.md:

1. **Overlook vs a normal git client** — board of worktrees (lanes), not one checkout.
2. **Lane** — worktree + branch; several features at once.
3. **Protected main** — team branch checkout; Overlook watches it, does not work in it.
4. **Behind** — vs team `main` / `origin/main`, not the lane’s own upstream.
5. **Authorship** — trailers (`Co-authored-by`, …); human has no badge.
6. One line on **phase two** (runnable lanes) so the pitch is complete without promising UI that is not the focus of this sheet.

Copy should sound like PRODUCT.md (plain, direct), not marketing fluff. Reuse titles already used as `title=` tooltips on the board where possible.

### Implementation notes

- New `openQuickStartSheet()` next to other sheet openers in `app/main.js`.
- HTML string in the sheet; light CSS if needed (reuse `.sheet` patterns).
- No persistence / “don’t show again” — nothing to dismiss permanently.

---

## 4. Testing

- **Authorship:** unit or small assert on pill helper (tool name + title strings). Existing `board.test.mjs` stays the source of truth for classification.
- **Warm cache:** pure functions for TTL freeze / eviction in a small module (`app/lib/warm-tabs.js` or similar) with `node:test` — no Electron required for timer math.
- **Quick start:** manual — palette opens sheet; Esc closes. No auto-show on boot.

## 5. Escalation path

If warm cache + instant `applyBoard` still feels slow (paint cost), next step is Approach B from the brainstorm: keep one hidden board root for the previously active tab only. Do not build that now. Mark intentional ceiling in code if useful:

`// ponytail: warm board JSON only; escalate to hide/show DOM if paint dominates switch cost`
