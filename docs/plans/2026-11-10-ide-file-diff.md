# IDE-style file diff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Opening a file shows the diff in `#main` while `#changes` keeps the file picker (read-only IDE layout).

**Architecture:** Add `#file-stage` in `#main`. `paintFilePane` paints there; `paintChanges` always paints the tree. CSS: `with-file-pane` → 3-column grid and hide graph.

**Tech Stack:** Vanilla JS (Electron renderer), existing `app/styles/app.css` + `mock.css`

---

### Task 1: DOM + CSS shell

**Files:**
- Modify: `app/index.html`
- Modify: `app/styles/app.css`
- Modify: `app/styles/mock.css`

**Step 1:** Add `<section class="file-stage" id="file-stage" hidden></section>` inside `#main` after `.graph`.

**Step 2:** CSS — `.file-stage` fills main when `with-file-pane`; hide `.lane-head` + `.graph`. In `app.css`, `with-file-pane` uses grid `rail | 1fr | min(380px,40vw)` and `#changes` static (not absolute/wider). Add `.fx-file.on` highlight.

**Step 3:** Manual check in browser/app: class toggle shows/hides stage (after JS wired).

---

### Task 2: Split paint in main.js

**Files:**
- Modify: `app/main.js`

**Step 1:** Wire `el.fileStage`. Add `clearFileStage()`. Point `paintFilePane` at `el.fileStage`; Back label → “Back to graph”; bind chrome on file stage.

**Step 2:** `paintChanges`: remove early-return that replaces `#changes` with the file pane. Always paint tree; highlight `state.filePane.path`; if pane set, `await paintFilePane`. Include pane path in WIP `changesKey`. `closeChanges` / Back / Esc call `clearFileStage` as needed.

**Step 3:** Run app — open commit → click file → main shows diff, right keeps list; click another file; Back; Close; Esc.

---

### Task 3: Sanity on existing file-pane unit tests

**Files:**
- Test: `app/lib/file-pane.test.mjs` (unchanged expected)

**Step 1:** `node --test app/lib/file-pane.test.mjs` — still PASS.
