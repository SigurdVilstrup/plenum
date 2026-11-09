# Design: build commit in Settings version

Written 9 November 2026. Approved in product chat.

## Goal

Settings → General Version always shows semver plus the git commit the binary was built from, and when that commit was made — including packaged apps with no `.git`.

## Non-goals

- Bumping `package.json` version on every commit (still manual before pack)
- About window / title-bar chrome
- Live HEAD while the app is running (stamp is frozen at build)
- Dirty-tree / branch name in the row
- Putting commit into feedback `meta.json` (can reuse the stamp later if needed)

## Approach

Bake a stamp file at build time. One path for dev and pack.

`scripts/stamp-build-info.mjs` runs `git rev-parse --short HEAD` and `git log -1 --format=%cI`, writes:

```json
{
  "commit": "a1b2c3d",
  "committedAt": "2026-11-09T01:37:00+01:00"
}
```

to `electron/build-info.json` (already shipped via electron-builder `electron/**/*`).

Hook:

- `npm run build` → stamp then Vite
- `scripts/dev.mjs` → stamp before launching Electron

If git is missing or fails: write empty strings; UI shows version only (no fake hash).

## IPC / UI

- `app.version` returns `{ version, commit, committedAt }` instead of a bare string (`version` from `app.getVersion()`).
- Settings → General Version detail: mono semver; second line (or same mono block) short hash · formatted commit time (local-readable, e.g. `9 Nov 2026, 02:37`).
- Agents CLI badge: semver only (keep compact).
- Hover copy can stay the bump reminder.

## Source of truth

- Semver: `package.json` / `app.getVersion()` (unchanged).
- Commit identity: stamp file only — never call git from the running app.

## Check

- Unit test: stamp writer / reader with injected git output.
- Manual: Settings shows hash + time after `npm run build` / `npm run pack`; packaged `.app` still shows them without `.git`.
