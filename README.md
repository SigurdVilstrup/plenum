# Plenum

Mac git client for parallel work. Phase one: board, lanes (worktrees), commit / push / pull / rebase / merge, conflict walk. Phase two: runnable lanes — `.plenum/lane.yaml`, Run / Stop / Test with port offsets, doctor, CLI, and local MCP.

## Run

```bash
npm install
npm run smoke:init          # disposable repo at tmp/smoke-repo
PLENUM_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Or open any repo from the empty screen / ⌘K.

Hand-write a minimal manifest to try Run on a feature lane:

```yaml
# .plenum/lane.yaml
version: 1
run: python3 -m http.server {port.web}
test: node -e "process.exit(0)"
ports:
  offset: 100
  expose:
    web: 8000
```

Primary never starts. Lane 1 gets `web` on `8100` (`8000 + 100`). Lane setup lives under Settings (`⌘,`) → Repositories → the repo (not a dialog); Write saves `.plenum/lane.yaml`. Create copies `env.copy` and runs `setup` when present. Drift gates Run when shared migrations are pending. Palette: Quick start, Tab warm time…

## Scripts

| Script | What |
| --- | --- |
| `npm run dev` | Vite HMR + Electron (Dock uses Plenum icon) |
| `npm test` | Board, lane supervisor, doctor, CLI, MCP |
| `npm run smoke:init` | Fresh multi-worktree fixture with a local bare remote |
| `npm start` | Production build + Electron |
| `npm run pack` | Unsigned `Plenum.app` in `release/mac*` |
| `npm run dist` | Same + `.dmg` + updater `.zip` / `latest-mac.yml` |
| `npm run icons` | Rebuild `build/icon.icns` from `planning/assets/app-icon-1024.png` |
| `npm run plenum -- …` | CLI (`doctor`, `status`, `up`, `down`, `test`, `create`, `remove`, `mcp`) |

### Mac app

Before `npm run pack`, bump with `npm run version:patch` (or `minor` / `major`). That updates `package.json` and tags `v*`.

```bash
npm run pack          # → release/mac/Plenum.app (or mac-arm64)
open release/mac*/Plenum.app
# optional: drag into /Applications
```

Icon masters live in `planning/assets/app-icon*.svg` / `app-icon-1024.png`. Packaging is unsigned (`identity: null`) for local use; notarize later for distribution.

### In-app updates (T3 pattern)

Packaged builds use `electron-updater` against GitHub Releases. The app checks in the background; you click to download, then again to install & restart. First installs still use the `.dmg`; updates use the `.zip` + `latest-mac.yml` (+ `*.blockmap` for differential downloads) published on each `v*` tag.

- Disable: `PLENUM_DISABLE_AUTO_UPDATE=1`
- Override feed repo: `PLENUM_UPDATE_REPOSITORY=owner/repo`
- Private release auth: `PLENUM_UPDATE_GITHUB_TOKEN` (or `GH_TOKEN`)

## Layout

- `app/` — renderer (lifted from `planning/mocks`)
- `electron/` — main process, git ops, lane supervisor, tabs, MCP
- `bin/plenum.mjs` — CLI + `plenum mcp` (stdio)
- `planning/` — product, design, mocks

## MCP (Cursor)

Point Cursor at the local stdio server (`repo.doctor`, `lane.create|up|down|test|status|remove`):

```json
{
  "mcpServers": {
    "plenum": {
      "command": "node",
      "args": ["/absolute/path/to/plenum/bin/plenum.mjs", "mcp"]
    }
  }
}
```

Or if `plenum` is on your `PATH`: `"command": "plenum", "args": ["mcp"]`.
