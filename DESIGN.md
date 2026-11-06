---
version: beta
name: Overlook
description: >-
  Team-safe overview of parallel git worktrees, each one runnable. Adapts Linear's product UI
  language (near-black canvas, hairline panels, one lavender signal) to a
  graph-first Mac window: lanes panel on the left, full-height commit graph,
  command palette over everything. Dark and light.
colors:
  dark:
    canvas: "#010102"
    surface-1: "#0f1011"
    surface-2: "#141516"
    surface-3: "#18191a"
    hairline: "#23252a"
    hairline-strong: "#34343a"
    ink: "#f7f8f8"
    ink-muted: "#d0d6e0"
    ink-subtle: "#8a8f98"
    ink-tertiary: "#62666d"
    primary: "#5e6ad2" # avoid-ai-design-ignore: SD purple, Linear contract
    primary-hover: "#828fff"
    success: "#27a644"
    warning: "#f2c94c"
    danger: "#eb5757"
    human: "#8ab4ff"
    assisted: "#f2c94c"
    agent: "#ff8f6b"
    lane-0: "#4a4f5c"
    lane-1: "#5e6ad2"
    lane-2: "#3d9a8b"
    lane-3: "#d0689a"
    lane-4: "#8c6bb1"
  light:
    canvas: "#ffffff"
    surface-1: "#f7f8f8"
    surface-2: "#f1f2f3"
    surface-3: "#e9eaec"
    hairline: "#e3e4e8"
    hairline-strong: "#cfd1d7"
    ink: "#0a0a0b"
    ink-muted: "#3c3f45"
    ink-subtle: "#6b7079"
    ink-tertiary: "#8f949d"
    primary: "#5e6ad2"
    primary-hover: "#4a55bd"
    success: "#1f8a3b"
    warning: "#a97d00"
    danger: "#d03b3b"
    human: "#2f6fdb"
    assisted: "#a97d00"
    agent: "#d9541e"
    lane-0: "#a4a8b3"
    lane-1: "#5e6ad2"
    lane-2: "#2f8a7b"
    lane-3: "#c2558a"
    lane-4: "#7c5aa6"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: 13px
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: 11px
icons:
  set: "Phosphor Icons, Regular weight, v2.1.1 (MIT)"
  size: 16px
  color: currentColor
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
spacing:
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
motion:
  selection: 120ms ease
  settle: 320ms cubic-bezier(0.2, 0.8, 0.2, 1)
  nudge: 480ms ease-out
  pulse: 1.6s ease-in-out infinite
  live: 2.4s ease-in-out infinite
components:
  window:
    size: 1280x800
    titlebar: 52px
    rounded: 11px
  lanes-panel:
    width: 260px
  graph-row:
    height: 30px
    laneColumnWidth: 136px
    laneSpacing: 24px
  lane-header:
    headRow: 56px
    envRow: 36px
  sheet:
    width: 460px
    setupWidth: 760px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: 5px 10px
---

## Overview

Overlook is a Mac app for scanning parallel git worktrees before merge. The visual contract is Linear's product UI (see [Linear DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)): near-black canvas, charcoal panels, hairline borders, one lavender accent for real actions, focus, and the selected lane. Never decoration.

The structural idea is GitKraken's: a narrow list on the left and a full-height graph that owns the window. Overlook's own facts (behind the team branch, protected primary, authorship, running) live on that structure as marks, pills, and two header strips. Nothing is a card.

## Colors

Two themes, same roles. The app follows the OS; the choice lives in Settings > Appearance. Mocks accept `?theme=light|dark`.

- Canvas: the window ground. Surfaces 1 to 3 step up for panel, hover, selection.
- Hairline / hairline-strong: all separation. No shadows inside the window.
- Ink, muted, subtle, tertiary: four reading levels. Tertiary is for SHAs, times, and column labels.
- Primary: primary buttons, focus rings, the selected lane's column, the `main` ref pill border, and palette match highlights. Not backgrounds.
- Success / warning / danger: readiness, freshness, and running only. Clean, working, behind. Running is success (the ring, the Running row dot, the graph pill dot). Migration drift against the shared database is warning, same role as "working": something is ahead of where the team is.
- Human / assisted / agent: tip nodes, author icons, and the pill on AI-involved tips. Human is the default and gets no pill.
- Lane 0 to 4: edge colors in the graph. Lane 0 is main and stays neutral. Lane 1 is lavender because the selected lane in every mock is lane 1; in the app the selected lane takes primary and the others cycle through 2 to 4.

Light theme colors are darker versions of the same hues, picked to keep AA on white. Primary stays the same in both.

## Typography

System UI stack, Linear's product face. Display is the same family at 600 with slight negative tracking, used only for the selected lane name and page titles. Body 13px. Mono 11px for refs, SHAs, paths, and the WIP count. No display face, no third family.

## Icons

Phosphor Icons, Regular weight only, vendored into `mocks/icons.svg` as symbols and injected by `mocks/icons.js`. Sixteen pixels, `currentColor`, no tiles or rounded-square backgrounds behind them, one icon per row at most.

Meaning is fixed per icon so it can be learned once:

| Icon | Means |
|---|---|
| `tree-structure` | a lane: a worktree on its own branch plus the way to run it |
| `git-branch` | a branch without a worktree, or a remote ref |
| `shield-check` | the protected primary branch |
| `git-fork` | base: where a lane left main |
| `cloud-arrow-down` | behind the remote team branch |
| `circle-dashed` | uncommitted work |
| `check-circle` | safe to remove |
| `user`, `sparkle`, `robot` | human, assisted, agent |
| `arrows-clockwise`, `broadcast`, `clock` | fetch, webhooks, fetch on focus |
| `arrow-square-out` | leaves Overlook (open in Cursor) |
| `pencil-simple` | rename |
| `magnifying-glass`, `command` | palette |
| `gear-six`, `sun`, `moon` | settings, theme |
| `folder-simple`, `files`, `plus`, `x`, `caret-right` | repo, file, add, close, expand |
| `play`, `stop` | run a lane, stop a lane |
| `flask` | run the lane's tests |
| `globe-simple` | a URL the lane answers on |
| `database` | shared data; the services a lane uses with the others |
| `stethoscope` | lane setup (the doctor) |
| `plugs-connected`, `terminal-window` | the local MCP, a command |

## Layout

Window 1280x800, 11px radius, hairline-strong border, one soft drop shadow on the desk only.

- Title bar, 52px: traffic lights at 14px inset with 8px gaps, the 16px app mark, then the tab strip. Right: live sync dot with "synced n ago" and the palette button with its `⌘K` key cap. Nothing else; theme and settings are not title bar material.
- Lanes panel, 260px: sections Protected, Lanes, Running (only when something is running), Branches without a lane. Rows are 16px mark, name, trailing meta. Folder under the name only when it differs. Running rows show the web port in mono and a Stop button on hover. A Settings row (`⌘,`) sits at the bottom, the way Mac sidebars do.
- Selected lane header, two rows. Head row, 56px: lane icon, name, path; then facts (behind, uncommitted, base, authorship pill); then a framed folder icon button (Reveal in Finder) and Open in Cursor. Environment strip, 36px, on surface-1: Run or Stop, Test, a hairline separator, URL chips (`web :5101`), a separator, the `shared data` badge, and the drift fact in warning when the lane has migrations the shared database has not run. On the protected row the strip has no buttons: it names the shared services and links to Lane setup.
- Title bar readout: "synced 1s ago · 2 running". The count appears only when it is above zero.
- Graph: column header (Graph, Commit, Author, SHA, When), then 30px rows. The graph column is 136px wide with 24px between lanes. An SVG overlay draws edges and nodes at row centers. A legend footer explains tip colors and the WIP row.

Signature detail: the WIP row. A dashed node above a lane's tip, the change count in mono, and a single Open link. It is the only row that is not a commit.

## Tabs

Tabs live in the title bar and attach to the content below: the active tab shares the canvas color and has no bottom border; inactive tabs sit on the title bar surface and show their close icon on hover. Each tab carries a folder icon and the repo's display name. Double-click or "Rename repo tab" in the palette puts the tab in rename state: the pencil icon replaces the folder and the name becomes an inline input with a lavender underline. A `+` tab adds a repo.

## Settings and sheets

Settings is a page in the main window (`⌘,`), not a second window. The title bar, tab strip and palette stay; the board is replaced by a 220px sidebar whose first item is Board (`esc`), then General, Appearance, Integrations, Repositories, Agents. Appearance holds the theme choice (System, Light, Dark); the app follows the OS by default and there is no toggle in the main window. Repositories is per git repository: team branch, lanes folder, lane setup status with Edit file or Lane setup…, and services. Lane setup (the doctor) is a page under Repositories with a breadcrumb, two columns (findings, proposed manifest) and a footer with Copy and Write; Esc returns to Repositories. Agents holds the local MCP endpoint and CLI, connected clients with their last call, and the four writes agents may do, each a switch or an Ask me / Allow / Never select. Nothing in the manifest is editable here except by opening the file; Settings shows it.

Dialogs are Mac sheets: they hang from the bottom of the title bar, square at the top and rounded at the bottom, over a light scrim. New lane, Remove lane and Run (when there is drift) are 460px sheets. Lane setup, the doctor, is the one wide sheet at 760px: findings on the left, the proposed manifest in a mono block on the right, the shared-data note across the bottom, and two buttons.

Shared data is never a dialog. It is a badge on the lane, with the list of services and the other lanes in its tooltip. The only sheet on Run is for drift, and it offers three choices in plain words with the cost of each.

## Command palette

560px wide, 96px from the top, over a scrim. Search field with the magnifying glass and an `esc` cap. Results grouped as Lanes, Branches, Files in the selected lane, Repos, Commands, Pages. Each item is icon, label with matched letters in primary, and a right-aligned hint (path in mono, shortcut, or state). The first result is active. Footer shows the keys. Opened with `⌘K` or `⌘P`, closed with `esc` or a click on the scrim.

## Readiness mark

One 16px slot per lane row, four states:

- Working: filled warning dot, pulsing.
- Not merged: hollow subtle ring.
- Safe to remove: `check-circle` in success, settles in once.
- Protected primary: `shield-check` in subtle.

Running is not a fifth state. A running lane keeps its readiness mark and gains a 1.5px success ring around it. In the graph, the lane's ref pill gains a 6px success dot. In the Running section the row dot is success and breathes with the live sync dot.

## Motion

Quiet, and mostly once. The point is to show state change, not to decorate.

- Working dot pulses forever at 1.6s, between 100% and 45% opacity.
- Safe check scales from 0.6 to 1 once over 320ms when the lane becomes safe.
- Behind arrow nudges 2px down once over 480ms when the count rises.
- Live sync dot breathes at 2.4s; it is the only always-on motion in the title bar. Running row dots breathe on the same clock.
- Selection changes fade over 120ms. Graph dimming is a 120ms opacity change.
- `prefers-reduced-motion` turns all of it off.

## Brand

App icon: a macOS squircle (rx 224 on 1024) on surface-1 with a hairline-strong border. Inside, the graph as one glyph: a trunk in ink-subtle, two lanes leaving it without crossing, round caps, and one lavender tip. Sixteen-pixel version keeps the trunk, one lane, and the dot. Masters in `assets/app-icon.svg` and `assets/app-icon-16.svg`; no gradients, no glow, no wordmark inside the icon.

## Do

- Let the graph own the window. Everything else is a strip or a panel.
- Three facts per lane row. More goes in the header or the palette.
- Show behind-origin/main as the loudest fact after the lane name.
- Use lavender only for primary actions, focus, the selected lane, and palette matches.
- Keep both themes identical in structure; only tokens change.
- Show shared data as a fact on the lane. Gate Run only on drift, and say what each choice costs.
- Put ports next to the lane they belong to. `:5101` means lane 1 everywhere it appears.

## Don't

- Cards under the graph. Lane lists as grids of cells.
- A third type family, acid accents, glass blur, glow, gradients.
- Hand-drawn glyphs or a second icon set mixed with Phosphor.
- Interactive rebase, merge-from-graph, or commit from the graph.
- A refresh button. Everything is a stream.
- A warning dialog about shared data every time a lane starts. Once it is a badge, it stays a badge.
- A data-mode setting in Settings. Modes live in `.overlook/lane.yaml`, where the team can see them.
- A terminal into the agent, or a log viewer. Running shows URLs and the last test result, nothing more.

## Don't change

- Linear token roles (canvas / primary / hairline).
- Lanes panel + full-height graph as the structure (not graph-only, not list-only).
- Phosphor Regular as the only icon set.
