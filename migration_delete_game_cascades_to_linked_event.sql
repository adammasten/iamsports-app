-- "Delete means gone everywhere" (CLAUDE.md invariant #6): deleting a game now
-- also soft-deletes its linked schedule/calendar event, so nothing is orphaned
-- on the schedule. Reversible (restore_game sets deleted_at back to null).
-- Applied live 2026-08-29. Requires migration_events_add_deleted_at_soft_delete.sql.

create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t uuid; ev uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select team_id, event_id into t, ev from games where id = p_game_id and deleted_at is null;
  if t is null then raise exception 'Game not found'; end if;
  if not can_delete_team_content(t) then
    raise exception 'Only a team admin (or someone granted Delete content) can delete a game';
  end if;
  update games  set deleted_at = now() where id = p_game_id;
  update videos set deleted_at = now() where game_id = p_game_id and deleted_at is null;
  -- Delete everywhere: also soft-delete the linked schedule/calendar event.
  if ev is not null then
    update events set deleted_at = now() where id = ev and deleted_at is null;
  end if;
end $function$;
