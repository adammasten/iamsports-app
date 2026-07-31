-- migration_merge_players.sql — duplicate-kid merge (applied as merge_players)
-- Merge two accidentally-created players into one: repoint EVERY reference from
-- the dup onto the keeper (conflict-safe against the real PKs/uniques), merge the
-- stats tag so clip_tags land under one tag, then delete the dup (which cascades
-- the dup's guardian code + followers). Gate: a guardian of BOTH players, a coach
-- of a team BOTH are on, or a super admin. Transactional (all-or-nothing).
-- Plus suggest_duplicate_players: pg_trgm fuzzy name match within a team (coach-gated).

create extension if not exists pg_trgm;

create or replace function public.merge_players(p_keep uuid, p_dup uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); keep_tag uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_keep = p_dup then raise exception 'Cannot merge a player with itself'; end if;

  if not (
    is_super_admin()
    or (is_linked_parent(p_keep) and is_linked_parent(p_dup))
    or exists (
      select 1 from player_teams a
      join player_teams b on b.team_id = a.team_id
      where a.player_id = p_keep and b.player_id = p_dup and is_team_coach(a.team_id)
    )
  ) then
    raise exception 'Not allowed to merge these players';
  end if;

  perform 1 from players where id = least(p_keep, p_dup) for update;
  perform 1 from players where id = greatest(p_keep, p_dup) for update;

  update videos set player_id = p_keep where player_id = p_dup;
  update shares set target_player_id = p_keep where target_player_id = p_dup;

  update game_lineups gl set player_id = p_keep
    where gl.player_id = p_dup
      and not exists (select 1 from game_lineups k where k.game_id = gl.game_id and k.player_id = p_keep);
  delete from game_lineups where player_id = p_dup;

  update player_teams pt set player_id = p_keep
    where pt.player_id = p_dup
      and not exists (select 1 from player_teams k where k.team_id = pt.team_id and k.player_id = p_keep);
  delete from player_teams where player_id = p_dup;

  update parent_player_links l set player_id = p_keep
    where l.player_id = p_dup
      and not exists (select 1 from parent_player_links k where k.parent_user_id = l.parent_user_id and k.player_id = p_keep);
  delete from parent_player_links where player_id = p_dup;

  update team_player_permissions tpp set player_id = p_keep
    where tpp.player_id = p_dup
      and not exists (select 1 from team_player_permissions k
                      where k.team_id = tpp.team_id and k.player_id = p_keep and k.permission = tpp.permission);
  delete from team_player_permissions where player_id = p_dup;

  select id into keep_tag from tags where player_id = p_keep and category = 'players' limit 1;
  if keep_tag is not null then
    update clip_tags ct set tag_id = keep_tag
      from tags t
      where ct.tag_id = t.id and t.player_id = p_dup and t.category = 'players'
        and not exists (select 1 from clip_tags k
                        where k.clip_id = ct.clip_id and k.tag_id = keep_tag and k.bundle_number = ct.bundle_number);
    delete from clip_tags ct using tags t
      where ct.tag_id = t.id and t.player_id = p_dup and t.category = 'players';
    delete from tags where player_id = p_dup and category = 'players';
  else
    update tags set player_id = p_keep where player_id = p_dup and category = 'players';
  end if;

  update players k set player_lineage_id = d.player_lineage_id
    from players d
    where k.id = p_keep and d.id = p_dup
      and k.player_lineage_id is null and d.player_lineage_id is not null;

  delete from players where id = p_dup;

  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'merge_players', 'players', p_keep, jsonb_build_object('kept', p_keep, 'merged', p_dup));
end $$;
grant execute on function public.merge_players(uuid, uuid) to authenticated;


create or replace function public.suggest_duplicate_players(p_team_id uuid)
returns table (keep_id uuid, keep_name text, dup_id uuid, dup_name text, sim real)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not (is_team_coach(p_team_id) or is_super_admin()) then raise exception 'Not allowed'; end if;
  return query
    select pa.id, pa.name, pb.id, pb.name, similarity(pa.name, pb.name) as sim
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
