-- =====================================================================
-- Stage 4: per-team subscribable calendar feed token.
-- APPLIED LIVE via the Supabase MCP (migration: teams_ics_token).
-- ics_token is an unguessable per-team key embedded in the webcal:// URL — it IS
-- the auth for the public read-only feed (calendar apps can't send a JWT).
-- Served by supabase/functions/team-calendar (ETag-cached ICS).
-- =====================================================================
alter table public.teams add column if not exists ics_token text;
update public.teams set ics_token = replace(gen_random_uuid()::text, '-', '') where ics_token is null;
alter table public.teams alter column ics_token set default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists teams_ics_token_key on public.teams(ics_token);
-- =====================================================================
