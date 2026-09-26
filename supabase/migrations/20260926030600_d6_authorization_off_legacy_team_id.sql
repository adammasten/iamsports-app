-- ============================================================================
-- Slice D6 — MOVE AUTHORIZATION OFF THE LEGACY players.team_id
--
-- THE PROBLEM
--   players.team_id is a single legacy pointer from before per-season spells existed. A child
--   plays for many teams over time; player_teams is the truth. Yet authorization still keys on
--   the legacy column in:
--       players_read / players_insert / players_update / players_delete
--       parent_player_links_read (its coach branch)
--       can_link_player  -> and therefore link_players
--       update_kid_profile
--   Consequences, both directions:
--     * a coach whose team the child has LEFT still reads the child's current profile, while
--     * a coach of a team the child actually plays for TODAY can be locked out, because the
--       legacy pointer names a different team. Verified on live production: 1 of 53 children
--       (Conrad) has a legacy pointer that disagrees with his only open spell, and 2 open
--       spells are not covered by the legacy gate at all.
--
-- THE FIX
--   Authorization reads actual CURRENT relationships (open spells), via three spell-aware
--   helpers. Same shape as the existing is_team_member / is_team_coach helpers.
--
-- ALSO IN THIS SLICE
--   * the resolved_game_stats "TEAM" relabel trap (plan v2 §5.4) — a latent
--     history-corrupting bug that tightening players_read would otherwise activate.
--   * link_players / can_link_player authority (a coach could fuse two different families'
--     children into one recorded identity assertion).
--   * update_kid_profile field ownership (plan v2 §4.2/§4.3).
--
-- BUILD 68 COMPATIBILITY — verified against live data before writing
--   * players_read: every child readable today stays readable. 4 children have no spell at
--     all, and all 4 have guardians, so 0 become invisible. Coach placeholders always get a
--     player_teams row (create_roster_placeholder writes one), so a coach never loses the
--     roster spot they just created.
--   * parent_player_links_read KEEPS its coach branch, converted to spells. Removing it (as
--     plan v2 §4.4 proposes) would break Build 68's Roster guardian counts
--     (app/(tabs)/roster.tsx:95), which read the table directly. That tightening is therefore
--     DEFERRED behind a counts RPC + a new client -- documented, not silently dropped.
--   * players_insert/update/delete tighten to definer-RPC-only paths. Verified by grep:
--     NOT ONE client code path writes these three tables directly, so no call path can break.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SPELL-AWARE AUTHORIZATION HELPERS
-- ----------------------------------------------------------------------------
create or replace function public.is_current_team_member_of_player(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from player_teams pt
    where pt.player_id = p_player
      and pt.left_on is null
      and public.is_team_member(pt.team_id)
  );
$function$;

create or replace function public.is_current_team_coach_of_player(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from player_teams pt
    where pt.player_id = p_player
      and pt.left_on is null
      and public.is_team_coach(pt.team_id)
  );
$function$;

create or replace function public.player_has_guardian(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from parent_player_links where player_id = p_player);
$function$;

grant execute on function public.is_current_team_member_of_player(uuid) to authenticated, service_role;
grant execute on function public.is_current_team_coach_of_player(uuid)  to authenticated, service_role;
grant execute on function public.player_has_guardian(uuid)              to authenticated, service_role;

comment on function public.is_current_team_member_of_player(uuid) is
  'TRUE when the caller is a confirmed member of ANY team the child has an OPEN spell on (Slice D6). Replaces is_team_member(players.team_id), which both over- and under-granted.';

-- ----------------------------------------------------------------------------
-- 2. players RLS — current relationships only, and tombstones hidden
-- ----------------------------------------------------------------------------
drop policy if exists players_read on public.players;
create policy players_read on public.players
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      -- A retired identity vanishes from every roster, kid rail and picker without a delete.
      merged_into_id is null
      and (public.is_linked_parent(id) or public.is_current_team_member_of_player(id))
    )
  );

-- All creation goes through SECURITY DEFINER RPCs (create_kid, create_roster_placeholder,
-- create_kid_and_join_team). Closing direct INSERT removes a path where a coach could insert
-- a players row with arbitrary column values, including identity_state or a tombstone.
drop policy if exists players_insert on public.players;
create policy players_insert on public.players
  for insert to authenticated
  with check (public.is_super_admin());

-- Identity is FAMILY-owned the moment a family exists (plan v2 §4.3). A coach may still type
-- a name onto a slot nobody owns -- that is how every roster starts -- but loses identity
-- write authority the instant the child is claimed.
drop policy if exists players_update on public.players;
create policy players_update on public.players
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_linked_parent(id)
    or (not public.player_has_guardian(id) and public.is_current_team_coach_of_player(id))
  );

drop policy if exists players_delete on public.players;
create policy players_delete on public.players
  for delete to authenticated
  using (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 3. parent_player_links_read — coach branch moved onto spells
--    NOT removed: see the Build 68 note in the header.
-- ----------------------------------------------------------------------------
drop policy if exists parent_player_links_read on public.parent_player_links;
create policy parent_player_links_read on public.parent_player_links
  for select to authenticated
  using (
    public.is_super_admin()
    or parent_user_id = (select auth.uid())
    or public.is_current_team_coach_of_player(player_id)
  );

-- ----------------------------------------------------------------------------
-- 4. RECORDED-IDENTITY LINKING AUTHORITY (link_players / can_link_player)
--
--    THE HOLE: can_link_player granted authority to a coach of the child's LEGACY team, per
--    player independently. A coach of two teams could therefore fuse two DIFFERENT families'
--    children into one recorded identity assertion -- and that assertion is exactly what D4's
--    list_identity_conflicts treats as "someone has already recorded these as the same
--    child". Non-destructive, but it forges the strongest non-guardian signal in the model
--    and it is precisely the authority collapse D2 forbids.
--
--    THE RULE (plan v2 §7.2, applied to assertions rather than to data movement):
--      * super admin                                        -> always
--      * a guardian of BOTH rows                            -> yes
--      * a coach, ONLY when BOTH rows are unclaimed AND both have an open spell on one team
--        they coach                                         -> yes (case 1: no family exists)
--      * anything else, including a coach where either row has a family -> NO
-- ----------------------------------------------------------------------------
create or replace function public.can_link_player(p_player uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Retained for backward compatibility (installed builds and any other caller). It now
  -- reflects CURRENT spells rather than the legacy pointer. Note that link_players no longer
  -- relies on it alone -- see below.
  select public.is_super_admin()
      or public.is_linked_parent(p_player)
      or (not public.player_has_guardian(p_player)
          and public.is_current_team_coach_of_player(p_player));
$function$;

create or replace function public.link_players(p_keep uuid, p_merge uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare keep_lin uuid; merge_lin uuid; v_auth text;
begin
  if p_keep = p_merge then raise exception 'Cannot link a player to itself'; end if;

  -- Reuse the SAME authority matrix reconciliation uses, so an assertion can never be made by
  -- someone who would not be allowed to act on it. reconcile_authority returns NULL for a
  -- coach whenever either row belongs to a family.
  v_auth := public.reconcile_authority(p_keep, p_merge);
  if v_auth is null then
    raise exception 'Not authorized to record these as the same child'
      using errcode = 'insufficient_privilege',
            hint = 'A coach may only link two roster spots that have no family attached. Otherwise raise a reconciliation request (request_player_merge).';
  end if;

  select coalesce(player_lineage_id, id) into keep_lin  from public.players where id = p_keep;
  select coalesce(player_lineage_id, id) into merge_lin from public.players where id = p_merge;
  if keep_lin is null or merge_lin is null then raise exception 'Player not found'; end if;
  if keep_lin = merge_lin then return; end if;

  update public.players set player_lineage_id = keep_lin where player_lineage_id = merge_lin;
  -- rows that had no lineage yet still need to join the group
  update public.players set player_lineage_id = keep_lin
   where id in (p_keep, p_merge) and player_lineage_id is null;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (auth.uid(), 'link_players', auth.uid(), 'players', p_keep,
          jsonb_build_object('kept', p_keep, 'linked', p_merge, 'authority', v_auth));
end $function$;

create or replace function public.unlink_player(p_player uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.can_link_player(p_player) then raise exception 'Not authorized'; end if;
  update public.players set player_lineage_id = id where id = p_player;
end $function$;

-- ----------------------------------------------------------------------------
-- 5. FIELD OWNERSHIP (plan v2 §4.2 / §4.3)
--
--    update_kid_profile wrote name + jersey_number + grad_class in one call, authorised by
--    "guardian OR coach of players.team_id" -- so a coach could rename a claimed child, and
--    jersey (a TEAM fact) travelled with identity (a FAMILY fact).
--
--    Split into two capabilities. The legacy RPC is kept as a thin shim so Build 68 keeps
--    working, and it now routes each field to its correct owner.
-- ----------------------------------------------------------------------------
create or replace function public.update_player_identity(
  p_player_id uuid,
  p_name       text default null,
  p_grad_class text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- FAMILY-owned, with the unclaimed-placeholder carve-out: a coach may name a slot nobody
  -- owns, and loses that authority the moment a family claims the child.
  if not (public.is_super_admin()
          or public.is_linked_parent(p_player_id)
          or (not public.player_has_guardian(p_player_id)
              and public.is_current_team_coach_of_player(p_player_id))) then
    raise exception 'Only this child''s family can change their name or graduation year'
      using hint = 'A coach can edit a roster spot only until a family claims it.';
  end if;

  update players set
    name       = coalesce(nullif(trim(p_name), ''), name),
    grad_class = case when p_grad_class is null then grad_class else nullif(trim(p_grad_class), '') end
  where id = p_player_id;

  -- keep each team's chip label in step with the (possibly) new name
  update tags tg set name = case when split_part(p.name, ' ', 1) like '#%'
    then split_part(p.name, ' ', 1)
    else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(
      (select pt.jersey_number from player_teams pt
        where pt.player_id = tg.player_id and pt.team_id = tg.team_id limit 1)
    ), ''), '') end
  from players p
  where tg.player_id = p_player_id and tg.category = 'players' and p.id = p_player_id;
end $function$;

create or replace function public.update_player_team_details(
  p_player_id uuid, p_team_id uuid, p_jersey text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  -- TEAM-owned: the coach of THAT team, and the child's own family.
  if not (public.is_super_admin() or public.is_team_coach(p_team_id)
          or public.is_linked_parent(p_player_id)) then
    raise exception 'Only a coach of this team can change a player''s team details';
  end if;

  update player_teams
     set jersey_number = nullif(trim(coalesce(p_jersey, '')), '')
   where player_id = p_player_id and team_id = p_team_id and left_on is null;

  update tags tg set name = case when split_part(p.name, ' ', 1) like '#%'
    then split_part(p.name, ' ', 1)
    else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(p_jersey), ''), '') end
  from players p
  where tg.player_id = p_player_id and tg.team_id = p_team_id
    and tg.category = 'players' and p.id = p_player_id;
end $function$;

grant execute on function public.update_player_identity(uuid, text, text)      to authenticated, service_role;
grant execute on function public.update_player_team_details(uuid, uuid, text)  to authenticated, service_role;

-- Legacy shim for installed builds: same signature, same call sites, fields now routed to
-- their correct owners. p_jersey is applied to the child's CURRENT team spell.
create or replace function public.update_kid_profile(
  p_player_id uuid, p_name text default null, p_jersey text default null, p_grad_class text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_team uuid;
begin
  if p_name is not null or p_grad_class is not null then
    perform public.update_player_identity(p_player_id, p_name, p_grad_class);
  end if;

  if p_jersey is not null then
    -- the team whose roster the caller is acting on: a team they coach, else the child's only
    -- open spell.
    select pt.team_id into v_team from player_teams pt
     where pt.player_id = p_player_id and pt.left_on is null
       and public.is_team_coach(pt.team_id)
     limit 1;
    if v_team is null then
      select pt.team_id into v_team from player_teams pt
       where pt.player_id = p_player_id and pt.left_on is null limit 1;
    end if;
    if v_team is not null then
      perform public.update_player_team_details(p_player_id, v_team, p_jersey);
    end if;
  end if;
end $function$;

comment on function public.update_kid_profile(uuid, text, text, text) is
  'DEPRECATED shim (Slice D6). Routes identity fields to update_player_identity (family-owned) and jersey to update_player_team_details (team-owned). Retained so installed builds keep working; new clients should call the two specific RPCs.';

-- ----------------------------------------------------------------------------
-- 6. THE resolved_game_stats "TEAM" RELABEL TRAP (plan v2 §5.4)
--
--    The stats views are security_invoker, so `LEFT JOIN players p` is subject to
--    players_read. Once §2 above tightens that policy, a DEPARTED child's manually entered
--    stat line joins to nothing and COALESCE(p.name,'TEAM') silently relabels their historical
--    numbers as "TEAM" -- corrupting a past box score and folding an individual's stats into
--    the team row.
--
--    Fix: resolve the display name from the TEAM-OWNED chip first (tags are team-scoped and
--    survive a child's departure), then players.name, and use 'TEAM' ONLY when player_id is
--    genuinely NULL. Team-owned history renders with team-owned data.
--
--    game_stat_lines has 0 live rows, so there is no current damage -- this prevents a latent
--    bug from becoming a real one.
-- ----------------------------------------------------------------------------
create or replace view public.resolved_game_stats
with (security_invoker = true) as
 WITH manual AS (
         SELECT gsl.game_id,
            gsl.player_id,
            CASE
              WHEN gsl.player_id IS NULL THEN 'TEAM'::text
              ELSE COALESCE(
                     (SELECT t.name FROM tags t
                       JOIN games g2 ON g2.id = gsl.game_id
                      WHERE t.player_id = gsl.player_id
                        AND t.category = 'players'::text
                        AND t.team_id = g2.team_id
                      LIMIT 1),
                     p.name,
                     'Unknown player'::text)
            END AS player_name,
            gsl.stat_side, gsl.fgm, gsl.fga, gsl.fg3m, gsl.fg3a, gsl.ftm, gsl.fta,
            gsl.oreb, gsl.dreb, gsl.oreb + gsl.dreb AS reb,
            gsl.ast, gsl.tov, gsl.stl, gsl.blk, gsl.pf, gsl.tf,
            2 * (gsl.fgm - gsl.fg3m) + 3 * gsl.fg3m + gsl.ftm AS pts,
            'manual'::text AS source
           FROM game_stat_lines gsl
             LEFT JOIN players p ON p.id = gsl.player_id
        ), derived AS (
         SELECT gbs.game_id, gbs.player_id, gbs.player AS player_name, gbs.stat_side,
            gbs.fgm_2 + gbs.fgm_3 AS fgm, gbs.fga_2 + gbs.fga_3 AS fga,
            gbs.fgm_3 AS fg3m, gbs.fga_3 AS fg3a, gbs.ftm, gbs.fta,
            gbs.oreb, gbs.dreb, gbs.reb, gbs.ast, gbs.tov, gbs.stl, gbs.blk,
            gbs.pf, gbs.tf, gbs.pts, 'tagged'::text AS source
           FROM game_box_score gbs
          WHERE NOT (EXISTS ( SELECT 1 FROM manual m
                  WHERE m.game_id = gbs.game_id AND m.stat_side = gbs.stat_side
                    AND NOT m.player_id IS DISTINCT FROM gbs.player_id))
        )
 SELECT game_id, player_id, player_name, stat_side, fgm, fga, fg3m, fg3a, ftm, fta,
        oreb, dreb, reb, ast, tov, stl, blk, pf, tf, pts, source FROM manual
UNION ALL
 SELECT game_id, player_id, player_name, stat_side, fgm, fga, fg3m, fg3a, ftm, fta,
        oreb, dreb, reb, ast, tov, stl, blk, pf, tf, pts, source FROM derived;

comment on view public.resolved_game_stats is
  'Manual + tagged stats per game. Display names resolve from the TEAM-OWNED chip first so a departed or unreadable child never gets relabelled "TEAM" and folded into the team row (plan v2 §5.4, fixed in Slice D6). "TEAM" now appears only when player_id IS NULL.';

notify pgrst, 'reload schema';
