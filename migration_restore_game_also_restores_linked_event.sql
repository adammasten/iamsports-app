-- Mirror of delete_game's cascade: restoring a game also un-deletes its linked
-- schedule/calendar event, so a restore brings the game back everywhere it was.
-- Applied live 2026-08-29. Requires migration_events_add_deleted_at_soft_delete.sql.

create or replace function public.restore_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t uuid; ev uuid;
begin
  select team_id, event_id into t, ev from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_super_admin() or is_team_admin(t)) then raise exception 'Only a team admin can restore'; end if;
  update games  set deleted_at = null where id = p_game_id;
  update videos set deleted_at = null where game_id = p_game_id;
  if ev is not null then
    update events set deleted_at = null where id = ev;
  end if;
end $function$;
