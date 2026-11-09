# GitKraken study notes — multi-branch overview (#18) + product bar (#8)

Written 9 November 2026 while shipping #14 / #18.

## What GitKraken does well

1. **Side list + multi-tip graph** — every local (and fetched remote) tip stays visible; selecting one does not hide the others.
2. **Where columns** — worktree / local / remote are scannable without opening a detail mode.
3. **Ahead/behind vs integration tip** sits next to the name, not buried in a header.

## What we adopted in Plenum

- `listBranches` returns every local + remote-only tip with `hasLane`, `isPrimary`, `isTeam`, ahead/behind vs team, upstream track counts.
- Graph membership includes **all local tips** (orphan branches without a lane still paint).
- Left-rail **Branches** section with filters (All / Lanes / Local / Remote / No lane) and per-row actions.
- Branch verbs (#14): open as lane, checkout in lane, rename, delete, rebase onto any tip.

## Deliberate differences

- Protected primary still refuses feature checkouts — Open as lane stays the path for parallel work.
- Remotes that already have a local tip collapse into the local row (`hasRemote`) instead of duplicating.

## History depth (follow-up)

Board still windows history (`historyLimit`, default 120, Load older → max 5000). Multi-tip overview does not mean full `git log --all` at once; deep history remains on-demand. If Mobaro dogfood still feels shallow after Load older, raise the default or add a prefs knob — tracked as the remaining history note after #17.
