# Dock icon

Source of truth: [`app-icon.svg`](app-icon.svg) (rounded tile + shutter mark on a clear canvas).

`npm run icons` renders that SVG to [`app-icon-1024.png`](app-icon-1024.png) and rebuilds `build/icon.{png,ico,icns}`. On macOS the renderer clears the bitmap before drawing so corner pools stay **transparent** — never white. Opaque white corners show up as hard triangles in the Dock; the build refuses to ship that.

Finish (2026-11-09): raised mark opacity to 1, lightened the tile (#1a1b20) and gradient floor so the shutter mark holds next to Teebo / Linear / Cursor at Dock size. Same circular mark; finish pass only.
