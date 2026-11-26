# Dock icon

Source of truth: [`app-icon.svg`](app-icon.svg).

Tile + shutter mark sit on a clear 1024 canvas, **inset to the macOS app-icon grid** (`scale(0.875)` ≈ 64px margin) so Dock size matches neighbors. Opaque full-bleed tiles look oversized next to system apps.

`npm run icons` renders that SVG to [`app-icon-1024.png`](app-icon-1024.png) and rebuilds `build/icon.{png,ico,icns}`. On macOS the renderer clears the bitmap before drawing so corner pools stay **transparent** — never white. The build refuses to ship opaque corners.

Finish (2026-11-09): raised mark opacity to 1, lightened the tile and gradient floor so the shutter mark holds next to Teebo / Linear / Cursor at Dock size.
