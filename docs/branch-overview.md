# Branch overview

Full-window page to inspect one tip against a chosen base: ahead/behind, history-style commits, file stats, and a copyable agent prompt.

## Entry

- Branch context menu (sidebar Local/Remote + graph Branch/Tag pills): **Overview…** immediately after Checkout branch / Check out / Select worktree.
- Command palette: **Overview branch…** (current lane branch when unambiguous, else opens for a named tip).

## Surface

Sibling to Settings — not a sheet, not under Settings.

- `state.branchOverview = { open, branch, vs, tab, query, data, loading, error }`
- `#branch-overview` host; `body.branch-overview-open` collapses the board grid like Settings.
- Esc / ← Board closes. Mutual exclusion with Settings.

## Compare

- Default `vs`: sidebar branch-vs baseline when set; else this tip’s **upstream** when it tracks one; else team ref (`board.teamRef`).
- Picker: team, upstream (when the tip tracks one), configured baselines, other local/remote tips from `board.branches`.
- Changing Compare reloads `branch.overview`. Lede and pills name the compare base explicitly.


## Data (`branch.overview` IPC)

Input: `{ branch, vs, limit? }` pinned to repo root.

Git:

| Need | Command |
| --- | --- |
| Merge-base | `git merge-base vs branch` |
| Ahead / behind | `git rev-list --left-right --count vs...branch` |
| Commits on tip | `git log` on `vs..branch` (graph-shaped fields + `%D` refs) |
| Files | `git diff --numstat vs...branch` |
| Dirty | porcelain in a worktree that has this branch checked out |

Cap commits/files (~500); set `truncated` when capped.

Commit objects match board graph rows: `id`, `subject`, `author`, `email`, `avatarHash`, `when`, `at`, `kind`, `tool`, `refs`, `parents`, `isTip`, `isMerge`, `lane: 0`.

## UI

1. Crumb ← Board / Branch overview  
2. Title = branch short name; lede = local/remote · upstream · lane  
3. Pills: N ahead / M behind / merge-base short SHA  
4. Compare-to control  
5. Prompt strip + Copy (`copyText`)  
6. Tabs: Commits · N | Files · M  
7. Search filters the active tab client-side  
8. Lists

### Commits tab (board history chrome)

Same columns as the board graph ([`docs/design.md`](design.md)):

**Branch / Tag | Graph | Author | Commit | SHA | When**

- Reuse `.row` / `.labels` / `.ref` / avatar / `.sha` / `.time` from [`app/lib/graph-live.js`](../app/lib/graph-live.js).
- Pills in the left Branch/Tag lane (one + optional +N), not inline with the subject.
- Overview Graph column is a **slim single-lane spine** (`--graph-svg-w` ~28px), not the multi-lane 136px SVG.
- `When` uses `formatWhen` labels.

### Files tab

Path + `+added` / `−deleted` from numstat; filter by path.

### Prompt

Plain text: branch vs base, ahead/behind, merge-base, unique commit subjects (first ~15), file totals, dirty or clean. Copy only — no send-to-agent in v1.

## Drill-in

- Commit click → close overview, select commit on the board (`state.changes = { kind: 'commit', sha }`), jump if needed.
- File click → close overview, open file diff for that path against the tip (reuse `file.diff` / changes flow as practical).

## Out of scope (v1)

Send-to-agent, filtered multi-lane live graph, rebase/finish from overview, PR/GitHub metadata.
