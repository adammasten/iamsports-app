-- =====================================================================
-- Per-device Expo push tokens (Push Slice 1 foundation).
-- APPLIED LIVE via the Supabase MCP (migration: push_device_tokens).
-- A user can register several devices; token is globally unique (re-registering
-- updates its owner + updated_at). Users manage only their own rows; the
-- send-push edge function reads all tokens via the service role (bypasses RLS)
-- to deliver to other users.
-- =====================================================================
create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_push_tokens_user_idx on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

create policy device_push_tokens_select on public.device_push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy device_push_tokens_insert on public.device_push_tokens
  for insert to authenticated with check (user_id = auth.uid());
create policy device_push_tokens_update on public.device_push_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy device_push_tokens_delete on public.device_push_tokens
  for delete to authenticated using (user_id = auth.uid());
-- =====================================================================
