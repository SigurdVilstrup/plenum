# Feature request: in-app updates

**Source:** local dogfood feedback `2026-11-09T00-26-43.990Z-825c55`  
**Date:** 9 November 2026  
**Status:** open

## Ask

Support in-app updates so Overlook can roll out builds multiple times a day without asking people to re-run `npm run pack` / drag a new `.app`.

## Why

Dogfooding moves fast. Unsigned local packs already work; the gap is discoverability and install friction when a new build lands.

## Direction (not committed)

- Prefer the smallest path that fits current unsigned local distribution (e.g. check a known URL / GitHub release for a newer `package.json` version, download DMG/zip, prompt to replace).
- Notarization / Sparkle / electron-updater can wait until distribution is public.
- Keep Settings → General version row as the “you are here” signal once updates exist.

## Non-goals for a first cut

- Silent forced updates
- Delta patches
- Channel / beta / stable matrix
