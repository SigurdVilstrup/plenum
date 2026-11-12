import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

// #5e6ad2 ≈ --primary; fill 25%, border stronger
const HL_R = 0x5e;
const HL_G = 0x6a;
const HL_B = 0xd2;
const FILL_A = 0.25;
const BORDER_A = 0.7;
const BORDER_PX = 2;

/**
 * Public relay (Supabase Edge Function). Packaged builds ship without `.env`,
 * so this is the endpoint they use; PLENUM_FEEDBACK_URL overrides it.
 */
export const DEFAULT_FEEDBACK_URL =
  'https://nditdrfcnglhyxlimxwu.supabase.co/functions/v1/submit-feedback';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;

/** Blend lavender highlight into PNG. scaleX/Y map CSS rect → capture pixels. */
export function paintHighlight(pngBuffer, rect, { scaleX = 1, scaleY = 1 } = {}) {
  // ponytail: BGRA blend; drop if Electron gains a canvas/compositor API we prefer
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(pngBuffer);
  const { width, height } = img.getSize();
  const bitmap = Buffer.from(img.toBitmap()); // BGRA copy

  const x0 = Math.max(0, Math.floor(Number(rect.x) * scaleX));
  const y0 = Math.max(0, Math.floor(Number(rect.y) * scaleY));
  const x1 = Math.min(width, Math.ceil((Number(rect.x) + Number(rect.w)) * scaleX));
  const y1 = Math.min(height, Math.ceil((Number(rect.y) + Number(rect.h)) * scaleY));
  if (x1 <= x0 || y1 <= y0) return pngBuffer;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const onBorder =
        x < x0 + BORDER_PX || x >= x1 - BORDER_PX || y < y0 + BORDER_PX || y >= y1 - BORDER_PX;
      const a = onBorder ? BORDER_A : FILL_A;
      const i = (y * width + x) * 4;
      bitmap[i] = Math.round(bitmap[i] * (1 - a) + HL_B * a);
      bitmap[i + 1] = Math.round(bitmap[i + 1] * (1 - a) + HL_G * a);
      bitmap[i + 2] = Math.round(bitmap[i + 2] * (1 - a) + HL_R * a);
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}

/** Reporter email or null. Throws on invalid non-empty input. */
export function sanitizeReporterEmail(raw) {
  if (raw == null || raw === false) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.length > MAX_EMAIL || /[\r\n\0]/.test(s) || !EMAIL_RE.test(s)) {
    throw new Error('Invalid email.');
  }
  return s;
}

export function buildMeta(input) {
  const target = input.target
    ? {
        label: String(input.target.label ?? ''),
        rect: {
          x: Number(input.target.rect.x),
          y: Number(input.target.rect.y),
          w: Number(input.target.rect.w),
          h: Number(input.target.rect.h),
        },
      }
    : null;
  const reporterEmail = input.reporterEmail == null
    ? null
    : sanitizeReporterEmail(input.reporterEmail);
  return {
    version: 2,
    createdAt: input.createdAt || new Date().toISOString(),
    comment: String(input.comment || '').trim(),
    target,
    appVersion: input.appVersion,
    platform: input.platform,
    arch: input.arch,
    osVersion: input.osVersion,
    electronVersion: input.electronVersion,
    locale: input.locale,
    screens: input.screens,
    windowSize: input.windowSize,
    repoPath: input.repoPath ?? null,
    reporterEmail,
    status: input.status || 'pending',
    issueUrl: input.issueUrl ?? null,
    issueNumber: input.issueNumber ?? null,
    sentAt: input.sentAt ?? null,
    error: input.error ?? null,
  };
}

/** Safe env fields for the relay (never includes repoPath). */
export function buildUploadEnv(meta) {
  return {
    appVersion: meta.appVersion,
    platform: meta.platform,
    arch: meta.arch,
    osVersion: meta.osVersion,
    electronVersion: meta.electronVersion,
    locale: meta.locale,
    screens: meta.screens,
    windowSize: meta.windowSize,
  };
}

export function buildUploadPayload(meta, pngBuffer) {
  return {
    comment: meta.comment,
    target: meta.target
      ? { label: meta.target.label, rect: meta.target.rect }
      : null,
    reporterEmail: meta.reporterEmail || null,
    env: buildUploadEnv(meta),
    pngBase64: Buffer.from(pngBuffer).toString('base64'),
  };
}

export function collectFeedbackEnv(deps) {
  const primaryId = deps.primaryDisplayId;
  return {
    appVersion: String(deps.getVersion()),
    platform: deps.platform,
    arch: deps.arch,
    osVersion: String(deps.getSystemVersion()),
    electronVersion: String(deps.electronVersion),
    locale: String(deps.locale || ''),
    screens: (deps.getAllDisplays() || []).map((d) => ({
      width: Number(d.bounds?.width) || 0,
      height: Number(d.bounds?.height) || 0,
      scaleFactor: Number(d.scaleFactor) || 1,
      primary: d.id === primaryId,
    })),
    windowSize: {
      width: Number(deps.getContentSize()?.[0]) || 0,
      height: Number(deps.getContentSize()?.[1]) || 0,
    },
  };
}

export async function writeFeedbackReport(baseDir, opts) {
  const now = new Date().toISOString();
  const id = `${now.replace(/:/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const feedbackRoot = path.resolve(baseDir, 'feedback');
  const dir = path.resolve(feedbackRoot, id);
  if (!dir.startsWith(feedbackRoot + path.sep)) throw new Error('bad report path');
  fs.mkdirSync(dir, { recursive: true });
  const meta = buildMeta({ ...opts, createdAt: opts.createdAt || now, status: 'pending' });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'window.png'), opts.png);
  return dir;
}

export function readFeedbackReport(dir) {
  const metaPath = path.join(dir, 'meta.json');
  const pngPath = path.join(dir, 'window.png');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const png = fs.readFileSync(pngPath);
  return { meta, png, metaPath };
}

export function patchFeedbackMeta(dir, patch) {
  const { meta, metaPath } = readFeedbackReport(dir);
  const next = { ...meta, ...patch };
  fs.writeFileSync(metaPath, JSON.stringify(next));
  return next;
}

export async function sendFeedbackReport(dir, { endpoint, anonKey, fetchImpl = fetch } = {}) {
  if (!endpoint) throw new Error('Feedback relay is not configured (PLENUM_FEEDBACK_URL).');
  const { meta, png } = readFeedbackReport(dir);
  const payload = buildUploadPayload(meta, png);
  const headers = { 'Content-Type': 'application/json' };
  if (anonKey) {
    headers.Authorization = `Bearer ${anonKey}`;
    headers.apikey = anonKey;
  }
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data && data.error) || `Submit failed (${res.status})`;
    patchFeedbackMeta(dir, { status: 'failed', error: String(err) });
    throw new Error(String(err));
  }
  const issueUrl = data?.issueUrl;
  const issueNumber = data?.issueNumber;
  if (!issueUrl || issueNumber == null) {
    patchFeedbackMeta(dir, { status: 'failed', error: 'Relay returned no issue URL' });
    throw new Error('Relay returned no issue URL');
  }
  const sentMeta = patchFeedbackMeta(dir, {
    status: 'sent',
    issueUrl: String(issueUrl),
    issueNumber: Number(issueNumber),
    sentAt: new Date().toISOString(),
    screenshot: data?.screenshot !== false,
    error: null,
  });
  // Filed: it's the relay's now. If the delete fails, the status:'sent' skip in the retry keeps it from resending.
  fs.rmSync(dir, { recursive: true, force: true });
  return sentMeta;
}

const RETRY_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

/**
 * Local outbox: resend reports that never made it (relay down, offline). Oldest first,
 * stops at the first failure so an outage costs one request. Returns how many went out.
 * ponytail: a report the relay filed but whose reply was lost is filed twice; add a client id if it bites.
 */
export async function retryUnsentFeedback(baseDir, opts = {}) {
  const root = path.resolve(baseDir, 'feedback');
  let names;
  try { names = fs.readdirSync(root).sort(); } catch { return 0; }
  let sent = 0;
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const { meta } = readFeedbackReport(dir);
      if (meta.status === 'sent') continue;
      if (Date.now() - Date.parse(meta.createdAt) > RETRY_MAX_AGE_MS) continue;
      await sendFeedbackReport(dir, opts);
      sent++;
    } catch (e) {
      if (e.code === 'ENOENT' || e instanceof SyntaxError) continue; // not a report dir
      break;
    }
  }
  return sent;
}

const CHECKIN_KINDS = ['update', 'checkin'];

/** Rating + optional one-liner. No screenshot, no local folder: just the relay. */
export async function sendCheckin(input, env, { endpoint, anonKey, fetchImpl = fetch } = {}) {
  if (!endpoint) throw new Error('Feedback relay is not configured (PLENUM_FEEDBACK_URL).');
  if (input?.rating !== 'up' && input?.rating !== 'down') throw new Error('Pick a rating.');
  const context = CHECKIN_KINDS.includes(input.context) ? input.context : 'checkin';
  const headers = { 'Content-Type': 'application/json' };
  if (anonKey) {
    headers.Authorization = `Bearer ${anonKey}`;
    headers.apikey = anonKey;
  }
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: 'checkin',
      rating: input.rating,
      context,
      comment: String(input.comment || '').trim().slice(0, 500),
      env: buildUploadEnv(env),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || `Submit failed (${res.status})`);
  }
}
