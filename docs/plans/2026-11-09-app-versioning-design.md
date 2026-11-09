# Design: app versioning + feedback env

Written 9 November 2026. Approved direction from product chat.

## Goal

One canonical app version from `package.json`, shown on Settings → General, bumped with a small npm habit before pack, and stamped into every local feedback report together with richer machine/env facts.

## Non-goals

- Title-bar or About-window version chrome
- Changelog generator, CI auto-bump, or release automation
- Hostname / username / serial in feedback meta
- Separate `VERSION` file or sync script
- Schema bump of feedback `meta.version` (stay at `1`; new fields are additive)

## Source of truth

- `package.json` `"version"` only.
- Packaged Mac app already stamps this via electron-builder / `app.getVersion()`.
- Renderer never hardcodes the string; main exposes it over IPC.

## Settings UI

- **Settings → General**, first row (before tool/folder groups).
- Same `settingsRow` pattern: title **Version**, detail mono live string (e.g. `0.1.0`), no control.
- Hover: bump reminder (`npm run version:patch` before pack).
- **Settings → Agents → CLI** status badge uses the same live value (replace hardcoded `0.1.0`).

## Bump habit

```bash
npm run version:patch   # → npm version patch
npm run version:minor
npm run version:major
```

Updates `package.json` and creates a git tag (`v0.1.1`, …). README Mac app section: one line — bump, then `npm run pack`.

## Feedback env

`feedback.save` already writes `appVersion` + `platform`. Main fills an additive env block on every save (renderer does not invent it):

```json
{
  "version": 1,
  "createdAt": "…",
  "comment": "…",
  "target": null,
  "appVersion": "0.1.0",
  "platform": "darwin",
  "arch": "arm64",
  "osVersion": "25.3.0",
  "electronVersion": "…",
  "locale": "en-US",
  "screens": [{ "width": 1512, "height": 982, "scaleFactor": 2, "primary": true }],
  "windowSize": { "width": 1280, "height": 800 },
  "repoPath": null
}
```

Collect with Node `os` / `process` + Electron (`app.getVersion()`, `process.getSystemVersion()`, `screen.getAllDisplays()`, `win.getBounds()` / content size). Skip hostname and username.

## Architecture

1. IPC `app.version` → `app.getVersion()`; preload allowlist; renderer caches on boot / Settings open.
2. Pure helper (e.g. `collectEnv(win)`) used by `feedback.save` and unit-tested with injected stubs where Electron APIs are awkward.
3. `buildMeta` passes through the new fields; keep `meta.version: 1`.

## Check

- Unit test: `buildMeta` includes new env keys when provided.
- Unit test or assert: env helper shape (screens array, numeric sizes).
- Manual: General shows live version; bump script changes package.json; one feedback folder’s `meta.json` has the env block.
