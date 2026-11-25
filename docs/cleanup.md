# Cleanup

Full-window page to clear safe (or confirmable) lanes, unprepared worktrees, and local branch tips in one pass — instead of Remove then Delete per tip.

## Entry

- Local accordion: **Cleanup…** next to the Local header.
- Command palette (⌘K / ⌘P): **Cleanup…**

## Surface

Sibling to Branch Overview / Settings — not a sheet, not cards.

- `state.cleanup = { open, selected, deleteBranchAfter, applying, progress, focusId }`
- `#cleanup` host; `body.cleanup-open` collapses the board grid like Overview.
- Esc / ← Board closes. Mutual exclusion with Settings and Branch Overview.

## Planner (`electron/git/cleanup.mjs`)

`planCleanup(board)` classifies from existing board fields (no new git semantics):

| Tier | What |
| --- | --- |
| **Safe to clear** (default checked) | Lanes/worktrees with `readiness === 'safe'`; local tips with `ahead === 0`, no worktree, not team/primary |
| **Needs confirm** | Dirty / unmerged worktrees; local tips still ahead of team (force `-D`) |
| **Blocked** | Protected checkout, team tip — shown with reason, not selectable |

Remote delete is **out of v1** (never offered). “Also delete local branch after remove” defaults **off**.

## Apply

Renderer multi-invokes existing IPC (`lane.remove`, `branch.delete`). Order: remove worktree → optional branch delete → standalone branch deletes. After each remove, re-resolve remaining candidates by **path / branch name** (lane indexes shift). One batch confirm for the selected Needs-confirm set. Per-item failure does not abort the batch; toast summarizes counts + failures.

## Out of scope (v1)

Linear / trackers, MCP `branch.delete`, remote-only stale tips, last-active ranking, silent `-D` as default.
