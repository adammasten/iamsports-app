-- suggest_duplicate_players: add per-side counts so the merge chooser can show
-- WHICH duplicate is the real, content-bearing one (and recommend it).
-- ---------------------------------------------------------------------------
-- A merge moves ALL references off the dup onto the keeper, so no content is
-- lost either way — the choice only decides which NAME/profile survives. To make
-- that an informed choice, return for each side:
--   *_guardians : linked guardians (>0 = a family's claimed profile)
--   *_content   : attached footage/stats (videos + game appearances + tagged clips)
-- The client picks the fuller side as the recommended keeper.
--
-- Return signature changes, so DROP then CREATE (create-or-replace can't change
-- a function's OUT columns). Coach/super-admin gated, unchanged.

drop function if exists public.suggest_duplicate_players(uuid);

create or replace function public.suggest_duplicate_players(p_team_id uuid)
returns table (
  keep_id uuid, keep_name text, keep_guardians int, keep_content int,
  dup_id uuid, dup_name text, dup_guardians int, dup_content int,
  sim real
)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not (is_team_coach(p_team_id) or is_super_admin()) then raise exception 'Not allowed'; end if;
  return query
    select pa.id, pa.name,
           (select count(*)::int from parent_player_links where player_id = pa.id),
           (select count(*)::int from videos where player_id = pa.id)
             + (select count(*)::int from game_lineups where player_id = pa.id)
             + (select count(*)::int from clip_tags ct join tags t on t.id = ct.tag_id where t.player_id = pa.id),
           pb.id, pb.name,
           (select count(*)::int from parent_player_links where player_id = pb.id),
           (select count(*)::int from videos where player_id = pb.id)
             + (select count(*)::int from game_lineups where player_id = pb.id)
             + (select count(*)::int from clip_tags ct join tags t on t.id = ct.tag_id where t.player_id = pb.id),
           similarity(pa.name, pb.name) as sim
    from player_teams ta
    join players pa on pa.id = ta.player_id
    join player_teams tb on tb.team_id = ta.team_id
    join players pb on pb.id = tb.player_id
    where ta.team_id = p_team_id
      and pa.id < pb.id
      and ( similarity(pa.name, pb.name) > 0.3
            or lower(split_part(pa.name, ' ', 1)) = lower(split_part(pb.name, ' ', 1)) )
    order by sim desc;
end $$;
grant execute on function public.suggest_duplicate_players(uuid) to authenticated;

notify pgrst, 'reload schema';
