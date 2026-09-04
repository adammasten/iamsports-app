-- Season rosters — PHASE 4: coach-editable spell dates
-- Plan: docs/SEASON_ROSTERS_PLAN.md  (Phases 1-3: 20260904034415 / 034418 / 035442)
--
-- Phases 1-3 made "was this kid on the team when this game happened" the basis for
-- durable family film access — but `joined_on` was backfilled from `created_at`,
-- the row-INSERT timestamp. That is a system fact standing in for a domain fact,
-- and it is wrong wherever a coach entered the roster after uploading film.
--
-- Live consequences right now:
--   * Centex Attack Regents' two 2026-08-10/11 games (4 videos) — roster entered
--     08-13, so no spell covers them.
--   * That team's "Winter 2026" season (Jan 1 - Feb 7) reports a roster of ZERO.
--
-- Neither is fixable from the app today: `player_teams` has ONLY a SELECT policy
-- (verified — no INSERT/UPDATE/DELETE policies at all), so every write must go
-- through a SECURITY DEFINER RPC. These are those RPCs.
--
-- `player_teams.jersey_number` is per-SPELL, so editing history also gives correct
-- historical box scores (#12 in 2025, #4 in 2026) for free.

-- ---------------------------------------------------------------------------
-- 1. Read: every spell on a team, past and present (coach/member view)
-- ---------------------------------------------------------------------------
create or replace function public.get_team_spells(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (is_team_member(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to view this roster';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'spell_id',  pt.id,
             'player_id', pt.player_id,
             'name',      p.name,
             'jersey',    pt.jersey_number,
             'joined_on', pt.joined_on,
             'left_on',   pt.left_on,
             'season_id', pt.season_id,
             'current',   (pt.left_on is null)
           ) order by p.name, pt.joined_on desc)
    from player_teams pt
    join players p on p.id = pt.player_id
    where pt.team_id = p_team_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Write: correct a spell's dates
-- ---------------------------------------------------------------------------
create or replace function public.set_player_spell_dates(
  p_spell_id uuid, p_joined_on date, p_left_on date
) returns void language plpgsql security definer set search_path to 'public' as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_joined_on is null then raise exception 'A join date is required'; end if;

  select team_id into t from player_teams where id = p_spell_id;
  if t is null then raise exception 'Roster entry not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then
    raise exception 'Only a team coach can change roster dates';
  end if;

  if p_left_on is not null and p_left_on < p_joined_on then
    raise exception 'A player cannot leave before they joined';
  end if;
  if p_joined_on > current_date then
    raise exception 'A join date cannot be in the future';
  end if;

  begin
    update player_teams
       set joined_on = p_joined_on, left_on = p_left_on
     where id = p_spell_id;
  exception when unique_violation then
    -- Clearing left_on while another open spell exists for the same kid+team.
    raise exception 'That player already has a current roster entry on this team. Give this one an end date first.';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Write: pin a spell to a season (the optional override from Phase 2)
-- ---------------------------------------------------------------------------
create or replace function public.set_player_spell_season(
  p_spell_id uuid, p_season_id uuid
) returns void language plpgsql security definer set search_path to 'public' as $$
declare t uuid; st uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select team_id into t from player_teams where id = p_spell_id;
  if t is null then raise exception 'Roster entry not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then
    raise exception 'Only a team coach can change roster seasons';
  end if;
  if p_season_id is not null then
    select team_id into st from seasons where id = p_season_id;
    if st is null then raise exception 'Season not found'; end if;
    if st <> t then raise exception 'That season belongs to a different team'; end if;
  end if;
  update player_teams set season_id = p_season_id where id = p_spell_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Lock to authenticated (PUBLIC grant is inherited by anon — see
--    20260904033115_harden_resolve_any_code)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname in ('get_team_spells','set_player_spell_dates','set_player_spell_season')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
