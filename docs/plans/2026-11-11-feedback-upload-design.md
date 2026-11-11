# Design: in-app feedback upload (Supabase → public issues)

Written 11 November 2026. Approved direction from product chat.

## Goal

Dogfooders send UX-directed feedback from Plenum into the **private** `plenum` issues inbox, with a redacted screenshot, without needing repo access or `gh`. Local outbox first; toast confirms send (no issue link — reporters lack private-repo access).

## Non-goals

- Unredacted screenshot toggle
- Creating the issue as the sender’s GitHub identity
- Supabase Auth / user accounts
- Background retry queue UI
- Committing screenshots into git
- Gist uploads under the sender’s account

## Destination

- Issues: private `SigurdVilstrup/plenum` (label `feedback`)
- Screenshots: Supabase Storage (EU / Frankfurt project), public object URLs for markdown embeds
- Author on GitHub: account that owns the Edge Function `GITHUB_TOKEN` (only maintainers see the inbox)
- Optional **Credit me (email)** → `Reported by email` in the body for later follow-up with the reporter

## Privacy

- Screenshot always redacted (repo-derived text → grey bars) before capture; sheet shows that exact image
- `repoPath` may exist in local `meta.json` only; never uploaded
- Optional **Credit me (email)** (default off) → git identity email → issue body `Reported by email`

## Flow

1. Open sheet (palette / panel / Quick start) — comment, optional target, redacted preview, credit checkbox, warn copy, **Send feedback** (busy → Sending…), ⌘↩
2. Point at UI (optional) — same pick overlay as v1; refresh preview after pick
3. Submit → write `userData/feedback/<id>/` → POST Edge Function → patch meta → toast `Sent to the Plenum team`
4. On send failure → local report kept (`status: failed`); toast error

## Architecture

Renderer: redaction class + preview; sheet UX.  
Main: `feedback.capture`, `feedback.save` (accepts PNG), `feedback.send` (POST).  
Supabase: `submit-feedback` Edge Function — store PNG, rate-limit, create issue.

## Check

- Unit tests: upload payload strips `repoPath`, username sanitize, meta status helpers
- Mocks: `planning/mocks/feedback-thread.html`
