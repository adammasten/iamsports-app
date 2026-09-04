-- Season rosters — PHASE 2: season windows
-- Plan: docs/SEASON_ROSTERS_PLAN.md  (Phase 1: 20260904034415_phase1_roster_spells)
--
-- Seasons become real date windows, which is what turns "who was on the 3rd-grade
-- spring roster" from an unanswerable question into a query over Phase 1's spells.
--
-- Before this migration all 5 seasons had NULL starts_on/ends_on — the columns
-- existed but were never filled, which is why season_id could not be trusted as a
-- scoping key (6/18 games carried one).
--
-- The team stays the durable container. A season is a WINDOW on a team, never a
-- separate team — see the plan doc for why recreating teams per season was
-- rejected (it fragments film, which is the whole product).

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Backfill windows from the games actually played in each season
-- ---------------------------------------------------------------------------
-- Only where a season has games and no window yet. Seasons with no games (e.g.
-- "Legacy") keep NULL and are simply not date-resolvable until a coach sets them.
update public.seasons s
   set starts_on = coalesce(s.starts_on, g.first_game),
       ends_on   = coalesce(s.ends_on,   g.last_game)
  from (
    select season_id, min(game_date) as first_game, max(game_date) as last_game
    from public.games
    where season_id is not null and game_date is not null and deleted_at is null
    group by season_id
  ) g
 where g.season_id = s.id
   and (s.starts_on is null or s.ends_on is null);

-- ---------------------------------------------------------------------------
-- 2. Integrity: a season can't end before it starts, and two seasons on the SAME
--    team can't overlap (otherwise a game date resolves to two seasons and the
--    derived roster is ambiguous). NULL windows are exempt — they're just
--    not-yet-dated, not invalid.
-- ---------------------------------------------------------------------------
alter table public.seasons drop constraint if exists seasons_dates_ck;
alter table public.seasons
  add constraint seasons_dates_ck
  check (starts_on is null or ends_on is null or ends_on >= starts_on);

alter table public.seasons drop constraint if exists seasons_no_overlap;
alter table public.seasons
  add constraint seasons_no_overlap
  exclude using gist (
    team_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (starts_on is not null and ends_on is not null);

-- ---------------------------------------------------------------------------
-- 3. Coach-editable window
-- ---------------------------------------------------------------------------
create or replace function public.set_season_window(
  p_season_id uuid, p_starts_on date, p_ends_on date
) returns void language plpgsql security definer set search_path to 'public' as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select team_id into t from seasons where id = p_season_id;
  if t is null then raise exception 'Season not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then
    raise exception 'Only a team coach can set season dates';
  end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A season cannot end before it starts';
  end if;
  -- The exclusion constraint raises 23P01 on an overlap; translate it so the UI
  -- shows something a coach can act on rather than a raw Postgres error.
  begin
    update seasons set starts_on = p_starts_on, ends_on = p_ends_on where id = p_season_id;
  exception when exclusion_violation then
    raise exception 'Those dates overlap another season on this team. Seasons on one team cannot overlap.';
  end;
end $$;
grant execute on function public.set_season_window(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Resolvers
-- ---------------------------------------------------------------------------

-- Which season does a date fall in, for this team? (null when undated/none)
create or replace function public.season_for_date(p_team_id uuid, p_on date)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select s.id from seasons s
  where s.team_id = p_team_id
    and s.starts_on is not null and s.ends_on is not null
    and p_on between s.starts_on and s.ends_on
  limit 1;
$$;
grant execute on function public.season_for_date(uuid, date) to authenticated, service_role;

-- The roster for a season = spells overlapping that season's window, PLUS any
-- spell explicitly pinned to it. The pin wins when a coach has been explicit;
-- dates carry everything else. Jersey comes from the SPELL, so a historical
-- roster shows the number the kid actually wore that season.
create or replace function public.roster_for_season(p_team_id uuid, p_season_id uuid)
returns table(player_id uuid, name text, jersey_number text, joined_on date, left_on date)
language plpgsql stable security definer set search_path to 'public' as $$
declare s_start date; s_end date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (is_team_member(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to view this roster';
  end if;
  select starts_on, ends_on into s_start, s_end
  from seasons where id = p_season_id and team_id = p_team_id;
  if not found then raise exception 'Season not found for this team'; end if;

  return query
    select distinct on (p.id)
           p.id, p.name, pt.jersey_number, pt.joined_on, pt.left_on
    from player_teams pt
    join players p on p.id = pt.player_id
    where pt.team_id = p_team_id
      and (
        pt.season_id = p_season_id
        or (
          s_start is not null and s_end is not null
          and pt.joined_on <= s_end
          and (pt.left_on is null or pt.left_on >= s_start)
        )
      )
    order by p.id, (pt.season_id = p_season_id) desc nulls last, pt.joined_on desc;
end $$;
grant execute on function public.roster_for_season(uuid, uuid) to authenticated, service_role;

-- Seasons for a team, newest window first, with a live roster count. Drives the
-- season picker in Phase 4's UI.
create or replace function public.team_seasons(p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (is_team_member(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to view this team';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'season_id', s.id,
             'name', s.name,
             'starts_on', s.starts_on,
             'ends_on', s.ends_on,
             'dated', (s.starts_on is not null and s.ends_on is not null),
             'roster_count', (
               select count(distinct pt.player_id) from player_teams pt
               where pt.team_id = p_team_id
                 and (pt.season_id = s.id
                      or (s.starts_on is not null and s.ends_on is not null
                          and pt.joined_on <= s.ends_on
                          and (pt.left_on is null or pt.left_on >= s.starts_on)))
             ),
             'game_count', (select count(*) from games g
                            where g.season_id = s.id and g.deleted_at is null)
           ) order by s.starts_on desc nulls last, s.name)
    from seasons s where s.team_id = p_team_id
  ), '[]'::jsonb);
end $$;
grant execute on function public.team_seasons(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Lock the new functions to authenticated (same rule as
--    20260904033115_harden_resolve_any_code)
-- ---------------------------------------------------------------------------
-- `grant ... to authenticated` does NOT remove the default PUBLIC grant, and
-- `anon` INHERITS PUBLIC — so without this an anonymous caller reaches these.
-- `was_on_roster` and `season_for_date` are plain SQL with no auth guard of
-- their own, so anon could probe "was this player on this team on this date"
-- given the ids. Revoke PUBLIC, then grant explicitly.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('was_on_roster','roster_for_season','season_for_date',
                        'team_seasons','set_season_window')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
