# Plenum

Mac git client for parallel work: worktrees on a board, and **lanes** when those worktrees can run independently through Plenum.

## Language

### Board

**Protected**:
The designated integration branch for a repo (often `main`). A role on a checkout, not a ban on editing — commits and pushes on it are normal. Chosen (and explained) when first opening the repo.
_Avoid_: main lane, lane 0, never-touch checkout

**Worktree**:
A git checkout on disk for one branch. Plain git; not yet a lane.
_Avoid_: calling every worktree a lane

**Lane**:
A worktree with Plenum’s runner set up so it can Start, Stop, and Test on its own ports without switching Protected’s checkout or stopping sibling lanes. If it cannot run that way, it is still only a worktree.
_Avoid_: renaming all worktrees to lanes; “runnable worktree” as a separate product noun

**Finish**:
The flow that ends a lane: pick the branch to merge into, merge, stop that lane’s services, remove its worktree. Target is chosen at finish time — not always Protected.
_Avoid_: merge-into-main-only; “close lane” without merge intent

### Runner

**Manifest**:
The repo’s single recipe (`.plenum/lane.yaml`) for how lanes are prepared and run: setup, run, test, env copy/set, port plan, and optional data services.
_Avoid_: per-lane yaml; “config” for this file

**Open as lane**:
Turn an existing branch’s worktree into a lane by applying the manifest (setup / env), or create that worktree and set it up.
_Avoid_: “attach worktree” when runner setup is the point

**Repair**:
Fix a lane whose setup, env, or port wiring is broken so it can Start again.
_Avoid_: Ready (dropped); silent recreate

**Shared data**:
Default data mode: lanes share one database. For local throwaway **dev** databases only — not staging or production. Not isolation.
_Avoid_: promising private data per lane

**Snapshot data**:
Opt-in isolated data copy for a lane. Requires a seed/snapshot command in the manifest; without that command, separate DBs are out of scope.
_Avoid_: default path; “isolated” without a seed

**Port plan**:
Named base ports in the manifest (`web`, `api`, …) plus a per-lane offset so each lane’s listeners stay unique.
_Avoid_: hard-coded localhost ports in Start or .env

**Wire**:
How one named port reaches another inside a lane (usually `env.set` with `{port.*}` templates, e.g. frontend → API). Doctor and MCP report missing or hard-coded wires.
_Avoid_: assuming one port is enough for multi-process apps

**Port hit**:
A place in the repo (source, config, or env file) where a loopback or LAN host is paired with a fixed port — e.g. `localhost:3000`, `127.0.0.1:5173`, `192.168.…:8080`. Doctor scours for these because they break per-lane runtime ports unless overridden or intentionally allowed.
_Avoid_: treating every URL as a hit; public hostnames

**Allowlist**:
Port hits the user (or an agent with permission) marks as intentional so doctor/MCP stop warning on them. Stored with the repo’s Plenum config, not guessed away silently.
_Avoid_: auto-suppressing hits without a record
