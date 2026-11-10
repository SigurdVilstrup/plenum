# GitKraken Craft (Graph + Blame) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring GitKraken-grade tip clarity, commit→file drill-down, and blame onto Plenum’s existing lane graph — without cloning GitKraken.

**Architecture:** Steal IA (tip pills, inspector, Diff/Blame/History). Keep SVG/DOM graph in `graph-live.js` and `#changes`. Add thin git IPC (`file.diff`, `file.history`, `file.blame`). Spike real column packing before widening history.

**Tech Stack:** Electron IPC, `git` via `electron/git/run.mjs`, vanilla JS, node:test. Design: `docs/plans/2026-11-09-gitkraken-craft-design.md`. Study: `docs/plans/gitkraken-study/`.

**Skills:** @ponytail — shortest working diff; no avatar nodes, no graph write actions, no new deps.

---

### Task 1: Tip pill craft — overflow + current marks

**Files:**
- Modify: `app/lib/graph-live.js` (`refPill` and callers)
- Modify: `app/styles/mock.css` / `app/styles/app.css` (`.ref` variants)
- Test: `app/lib/graph-live-refs.test.mjs` (pure helpers if extracted)

**Step 1: Extract pure ref-list helper**

In `graph-live.js` (or tiny `graph-refs.js`):

```js
export function visibleRefs(refs, { max = 2 } = {}) {
  const list = refs || [];
  if (list.length <= max) return { shown: list, overflow: 0 };
  return { shown: list.slice(0, max), overflow: list.length - max };
}
```

**Step 2: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRefs } from './graph-refs.js';

test('overflow when more than max', () => {
  const refs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(visibleRefs(refs, { max: 2 }), {
    shown: [{ name: 'a' }, { name: 'b' }],
    overflow: 1,
  });
});
```

Run: `node --test app/lib/graph-refs.test.mjs`  
Expected: FAIL (module missing)

**Step 3: Implement helper + wire `refPill`**

- Render shown pills; if `overflow > 0`, add `<span class="ref overflow" title="…">+N</span>`.
- Current lane tip: add class `current` (checkmark via existing icon or CSS) when ref matches selected/worktree branch.
- Keep primary / remote / tag / running classes.

**Step 4: Run test + visual check in app**

Run: `node --test app/lib/graph-refs.test.mjs`  
Expected: PASS

**Step 5: Commit**

```bash
git add app/lib/graph-refs.js app/lib/graph-refs.test.mjs app/lib/graph-live.js app/styles/*.css
git commit -m "feat(graph): tip ref overflow and current marks"
```

---

### Task 2: Selection tint matches lane color

**Files:**
- Modify: `app/lib/graph-live.js` (selected row class / style)
- Modify: `app/styles/mock.css` (`.row.selected` uses `var(--lane-N)`)

**Step 1:** On selected commit/WIP row, set `style="--row-lane: var(--lane-${c.lane})"` or class `lane-N`.

**Step 2:** CSS: selected background / left edge uses that color at low alpha (not a solid fill that kills text).

**Step 3:** Manual: select tips on lane 0 vs 1 — tints differ.

**Step 4: Commit**

```bash
git commit -am "feat(graph): selection tint follows lane color"
```

---

### Task 3: Date bands in the message column

**Files:**
- Modify: `electron/git/board.mjs` — include unix `when` or day key on commits (if only `ago` string today, add `at` integer)
- Modify: `app/lib/graph-live.js` — when day changes between rows, show a band label
- Test: small pure `dateBand(prevAt, at)` helper

**Step 1: Helper**

```js
export function dateBandLabel(at, now = Date.now()) {
  // return 'today' | 'yesterday' | 'N days ago' | null for same-band continuation
}
```

Only paint a visible label on the **first** row of each band.

**Step 2:** Test band boundaries with fixed `now`.

**Step 3:** Wire into graph rows (muted text, right side — match study `03-stable-multilane.webp`).

**Step 4: Commit**

```bash
git commit -am "feat(graph): relative date bands between commits"
```

---

### Task 4: Topology spike (no UI rewrite yet)

**Files:**
- Create: `electron/git/graph-columns.mjs`
- Create: `electron/git/graph-columns.test.mjs`

**Step 1: Failing test** — diamond merge assigns distinct columns then rejoins:

```
A
|\
B C
|/
D
```

`assignColumns(commits)` returns stable lane indices with no crossings that contradict parents.

**Step 2:** Minimal packing (git-style left-packing). Document ceiling in a `ponytail:` comment if O(n²).

**Step 3:** Do **not** switch `board.mjs` yet — only prove the function.

**Step 4: Commit**

```bash
git commit -am "feat(git): spike graph column packing"
```

---

### Task 5: Adopt packing in `history()` when spike is green

**Files:**
- Modify: `electron/git/board.mjs` `history()` — replace first-match `column()` with `assignColumns`, still constrained to lane worktrees + team (Plenum lanes, not all remotes)
- Modify: `electron/git/board.test.mjs` — multi-parent fixture asserts columns

**Step 1:** Extend board test with a merge commit across main + feature worktree.

**Step 2:** Wire packing; keep window at 120 until paint is fine.

**Step 3:** Run: `npm test`  
Expected: PASS

**Step 4: Commit**

```bash
git commit -am "feat(board): real column packing for lane graph"
```

---

### Task 6: File diff IPC

**Files:**
- Create helpers in `electron/git/file.mjs`: `loadFileDiff(repoPath, sha, filePath)`
- Test: `electron/git/file.test.mjs`
- Wire: `electron/main.mjs` + `electron/preload.cjs` → `file.diff`

**Step 1: Failing test** in a temp repo: commit that adds a line; `loadFileDiff` returns unified hunks with `+`/`-` lines.

**Step 2: Implement** via `git show <sha> -- <path>` (or `git diff-tree -u`). Reject path traversal (`..`, absolute).

**Step 3: IPC allowlist**

**Step 4: Commit**

```bash
git commit -am "feat(git): file.diff IPC"
```

---

### Task 7: File history + blame IPC

**Files:**
- `electron/git/file.mjs`: `loadFileHistory`, `loadFileBlame`
- `electron/git/file.test.mjs`
- preload + main: `file.history`, `file.blame`

**Step 1: History** — `git log --follow -n 50 --format=%H%x1f%h%x1f%an%x1f%at%x1f%s -- <path>`

**Step 2: Blame** — `git blame -p <sha> -- <path>`; group contiguous same-commit lines into blocks `{ sha, short, author, subject, startLine, endLine }`.

**Step 3: Tests** for grouping (3 lines same sha → one block).

**Step 4: Commit**

```bash
git commit -am "feat(git): file history and blame IPC"
```

---

### Task 8: Open Diff from commit inspector

**Files:**
- Modify: `app/main.js` `paintChanges` / `bindChangesTree`
- Modify: CSS for file pane modes
- Optionally small `app/lib/file-pane.js`

**Behavior:**
- Clicking a file in commit changes opens Diff mode in `#changes` (or a child surface): header `File View | Diff View` · later Blame/History toggles.
- Show unified diff from `file.diff`.
- Keep a back control to the file list.

**Step 1:** State: `state.filePane = { sha, path, mode: 'diff' } | null`

**Step 2:** Paint diff; Escape closes file pane then inspector (match existing Escape stacking if any).

**Step 3: Commit**

```bash
git commit -am "feat(ui): diff view from commit file list"
```

---

### Task 9: Blame + History modes

**Files:**
- `app/main.js` / `app/lib/file-pane.js`
- CSS for history list + blame gutter

**Behavior (match study `06-blame-view.webp`):**
- Left (inside pane): file history list from `file.history`
- Center: file text at selected history sha + blame gutter blocks from `file.blame`
- Toggle Diff / Blame / History
- Click blame block or history row → `state.changes = { kind:'commit', sha }` and scroll/select that commit on the graph

**Step 1:** Blame mode paint with block gutters (no per-line spam).

**Step 2:** Wire jump-to-graph.

**Step 3: Commit**

```bash
git commit -am "feat(ui): blame and file history modes"
```

---

### Task 10: Smoke + polish

**Files:** whatever CSS/a11y nits remain

**Step 1:** Run `npm test`

**Step 2:** Manual on a multi-lane repo: tip marks, select tint, commit → file → blame → jump to commit.

**Step 3:** Commit any polish; stop. No minimap, no avatar nodes, no remote tree rewrite.

---

## Execution handoff

Plan saved to `docs/plans/2026-11-09-gitkraken-craft.md`.

**1. Subagent-Driven (this session)** — fresh subagent per task, review between tasks  

**2. Parallel Session (separate)** — new session with executing-plans  

Which approach?
