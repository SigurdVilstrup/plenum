# Decoupled Brand Book Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the coupled 15-name×logo brand book with independent Marks + Names tracks and a pairing preview.

**Architecture:** Single static HTML file. `MARKS[]` holds SVG geometry + metadata. `NAMES[]` holds naming shortlist only. JS mounts three sections. No per-name kits.

**Tech Stack:** Static HTML/CSS/JS, inline SVG marks.

---

### Task 1: Rewrite brand-book.html shell

**Files:**
- Modify: `planning/brand-book.html`

**Step 1:** Replace page with dual-track shell (nav: Marks / Names / Pair; dark/light chrome toggle).

**Step 2:** Open in browser; confirm sections and jump links render empty without errors.

---

### Task 2: Wire MARKS[] with 10 SVG geometries

**Files:**
- Modify: `planning/brand-book.html`

**Step 1:** Add `MARKS[]` (id, label, type, note, svg builder).

**Step 2:** Render mark wall: black + white grounds, 16/32/64 favicon sizes.

**Step 3:** Visual check each mark at 16px for gap collapse.

---

### Task 3: Wire NAMES[] shortlist

**Files:**
- Modify: `planning/brand-book.html`

**Step 1:** Port 15 names from old BRANDS (drop fonts/colors/mark/iconPack).

**Step 2:** Render name cards + scoreboard (domains, CLI, collision).

---

### Task 4: Pairing strip

**Files:**
- Modify: `planning/brand-book.html`

**Step 1:** Selects for mark + name; live lockup + tab favicon mock.

**Step 2:** Browser self-check: swap combinations, confirm no coupling leftovers in copy.
