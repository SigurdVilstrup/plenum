# Design: in-app feedback (local pick + comment)

Written 9 November 2026. Approved direction from product chat.

## Goal

Make it trivially easy for dogfooders to leave UX-directed feedback on Overlook: open a sheet, optionally point at a UI element, write a comment, and save a full-window screenshot (with highlight) plus structured metadata on disk. No network in v1.

## Non-goals

- Anonymization / redaction of on-screen data
- Upload to GitHub, webhook, or Application Insights (later; same on-disk shape)
- Title-bar chrome button
- Feedback entry inside Settings pages
- Analytics SDK, retry queue, or sync stubs

## Entry points

1. **Command palette** — `Feedback…` (search also matches phrases like “tell me”, “report”). Works with or without a repo open.
2. **Lanes panel foot** — a quiet row **under** Settings (same `lane-row` weight). Not shown when the panel is hidden (empty state); palette still works.
3. **Quick start** — one extra vocabulary row pointing at palette + panel row.

## Flow

1. Open → existing Mac **sheet**: comment field, optional target chip, clear warning that a **full-window screenshot of what’s visible** will be saved locally, primary **Send feedback** button, **⌘↩** does the same.
2. **Point at something** (optional) → hide sheet temporarily, pick overlay, click a DOM node → highlight → return to sheet with a chip (label + rect). Clear target is one control.
3. General feedback: skip pick; comment only.
4. Empty comment → do not send; nudge the field.
5. On send → write report folder → close sheet → **toast** confirming local store and where to find it (path). Do not open Finder.

## Pick mode

- Overlay covers the window; Esc cancels pick and returns to the sheet (comment kept).
- Hover: lavender outline on hit element (`elementFromPoint`, ignore overlay).
- Click: freeze rect + short label from `aria-label` / visible text / tag fallback.
- Screenshot: full window with that rect drawn on (fill + stroke).
- `prefers-reduced-motion`: static highlight, no pulse.

## Storage

Each submit creates one folder under `userData`:

`~/Library/Application Support/Overlook/feedback/<id>/`

```
meta.json
window.png
```

`meta.json` (version 1, upload-ready later):

```json
{
  "version": 1,
  "createdAt": "…",
  "comment": "…",
  "target": null,
  "appVersion": "…",
  "platform": "darwin",
  "repoPath": null
}
```

`target` when set: `{ "label": "…", "rect": { "x", "y", "w", "h" } }` in window CSS pixels.

## Architecture

**Approach A:** sheet + pick overlay in the renderer; one IPC `feedback.save`. Main process `capturePage`s the window, composites the highlight when a rect is present, writes the folder, returns `{ dir }`. Reuse `displayPath` for toast copy when cheap. Failures toast and leave the sheet open with the comment.

## Edges

- Capture includes whatever the window currently shows (board or Settings) — intentional.
- Close palette before opening feedback; only one overlay at a time.
- Future destinations read the same folders; no client abstraction in v1.

## Check

Unit-test pure helpers: report id / folder layout, `meta.json` shape, highlight-onto-PNG compositing with a tiny fixture. No Electron E2E in v1.
