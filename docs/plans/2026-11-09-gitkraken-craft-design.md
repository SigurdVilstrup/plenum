# Design: GitKraken craft on Plenum’s graph + blame

Written 9 November 2026. Approved in product chat. Study captures: `docs/plans/gitkraken-study/`.

## Goal

Make Plenum’s commit tree and file drill-down feel as clear as GitKraken’s — without becoming a GitKraken clone. Steal information architecture and tip/blame craft; keep lanes, protected main, behind, and authorship as Plenum’s product.

## Non-goals

- Avatar-as-node graph (Plenum already has authorship pills on tips)
- Merge / commit / interactive rebase from the graph (`planning/DESIGN.md`)
- Agents, Explain/Recompose AI, Issues, Teams, PR pills, Cloud Patches
- Full 900-remote browser as the default left panel
- Minimap in blame v1
- Replacing the lane board with a generic ref list

## What we steal (craft ledger)

| Pattern | Why it works | Plenum action |
| --- | --- | --- |
| BRANCH/TAG · GRAPH · MESSAGE columns | Refs don’t fight the lines | Keep; tighten BRANCH/TAG column like GK |
| Tip pill: checkmark + local/remote icons + lane color | “Where am I” is instant | Adapt: current lane tip + primary/remote marks |
| Ref overflow `+N` | Dense tips stay readable | Add when a commit has many refs |
| Selection color = branch/lane color | Eye tracks tip → row → inspector | Selected row uses that lane’s color |
| Date bands (“yesterday”) | Time without a heavy column | Soften relative dates into bands when day changes |
| Subject + muted body preview | Scan without opening | Optional body snippet if already in payload |
| Commit inspector beside graph | Drill without leaving the tree | Enrich existing `#changes` panel |
| File modes: Diff / Blame / History | One continuous drill-down | Graph → commit → file → Diff/Blame/History |
| Blame: file-history list + block gutter | Ownership without noise | `git log -- path` + grouped `git blame` |
| Remotes collapsed + filter | Scale | Keep “Branches without a lane”; don’t clone GK remotes tree |

## Architecture

1. **Graph data** — keep `board.get` / `electron/git/board.mjs`. Spike true column packing (`git log --graph` or parent-walk) behind the existing `column()` heuristic; raise the 120-commit window only when packing is correct.
2. **Graph paint** — `app/lib/graph-live.js` + CSS: tip pills, overflow, selection tint, date bands.
3. **Inspector** — extend commit `#changes` (already exists) with parent jump and clearer metadata; file click opens a file pane instead of only `os.openEditor`.
4. **File modes** — new IPC: `file.diff`, `file.history`, `file.blame`. UI: Diff first, then Blame (history list + gutter blocks). Clicking a blame block selects that commit on the graph.

```
graph tip → commit inspector → file → Diff | Blame | History
                                      └─ blame block → select commit on graph
```

## Data (git)

| Need | Command |
| --- | --- |
| Diff at commit | `git show <sha> -- <path>` (or `diff-tree` + patch) |
| File history | `git log --follow -n 50 --format=… -- <path>` |
| Blame | `git blame -p <sha> -- <path>` then group contiguous same-sha hunks |

No new npm deps. Spawn via existing `electron/git/run.mjs`.

## UI placement

- Graph stays full-height owner of the window.
- Commit inspector stays the right `#changes` strip.
- Diff/Blame/History replace or expand that strip when a file is open (one file surface; modes are toggles). Do not add a fourth permanent column.

## Success

- On a multi-lane board, the checked-out lane tip is as obvious as GK’s purple `✓ stable`.
- Selecting a commit → file → Blame shows who owns each block; clicking a block lands on that commit in the graph.
- Lane facts (behind, protected, authorship, running) still read first.

## Out of scope follow-ups

True infinite history, virtualized graph rows, hunk revert, hosting avatars, remote solo filters.
