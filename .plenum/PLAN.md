# Feature plan: Windows desktop support (unsigned)

## Goal

Ship an unsigned Windows build of Plenum (NSIS installer + OTA `latest.yml`) while keeping the Mac pipeline intact. Linux stays out of scope. Windows users download `Plenum-Setup.exe`, accept SmartScreen, and use board/lanes/git with OTA updates.

## User-visible behavior

- Happy path: Landing shows Mac + Windows downloads; Windows NSIS installer; framed/`titleBarOverlay` chrome; Ctrl shortcuts; Explorer wording; Windows terminal/editor openers; CLI at `%USERPROFILE%\.plenum\bin\plenum.cmd`.
- First install: SmartScreen “Windows protected your PC” → More info → Run anyway (noted on site).
- Errors: Missing Git Bash blocks lane start with a clear install-Git message.
- Keyboard: Ctrl labels on Windows; handlers already accept `ctrlKey`.

## Scope

| In | Out |
| --- | --- |
| electron-builder `win` NSIS + `.ico`, host-aware pack | Linux / AppImage |
| CI mac + windows + publish jobs | Code signing / Azure Trusted Signing |
| Release scripts for `Plenum.exe` + `latest.yml` | Microsoft Store / MSIX |
| Supervisor kill tree + Git Bash for lane cmds | FileMerge parity on Windows |
| `plenum.cmd` shim, openers, chrome, updater, site | |

**Lane shell default:** On Windows, `lane.yaml` `run`/`test` go through Git Bash. Missing bash → actionable error.

## Touch list

- `package.json`, `scripts/build-icons.mjs`, `.github/workflows/release.yml`
- `.agents/skills/plenum-release/scripts/` (`_lib`, pack-launch-smoke, ota-health-check, release-check)
- `electron/lane/supervisor.mjs`, `electron/lane/log-tee.mjs`
- `electron/agents/launcher.mjs`, `electron/main.mjs`, `electron/prefs.mjs`, `electron/updates.mjs`
- `app/` chrome, shortcut labels, Finder→Explorer copy
- `site/index.html`, `README.md`, `AGENTS.md`

## Risks

- Supervisor / Git Bash mismatch is the main footgun for lane recipes.
- Unsigned SmartScreen will suppress conversion; document, don’t paper over.
- Split CI publish must not drop Mac FTP artifacts.
- OTA self-heal: `release:check` must stay green on Mac.

## Verify

- [ ] `npm test` on the lane
- [ ] Windows CI artifact smoke (launch + ota-health)
- [ ] Mac `release:check` still green
- [ ] Manual Windows: install, lane up/down, git verbs, terminal/editor, CLI, update feed
- [ ] Site serves `Plenum-Setup.exe` + `latest.yml`
