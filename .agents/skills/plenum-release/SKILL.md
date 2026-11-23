---
name: plenum-release
description: >-
  Ship a Plenum desktop release without breaking OTA self-heal. Preflight
  release-check (tests, pack, asar graph, launch, updater/feed invariants),
  version bump, tag, watch CI, verify https://plenum.sh/updates/. Use when the
  user says "release", "ship", "cut a version", "tag a release", "publish
  update", or after a fix that must reach the fleet via in-app update.
license: MIT
compatibility: Works in any agent that reads agentskills.io SKILL.md. macOS for local pack/launch smoke. Node 18+. gh + git for publish.
metadata:
  author: plenum
  version: "1.1.0"
  tags: plenum release ota electron-updater packaging smoke
  agentskills_spec: "1.0"
---

# Plenum release

Ship desktop updates that **keep the OTA loop alive**.

**Invariant:** every build we publish must still be able to discover, download, and install a *later* build from https://plenum.sh/updates/. If that loop breaks, we cannot fix users over the air — they reinstall or churn. On a rapid cadence that is unacceptable. **Never tag until `release-check` is green.**

Bad asar / launch crash is one failure mode (0.2.20). Wrong feed URL, missing zip, disabled updater, or a feed that is not newer than live are the same class of disaster: **OTA cannot heal the fleet.**

Details: [references/ota-invariants.md](references/ota-invariants.md). Feed ops: [`docs/updates-feed.md`](../../../docs/updates-feed.md).

## Hard rule

```
Do not run npm version / git tag / git push --tags until:
  npm run release:check
exits 0.
```

CI re-checks packaged launch + OTA health (including feed artifacts vs live) **before** GitHub Release + FTP. Local check is still mandatory so a bad tag is never pushed.

## Scripts

Skill dir = `.agents/skills/plenum-release`.

```bash
npm run release:check
# = tests → pack → asar import graph → launch smoke → ota-health-check

node <skill>/scripts/ota-health-check.mjs --app release/mac-arm64/Plenum.app
node <skill>/scripts/ota-health-check.mjs --artifacts release --live-feed   # CI / post-dist
node <skill>/scripts/pack-imports-check.mjs --app release/mac-arm64/Plenum.app
node <skill>/scripts/pack-launch-smoke.mjs --app release/mac-arm64/Plenum.app
```

| Script | OTA role |
| --- | --- |
| `release-check.mjs` | Full pre-tag gate |
| `ota-health-check.mjs` | Source feed/publish/updater wiring; asar has updater; optional `latest-mac.yml` + zip + not-older-than-live |
| `pack-imports-check.mjs` | Packaged main process can load (no missing modules / no `electron`→`app` imports) |
| `pack-launch-smoke.mjs` | Packaged app stays up long enough to run (updater never starts if main dies on open) |

Flags: `--skip-test`, `--skip-pack`, `--skip-launch`, `--json`.

## Release workflow

```
Release progress:
- [ ] 1. Preconditions
- [ ] 2. release-check (HARD GATE — OTA survival)
- [ ] 3. Confirm bump + notes
- [ ] 4. Version + tag + push
- [ ] 5. Watch Release workflow (includes OTA artifact gates)
- [ ] 6. Verify live feed
- [ ] 7. Hand back URLs
```

### 1. Preconditions

- On `main`, synced with `origin`.
- Release commits already landed. Do not mix unfinished work into the tag.
- Bump: **patch** / **minor** / **major** — ask once if unclear.
- `git log $(git describe --tags --abbrev=0)..HEAD --oneline` — those subjects become update notes.

### 2. release-check (HARD GATE)

```bash
npm run release:check
```

If it fails: **stop**. Fix and re-run. Do not “ship and hotfix” — users on a broken build may never receive the hotfix via OTA.

Common failures → [references/ota-invariants.md](references/ota-invariants.md).

### 3. Confirm bump + notes

One sentence: new version + why it matters. Ask before `npm version` unless they already named the bump.

### 4. Version + tag + push

```bash
npm version patch -m "%s"   # or minor / major
git push origin main
git push origin vX.Y.Z
```

Tag form `v*`. No force tags. No skipped hooks.

### 5. Watch Release workflow

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <id> --exit-status
```

Must succeed before claiming shipped. On failure: fix, cut a **new** patch — do not yank a published feed without an explicit user ask.

### 6. Verify live feed (OTA actually reachable)

```bash
curl -sL https://plenum.sh/updates/latest-mac.yml | head -30
# optional full gate:
node .agents/skills/plenum-release/scripts/ota-health-check.mjs \
  --skip-asar --artifacts /tmp/plenum-feed-check --live-feed
```

Confirm `version:` matches the tag, `path:` names a zip, and notes look right. Spot-check that the zip URL under the feed responds.

### 7. Hand back

- GitHub release URL
- https://plenum.sh/updates/
- One line: `release-check` + CI OTA gates green; version live

## Anti-patterns

- Treating release as “tests green + tag” without packaged/OTA gates.
- Shipping after only `npm run dev` (dev loads repo trees; OTA clients run asar).
- Changing the default feed, publish provider, or disabling the updater “temporarily” in a release build.
- Publishing a feed version ≤ what is already live.
- Force-pushing tags or overwriting `latest-mac.yml` with an older build.
- Telling users to reinstall as the primary recovery — that means we broke OTA.

## Related

- Feature/fix workflow: `.agents/skills/plenum-dev/SKILL.md`
- Update feed: `docs/updates-feed.md`
