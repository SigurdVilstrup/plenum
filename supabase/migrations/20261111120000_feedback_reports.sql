-- Feedback relay audit + rate limit. Service role only (no anon policies).

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  issue_number int,
  issue_url text,
  ip_hash text not null,
  app_version text,
  github_username text,
  status text not null default 'created'
    check (status in ('created', 'failed')),
  error text
);

create index if not exists feedback_reports_ip_created_idx
  on public.feedback_reports (ip_hash, created_at desc);

alter table public.feedback_reports enable row level security;

-- Storage bucket for redacted screenshots (public read for GitHub markdown).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  true,
  2000000,
  array['image/png']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read objects (needed for issue image URLs). No anon insert/update.
create policy "Public read feedback screenshots"
  on storage.objects for select
  to public
  using (bucket_id = 'feedback-screenshots');
