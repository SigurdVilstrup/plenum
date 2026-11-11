# In-app feedback upload — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Redacted local outbox + Supabase relay that opens private issues on `plenum`, with optional `Reported by` email credit. Toast confirms send without an issue link.

**Architecture:** See `2026-11-11-feedback-upload-design.md`. Mocks: `planning/mocks/feedback-thread.html`.

**Tech Stack:** Electron main/renderer, Deno Edge Function, Supabase Storage, GitHub Issues API.

## Tasks

1. Manual: Frankfurt Supabase project + bot PAT secrets (user)
2. `supabase/` scaffold — migrations, storage, `submit-feedback`
3. `electron/feedback.mjs` — meta v2, upload payload, sanitize, patch meta, send helper
4. IPC — `feedback.capture`, save with PNG, `feedback.send`; preload allowlist
5. Renderer — redact CSS, preview, credit UI, CTA + official mark, toast link
6. Triage skill + tests + docs (this file + design)
