import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveGhBin, PLENUM_GITHUB } from './github-star.mjs';

const execFileAsync = promisify(execFile);

/**
 * Build the public GitHub issue body for a feedback report (no screenshot upload).
 * Mirrors the relay's markdown shape so issues look the same either path.
 */
export function buildFeedbackIssueBody(meta, { viaGh = false } = {}) {
  const env = {
    appVersion: meta.appVersion,
    platform: meta.platform,
    arch: meta.arch,
    osVersion: meta.osVersion,
    electronVersion: meta.electronVersion,
    locale: meta.locale,
    windowSize: meta.windowSize,
  };
  const lines = [
    String(meta.comment || '').trim(),
    '',
    meta.target?.label ? `**Target:** ${String(meta.target.label).slice(0, 200)}` : null,
    meta.reporterEmail ? `**Reported by** ${meta.reporterEmail}` : null,
    '',
    '### Environment',
    `- App: ${env.appVersion ?? '-'}`,
    `- OS: ${env.platform ?? '-'} ${env.osVersion ?? ''} (${env.arch ?? ''})`.trim(),
    `- Electron: ${env.electronVersion ?? '-'}`,
    `- Locale: ${env.locale ?? '-'}`,
    env.windowSize ? `- Window: ${env.windowSize.width}×${env.windowSize.height}` : null,
    '',
    viaGh
      ? '_Screenshot stayed on this computer (created with the GitHub CLI)._'
      : null,
    '',
    viaGh ? '_Sent from Plenum via `gh`._' : '_Sent from Plenum._',
  ].filter((l) => l != null);
  return lines.join('\n');
}

export function feedbackIssueTitle(comment) {
  const c = String(comment || '').trim();
  if (!c) return 'Feedback';
  return c.length > 72 ? `${c.slice(0, 69)}…` : c;
}

/** True when a `gh` binary is on disk (Dock-launched Electron PATH included). */
export async function ghFeedbackAvailable(opts = {}) {
  return Boolean(resolveGhBin(opts));
}

/**
 * Create a public issue on SigurdVilstrup/plenum as the signed-in `gh` user.
 * Returns `{ issueUrl, issueNumber }`. Does not call the Plenum relay.
 */
export async function createFeedbackIssueViaGh(meta, {
  home = process.env.HOME || process.env.USERPROFILE || '',
  existsSync = fs.existsSync,
  pathEnv = process.env.PATH || '',
  execFileImpl = execFileAsync,
  bins = null,
  platform = process.platform,
} = {}) {
  const bin = resolveGhBin({ home, existsSync, pathEnv, bins, platform });
  if (!bin) throw new Error('GitHub CLI (`gh`) is not available.');
  const title = feedbackIssueTitle(meta.comment);
  const body = buildFeedbackIssueBody(meta, { viaGh: true });
  const payload = JSON.stringify({
    title,
    body,
    labels: ['feedback'],
  });
  const tmp = path.join(os.tmpdir(), `plenum-feedback-${Date.now()}.json`);
  fs.writeFileSync(tmp, payload);
  let stdout;
  try {
    ({ stdout } = await execFileImpl(bin, [
      'api',
      '-X', 'POST',
      `/repos/${PLENUM_GITHUB.owner}/${PLENUM_GITHUB.repo}/issues`,
      '--input', tmp,
    ], {
      timeout: 20_000,
      maxBuffer: 512 * 1024,
      encoding: 'utf8',
    }));
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).slice(0, 240);
    throw new Error(`Couldn’t create the GitHub issue with gh. ${detail}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('gh returned a non-JSON issue response.');
  }
  const issueUrl = data?.html_url;
  const issueNumber = data?.number;
  if (!issueUrl || issueNumber == null) throw new Error('gh returned no issue URL.');
  return { issueUrl: String(issueUrl), issueNumber: Number(issueNumber) };
}
