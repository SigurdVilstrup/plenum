# Feature request: in-app updates

**Source:** local dogfood feedback `2026-11-09T00-26-43.990Z-825c55`  
**Date:** 9 November 2026  
**Status:** implemented (T3 pattern)

## Ask

Support in-app updates so Plenum can roll out builds multiple times a day without asking people to re-run `npm run pack` / drag a new `.app`.

## Why

Dogfooding moves fast. Unsigned local packs already work; the gap is discoverability and install friction when a new build lands.

## Direction (shipped)

Same pattern as T3 Code:

- `electron-updater` against GitHub Releases (`latest-mac.yml` + zip + blockmap).
- Background check on launch (+ every 4 minutes). **No auto-download / no auto-install.**
- Settings → General version row: Check → Download → Install & Restart.
- Sidebar foot shows a cloud icon when an update is available / ready.
- Release workflow uploads DMG (first install) plus updater assets.

## Still later

- Code signing / notarization (dogfood packs remain `identity: null`; signature verify is off for now).
- Channel / beta / stable matrix.
- Forced minimum-version gates.
