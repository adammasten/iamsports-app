-- =====================================================================
-- Per-user log of AI schedule-photo imports, for the daily rate limit.
-- APPLIED LIVE via the Supabase MCP (migration: schedule_import_log).
-- Only the extract-schedule edge function (service role) reads/writes it;
-- RLS is enabled with no policies so nothing else can touch it.
-- =====================================================================
create table public.schedule_import_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index schedule_import_log_user_day_idx on public.schedule_import_log (user_id, created_at);
alter table public.schedule_import_log enable row level security;
-- =====================================================================
