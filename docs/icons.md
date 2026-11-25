# Icons

Action → Phosphor name. Use the same glyph for the same job everywhere (toolbar, context menus, sheets, settings). Mechanical rules live in [`design.md`](design.md); this file is the lexicon.

## Rules

- **Set:** Phosphor Regular only. Vendored in `app/icons.svg`; runtime via `icon()` / `iconHTML()` in `app/lib/icons.js`.
- **Size:** 16px default (`currentColor`). `sm` where density needs it. No tiles, glows, or emoji as UI icons.
- **Name:** Pass the Phosphor id without the `i-` prefix (`arrow-up`, not `i-arrow-up`).
- **New action:** Pick from this table first. If nothing fits, add a Phosphor Regular symbol to `app/icons.svg` and a row here in the same change.
- **Danger:** Destructive actions still use their action glyph (`x`, `arrow-counter-clockwise`, `warning-circle`) and get danger styling on the control — do not invent a separate “danger icon set.”

## Git sync

| Action | Icon | Notes |
| --- | --- | --- |
| Commit | `git-commit` | Toolbar + changes pane |
| Push / Push to \<remote\> | `arrow-up` | Not a cloud; direction is “up to remote” |
| Pull | `cloud-arrow-down` | Behind counts use the same glyph |
| Fetch | `arrows-clockwise` | Remote tips |
| Force push | `warning-circle` | Confirm sheet + menu |
| Stash / Pop stash | `stack` | Same mark for both |
| Rebase onto… | `arrow-counter-clockwise` | Mutate, not danger-colored by default |
| Finish lane (merge) | `git-merge` | |
| Resolve conflicts | `warning-circle` | |

## Branches & worktrees

| Action | Icon | Notes |
| --- | --- | --- |
| Checkout branch / Check out | `git-branch` | Free local or remote tip |
| Select worktree | `tree-structure` | Tip already checked out in a worktree |
| Open as lane | `play` | Same metaphor as Start |
| New lane | `plus` | Section add control |
| Branch / tip mark | `git-branch` | Local list rows |
| Remote tip mark | `cloud-arrow-down` | |
| Pin / Unpin | `push-pin` | |
| Rename (tab or branch) | `pencil-simple` | |
| Delete branch / Close tab | `x` | Danger styling |
| Branch Overview… | `magnifying-glass` | Inspect / compare |
| Compare / vs baseline | `arrows-left-right` | |

## Lanes & runner

| Action | Icon | Notes |
| --- | --- | --- |
| Start | `play` | |
| Stop | `stop` | |
| Test | `flask` | |
| Run log | `terminal-window` | |
| Services menu | `globe-simple` (+ `caret-down`) | |
| Open service URL | `arrow-square-out` | |
| Lane setup / Repair / doctor | `gear-six` | |
| Remove lane | `x` | Safe remove; use `warning-circle` when the control is the unsafe “Remove !” affordance |
| Data mode (shared/snapshot) | `database` | Fact mark, not an action |

## Files & clipboard

| Action | Icon | Notes |
| --- | --- | --- |
| Reveal in Finder | `folder-simple` | |
| Copy path / name / message | `files` | Multi-copy too |
| Copy SHA | `git-commit` | |
| Copy branch name | `git-branch` | Prefer over `files` when the payload is a ref |
| File in WIP tree | `files` | |
| Folder in WIP tree | `folder-simple` | |
| Revert changes | `arrow-counter-clockwise` | Danger styling |

## Chrome & navigation

| Action | Icon | Notes |
| --- | --- | --- |
| Settings | `gear-six` | |
| Account (placeholder) | `user` | |
| Feedback | `pencil-simple` | |
| Filter / search | `magnifying-glass` | |
| Select / confirm / current | `check-circle` | |
| Close / dismiss | `x` | |
| Expand accordion | `caret-right` / `caret-down` | |
| Refresh / update ready | `arrows-clockwise` | |
| Protected / team tip | `shield-check` | |
| Warning / blocked / alert | `warning-circle` | |
| Dirty / uncommitted fact | `circle-dashed` | |
| Open in editor | editor-specific (`cursor`, etc.) via `editorIcon()` | Fall back only if needed |

## Sidebar sections

| Section | Icon |
| --- | --- |
| Lanes | `stack` |
| Worktrees | `tree-structure` |
| Local | `desktop` |
| Remote | `cloud` |

## Authorship & agents

| Meaning | Icon |
| --- | --- |
| Agent / tool fallback | `robot` |
| Hall of fame / sparkle awards | `sparkle` (and award-specific marks in stats) |

## Do not

- Swap `arrow-up` (Push) for a cloud unless the action is specifically remote-fetch flavored.
- Use `play` for anything except Start / Open as lane / continue-into-run flows.
- Use emoji as interface icons.
- Add filled / duotone Phosphor variants — Regular only.
