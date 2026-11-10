# Plenum, planning

Business and product materials for Plenum: a Mac git client built around lanes (worktrees), with runnable lanes as phase two. Nothing is built; PRODUCT.md says what would have to be true before anything is.

To refresh the numbers: `planning/scripts/mine.sh ~/Dev/Repositories 90` and `planning/scripts/prs.sh MobaroIT/mobaro 90 ~/Dev/Repositories/mobaro` (needs `gh auth login`).

| File | What |
|---|---|
| [DESIGN.md](DESIGN.md) | Visual contract: Linear tokens in dark and light, Phosphor icons, tabs, palette, motion, brand |
| [index.html](index.html) | Product pitch, 12 slides on a 16:9 stage that scales to the window. Arrow keys or scroll; File > Print saves a PDF; `?fixed=1` pins 1280x720 for screenshots |
| [PRODUCT.md](PRODUCT.md) | The full version: the idea, vocabulary, must and must not, lane manifest, MCP and CLI, evidence, audit, pre-mortem, decision notes, appendices |
| [examples/mobaro.lane.yaml](examples/mobaro.lane.yaml) | Worked lane manifest for the mobaro repo, as the doctor would propose it |
| [scripts/mine.sh](scripts/mine.sh) | Git mining over every repo under a folder (agent trailers, direct pushes, behind at merge, worktrees, reverts) |
| [scripts/prs.sh](scripts/prs.sh) | GitHub PR facts via gh (cycle time, merge method, force pushes) |
| [mocks/board.html](mocks/board.html) | Board: lanes panel with Running section, full-height graph, selected lane header with the environment strip. Lanes are clickable; Run and Stop work. Params: `?scenario=bad` (agent commit on main, stale agent lane), `&lane=0..4`, `&remove=1` (guarded remove sheet on a safe lane), `&up=1` (Run sheet on a lane with migration drift), `&palette=sea`, `&theme=light` |
| [mocks/setup.html](mocks/setup.html) | Lane setup (the doctor) as a page under Settings › Repositories: findings, proposed manifest, Write |
| [mocks/settings.html](mocks/settings.html) | Settings as a page in the main window (⌘,, Esc returns). `?page=repositories`: team branch, lanes folder, lane setup and services per repository. `?page=agents`: local MCP, connected clients, what agents may write |
| [mocks/create-lane.html](mocks/create-lane.html) | New lane from latest main |
| [assets/](assets/) | App icon (SVG masters and 1024 PNG) and window screenshots used by the deck |

Open `index.html` in a browser for the deck. The mocks work from disk; `⌘K` opens the palette. Themes follow the OS; add `?theme=light` or `?theme=dark` to force one.

Positioning: not an addition to GitKraken (which shows worktrees) or Conductor (which runs its own workspaces). The graph, the lanes and the git verbs are the core and ship first; running lanes and the local MCP are phase two.

Mock internals: `mocks/board.js` holds both scenarios and renders the panel, header, environment strip, remove sheet and run sheet; `mocks/graph.js` draws the graph from a commit array; `mocks/app.js` handles theme, palette, and the live sync readout; `mocks/icons.js` injects the Phosphor sprite from `mocks/icons.svg`.
