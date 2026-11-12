import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const MAX_PNG_BYTES = 1_500_000;
const MAX_COMMENT = 8_000;
const RATE_PER_HOUR = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function sanitizeReporterEmail(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.length > MAX_EMAIL || /[\r\n\0]/.test(s) || !EMAIL_RE.test(s)) {
    throw new Error('Invalid email.');
  }
  return s;
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const githubToken = Deno.env.get('GITHUB_TOKEN');
  const githubRepo = Deno.env.get('GITHUB_REPO') || 'SigurdVilstrup/plenum';
  if (!supabaseUrl || !serviceKey || !githubToken) {
    return json(500, { error: 'Server misconfigured' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    // Check-ins (thumbs + optional one-liner) carry no screenshot.
    const checkin = body?.kind === 'checkin';
    const rating = body?.rating === 'up' ? 'up' : body?.rating === 'down' ? 'down' : null;
    if (checkin && !rating) return json(400, { error: 'Missing rating.' });
    const comment = String(body?.comment || '').trim();
    if (!comment && !checkin) return json(400, { error: 'Add a comment.' });
    if (comment.length > MAX_COMMENT) return json(400, { error: 'Comment too long.' });

    let png: Uint8Array | null = null;
    if (!checkin) {
      const pngBase64 = String(body?.pngBase64 || '');
      if (!pngBase64) return json(400, { error: 'Missing screenshot.' });
      // Cap encoded size before decode so huge bodies fail cheaply.
      if (pngBase64.length > Math.ceil(MAX_PNG_BYTES * 4 / 3) + 8) {
        return json(400, { error: 'Screenshot size out of range.' });
      }
      try {
        png = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
      } catch {
        return json(400, { error: 'Invalid screenshot encoding.' });
      }
      if (png.byteLength < 32 || png.byteLength > MAX_PNG_BYTES) {
        return json(400, { error: 'Screenshot size out of range.' });
      }
      // PNG signature
      if (!(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47)) {
        return json(400, { error: 'Screenshot must be a PNG.' });
      }
    }

    let reporterEmail: string | null = null;
    try {
      reporterEmail = sanitizeReporterEmail(body?.reporterEmail);
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || 'unknown';
    const ipHash = await sha256Hex(ip);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from('feedback_reports')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since);
    if (countErr) throw new Error(`Rate limit check failed: ${countErr.message}`);
    if ((count ?? 0) >= RATE_PER_HOUR) {
      return json(429, { error: 'Too many reports from this network. Try again later.' });
    }

    const id = crypto.randomUUID();
    let imageUrl: string | null = null;
    if (png) {
      const objectPath = `${id}/window.png`;
      const { error: upErr } = await supabase.storage
        .from('feedback-screenshots')
        .upload(objectPath, png, { contentType: 'image/png', upsert: false });
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
      imageUrl = supabase.storage.from('feedback-screenshots').getPublicUrl(objectPath).data.publicUrl;
    }

    const target = body?.target;
    const env = body?.env && typeof body.env === 'object' ? body.env : {};
    const mark = rating === 'up' ? '👍' : '👎';
    const ctx = ['update', 'checkin'].includes(body?.context) ? body.context : 'checkin';
    const title = checkin
      ? `Check-in ${mark} (${ctx}) v${env.appVersion ?? '?'}${comment ? `: ${comment.slice(0, 50)}` : ''}`
      : comment.length > 72 ? `${comment.slice(0, 69)}…` : comment;
    const lines = [
      comment || (checkin ? `_${mark} with no note._` : ''),
      '',
      target?.label ? `**Target:** ${String(target.label).slice(0, 200)}` : null,
      reporterEmail ? `**Reported by** ${reporterEmail}` : null,
      '',
      '### Environment',
      `- App: ${env.appVersion ?? '-'}`,
      `- OS: ${env.platform ?? '-'} ${env.osVersion ?? ''} (${env.arch ?? ''})`.trim(),
      `- Electron: ${env.electronVersion ?? '-'}`,
      `- Locale: ${env.locale ?? '-'}`,
      env.windowSize
        ? `- Window: ${env.windowSize.width}×${env.windowSize.height}`
        : null,
      '',
      imageUrl ? '### Screenshot (redacted)' : null,
      imageUrl ? `![window](${imageUrl})` : null,
      '',
      checkin ? '_Anonymous check-in from Plenum._' : '_Sent from Plenum. Local outbox kept a copy on the reporter’s Mac._',
    ].filter((l) => l != null);

    const [owner, repo] = githubRepo.split('/');
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'plenum-feedback-relay',
      },
      body: JSON.stringify({
        title,
        body: lines.join('\n'),
        labels: [checkin ? 'checkin' : 'feedback'],
      }),
    });
    if (!ghRes.ok) {
      const detail = await ghRes.text();
      throw new Error(`GitHub issue create failed (${ghRes.status}): ${detail.slice(0, 400)}`);
    }
    const issue = await ghRes.json();

    const { error: insertErr } = await supabase.from('feedback_reports').insert({
      id,
      issue_number: issue.number,
      issue_url: issue.html_url,
      ip_hash: ipHash,
      app_version: env.appVersion ? String(env.appVersion) : null,
      github_username: null,
      reporter_email: reporterEmail,
      status: 'created',
    });
    if (insertErr) throw new Error(`Audit insert failed: ${insertErr.message}`);

    return json(200, {
      issueUrl: issue.html_url,
      issueNumber: issue.number,
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: (e as Error).message || 'Submit failed' });
  }
});
