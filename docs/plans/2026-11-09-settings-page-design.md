# Design: Settings page (Lane setup leaves the dialog)

Written 9 November 2026. Approved in product chat; merged with fast-tabs / authorship / quick-start work.

## Goal

Settings is a page in the same window (`⌘,` / Esc / Board). Doctor / Lane setup is not a sheet — it lives under Repositories → that repo.

## Navigation

- General
- Appearance
- Accounts (PAT + HTTPS credential helper; OAuth later)
- Repositories (per open tab; Lane setup subpage per repo)
- Agents (stub for MCP/CLI/permissions)

No Integrations in v1 (provider OAuth ≠ git credentials).

## General

Preferred editor, open-lane-in-editor, terminal, diff/merge tools (Internal coming soon + external), clone default path, default lanes folder, reopen tabs, git user.name/email (± this repo), tab warm TTL presets.

## Appearance

Theme System/Light/Dark; zoom 80–125%; font packs System / Inter+JetBrains Mono / IBM Plex.

## Accounts

GitHub username + PAT and generic HTTPS host via `git credential`; secrets only in Keychain; SSH status-only.

## Repositories + Lane setup

Per open tab: team branch, lanes folder override, runnable status, Lane setup… → doctor findings + proposed YAML + Write.

## Agents

Visual stub only.

## Out of scope

OAuth app, built-in diff/merge UI, Agents permission enforcement, fetch/webhooks.
