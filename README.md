# Overlook

Mac git client for parallel work. Phase one: board, lanes (worktrees), commit / push / pull / rebase / merge, conflict walk. Phase two: runnable lanes — `.overlook/lane.yaml`, Run / Stop / Test with port offsets, doctor, CLI, and local MCP.

## Run

```bash
npm install
npm run smoke:init          # disposable repo at tmp/smoke-repo
OVERLOOK_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Or open any repo from the empty state / ⌘K.

Hand-write a minimal manifest to try Run on a feature lane:

```yaml
# .overlook/lane.yaml
version: 1
run: python3 -m http.server {port.web}
test: node -e "process.exit(0)"
ports:
  offset: 100
  expose:
    web: 8000
```

Primary never starts. Lane 1 gets `web` on `8100` (`8000 + 100`). Doctor (Lane setup) can propose + Accept writes the file. Create copies `env.copy` and runs `setup` when present. Drift gates Run when shared migrations are pending.

## Scripts

| Script | What |
| --- | --- |
| `npm run dev` | Vite HMR + Electron |
| `npm test` | Board, lane supervisor, doctor, CLI, MCP |
| `npm run smoke:init` | Fresh multi-worktree fixture with a local bare remote |
| `npm start` | Production build + Electron |
| `npm run overlook -- …` | CLI (`doctor`, `status`, `up`, `down`, `test`, `create`, `remove`, `mcp`) |

## Layout

- `app/` — renderer (lifted from `planning/mocks`)
- `electron/` — main process, git ops, lane supervisor, tabs, MCP
- `bin/overlook.mjs` — CLI + `overlook mcp` (stdio)
- `planning/` — product, design, mocks

## MCP (Cursor)

Point Cursor at the local stdio server (`repo.doctor`, `lane.create|up|down|test|status|remove`):

```json
{
  "mcpServers": {
    "overlook": {
      "command": "node",
      "args": ["/absolute/path/to/overlook/bin/overlook.mjs", "mcp"]
    }
  }
}
```

Or if `overlook` is on your `PATH`: `"command": "overlook", "args": ["mcp"]`.
