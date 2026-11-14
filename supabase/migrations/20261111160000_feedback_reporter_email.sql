-- Optional credit attaches the reporter's git email (not GitHub username).

alter table public.feedback_reports
  add column if not exists reporter_email text;
