# Design: IDE-style file diff

Written 10 November 2026. Approved in product chat.

## Goal

Opening a changed file turns the graph area into a read-only editor while the right-hand file list stays visible — like a read-only IDE: lanes | diff | files.

## Non-goals

- Editable buffers / save
- Hiding the left lane rail
- Two-pane side-by-side diffs
- New expand/fullscreen toggle (open file *is* the expanded mode)

## Layout

When `state.filePane` is set:

- Left rail stays
- `#main` shows file editor chrome + body (`#file-stage`); lane head + graph hide
- `#changes` keeps the file tree with the active file highlighted
- Grid: `rail | 1fr | ~380px` (changes in normal flow, not a wider overlay)

When only the changes inspector is open (no file): keep today’s overlay behavior.

## Chrome & exit

- Main header: Back · title/path · Diff/Blame/History (or Diff/Read) · Editor
- Right: commit/WIP head + Close + file tree
- Back / Esc (with file open): clear `filePane`, restore graph, keep changes open
- Close (right): `closeChanges()` — dismiss changes + file pane

## Approach

Split paint: `paintChanges` always renders the file list; `paintFilePane` targets `#file-stage` inside `#main` instead of replacing `#changes`.
