-- Reversible soft-delete for schedule events, mirroring games/videos.
-- Enables "delete a game" to also remove its linked calendar event without
-- losing the ability to restore it. Reads filter deleted_at at the app layer
-- (lib/core/schedule.ts loadEvents) — same convention as games.
-- Applied live 2026-08-29. See also:
--   migration_delete_game_cascades_to_linked_event.sql
--   migration_restore_game_also_restores_linked_event.sql

alter table public.events add column if not exists deleted_at timestamptz;

-- Partial index so the common "live events for a team by date" read stays fast.
create index if not exists events_live_by_team_date_idx
  on public.events (team_id, local_date)
  where deleted_at is null;
