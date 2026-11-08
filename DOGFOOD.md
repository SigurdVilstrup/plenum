# Dogfood checklist

## Phase two — runnable lanes

Minimal manifest (check into the repo at `.overlook/lane.yaml`):

```yaml
version: 1
run: python3 -m http.server {port.web}
test: node -e "process.exit(0)"
ports:
  offset: 100
  expose:
    web: 8000
```

Or let the doctor propose one: Lane setup (gear / ⌘K → Doctor) → Accept writes the file. CLI: `overlook doctor` prints the proposal; Accept is in the app.

Fixture / UI:

```bash
npm run smoke:init
# drop a lane.yaml into tmp/smoke-repo if you want Run on feat/alpha
OVERLOOK_OPEN="$PWD/tmp/smoke-repo" npm run dev
```

Walk (board):

1. Open a repo with a valid `.overlook/lane.yaml`.
2. Primary has no Run. Feature lane shows Run once the manifest is present.
3. ⌘K → New lane → create. If the manifest has `env.copy` / `setup`, those run into the new worktree.
4. Select the lane → Run. URL chip opens (port = base + `offset * laneIndex`). Board mark shows running.
5. Test. Last result sticks on the lane.
6. Stop. Process gone; status shows stopped.
7. Shared-data drift (pending migrations) opens a sheet and blocks Run until you force or clear it. Snapshot services seed before Run when `mode: snapshot` + a `snapshot:` command.
8. Safe lane → Remove.

Same verbs on CLI / MCP (`overlook` or `overlook mcp`):

```bash
overlook doctor [path]
overlook create <name> [path]
overlook up <lane> [path]      # primary (0) fails protected
overlook status --json [path]  # lane N running
overlook test <lane> [path]
overlook down <lane> [path]
overlook remove <lane> [path]
```

CLI smoke against a temp git repo: init + commit the yaml above → `create dogfood` → `up 1` starts, `up 0` refuses, `test 1` ok, `down 1` stops.

## Phase one — git verbs

1. Window opens on `tmp/smoke-repo` with Protected + `feat/alpha` lane.
2. Select `feat/alpha`. Dirty WIP row shows above the tip. Authorship pill is Assisted / Cursor.
3. Commit → sheet → message → settle toast. Graph updates.
4. Push (force-with-lease). Toast ok.
5. ⌘K → New lane → feature `gamma` → create. Lane row animates in. Cursor may open.
6. Dirty gamma, commit, Push.
7. Advance main in Terminal (`echo x >> README.md && git commit -am move && git push`), focus Overlook → behind count updates after refresh.
8. Rebase on main. If conflict: Open → edit → Stage → Continue (multi-commit reopens sheet).
9. Merge into main (ff or merge commit). Primary may show ahead of origin; that is expected until you push main outside Overlook.
10. Safe lane → Remove lane sheet → folder gone, branch kept.
11. Tabs: open second repo, rename (dblclick), change icon, right-click Close Tab.
12. Primary: no Commit / Push / Rebase / Merge. Alert copy if dirty or off team branch.

Done when daily dogfood uses both loops without leaving Electron (agents can use CLI/MCP for the run loop).
