-- Cross-team player identity — Slice 1: coach-side linking.
-- Lights up the dormant players.player_lineage_id (grouping id) and adds
-- coach-gated RPCs to link / unlink player rows that are the same human.
-- NOTE: this only records identity; the cross-team viewing + unified claim that
-- USE the lineage are later slices. Safe on its own.

-- 1. Every existing player becomes its own lineage root (the intended backfill,
--    never applied to live). A row's lineage = its own id until linked.
update public.players set player_lineage_id = id where player_lineage_id is null;

-- 2. Authorization helper: may the caller assert identity for THIS player row?
--    True if super admin, OR they coach the player's team, OR they're a linked
--    parent of it (covers a teamless "add a kid" row).
create or replace function public.can_link_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or exists (select 1 from public.players p
                 where p.id = p_player
                   and ((p.team_id is not null and public.is_team_coach(p.team_id))
                        or public.is_linked_parent(p.id)));
$$;

-- 3. Link two players into one identity: merge p_merge's whole lineage onto
--    p_keep's lineage. Caller must be authorized for BOTH.
create or replace function public.link_players(p_keep uuid, p_merge uuid)
returns void language plpgsql security definer set search_path = public as $$
declare keep_lin uuid; merge_lin uuid;
begin
  if p_keep = p_merge then raise exception 'Cannot link a player to itself'; end if;
  if not public.can_link_player(p_keep) or not public.can_link_player(p_merge) then
    raise exception 'Not authorized to link these players';
  end if;
  select coalesce(player_lineage_id, id) into keep_lin  from public.players where id = p_keep;
  select coalesce(player_lineage_id, id) into merge_lin from public.players where id = p_merge;
  if keep_lin is null or merge_lin is null then raise exception 'Player not found'; end if;
  if keep_lin = merge_lin then return; end if;  -- already linked
  update public.players set player_lineage_id = keep_lin where player_lineage_id = merge_lin;
end $$;

-- 4. Unlink a player: split it back onto its own lineage.
create or replace function public.unlink_player(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_link_player(p_player) then raise exception 'Not authorized'; end if;
  update public.players set player_lineage_id = id where id = p_player;
end $$;

grant execute on function public.can_link_player(uuid) to authenticated;
grant execute on function public.link_players(uuid, uuid) to authenticated;
grant execute on function public.unlink_player(uuid) to authenticated;
