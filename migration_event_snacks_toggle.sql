-- =====================================================================
-- Coaches can turn snack sign-up OFF per event (default on).
-- APPLIED LIVE via the Supabase MCP.
-- =====================================================================
alter table public.events add column if not exists snacks_enabled boolean not null default true;
-- enqueue_snack_reminders() also gained "and e.snacks_enabled" (see migration_snacks.sql / live fn).
-- =====================================================================
