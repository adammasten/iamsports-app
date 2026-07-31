-- migration_edit_game_lineup.sql — coach edits which players are attributed to a
-- game (the game_lineups set). Covers the late-upload edge (a game uploaded after
-- a roster change) and gives manual control (a kid who didn't travel, or adding
-- one who did). Both coach-gated SECURITY DEFINER so the screen needs no
-- game_lineups RLS.

-- Read: the roster to show as a checklist — active players PLUS anyone already in
-- this game's lineup (so a since-left kid stays checked, not silently dropped).
create or replace function public.get_game_lineup_editor(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t uuid; result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then raise exception 'Only a team coach can edit the lineup'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', x.player_id, 'label', x.label, 'in_lineup', x.in_lineup) order by x.label), '[]'::jsonb)
  into result
  from (
    select p.id as player_id,
           case when split_part(p.name, ' ', 1) like '#%' then p.name
                else p.name || coalesce(' #' || nullif(trim(pt.jersey_number), ''), '') end as label,
           exists (select 1 from game_lineups gl where gl.game_id = p_game_id and gl.player_id = p.id) as in_lineup
    from players p
    join player_teams pt on pt.player_id = p.id and pt.team_id = t
    where pt.left_at is null
       or exists (select 1 from game_lineups gl where gl.game_id = p_game_id and gl.player_id = p.id)
  ) x;
  return result;
end $$;
grant execute on function public.get_game_lineup_editor(uuid) to authenticated;

-- Write: replace the game's lineup with the given player set (only players on
-- this team qualify). Add + remove in one call.
create or replace function public.set_game_lineup(p_game_id uuid, p_player_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then raise exception 'Only a team coach can edit the lineup'; end if;

  delete from game_lineups
  where game_id = p_game_id and player_id <> all(coalesce(p_player_ids, '{}'::uuid[]));

  insert into game_lineups (game_id, player_id, added_by_user_id)
  select p_game_id, pid, uid
  from unnest(coalesce(p_player_ids, '{}'::uuid[])) as pid
  where exists (select 1 from player_teams pt where pt.player_id = pid and pt.team_id = t)
  on conflict do nothing;
end $$;
grant execute on function public.set_game_lineup(uuid, uuid[]) to authenticated;
