-- Season rosters — the season PIN now grants film access, not just roster listing
-- Plan: docs/SEASON_ROSTERS_PLAN.md
--
-- Adam's workflow is "attach a kid to that season, and readjust rosters after the
-- season's over" — i.e. lean on `player_teams.season_id` (the explicit pin) rather
-- than fuss with joined_on/left_on dates up front.
--
-- Until now the pin only affected ROSTER LISTING (`roster_for_season` checks the
-- pin before falling back to date overlap). Film ACCESS ignored it entirely —
-- `is_roster_parent` read only joined_on/left_on. So a kid pinned to Winter 2026
-- appeared on that roster while their family got no access to Winter 2026 film.
-- Two different answers to "was this kid part of this season" was the drift.
--
-- Now the pin is a first-class third branch. `is_roster_parent` grants when ANY of:
--   1. a SPELL covers the game's date            (inferred participation)
--   2. the kid is in the game's LINEUP           (coach's explicit assertion)
--   3. the kid's spell is PINNED to the game's season   ← NEW (coach's explicit
--                                                          seasonal assertion)
--
-- Still purely ADDITIVE — nobody loses access. The film-visible variant
-- (`is_roster_film_parent`) wraps this, so teams.parent_film_visible still gates
-- the bytes exactly as before.
--
-- "The game's season" resolves as `games.season_id` when set (only 6 of 18 games
-- carry one today), otherwise derived from the game's date via season_for_date().
-- That keeps the pin useful on the ~2/3 of games that have no season_id.

create or replace function public.is_roster_parent(p_game_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  -- 1. spell covers the game's date
  select exists (
    select 1
    from games g
    join player_teams pt         on pt.team_id = g.team_id
    join parent_player_links ppl on ppl.player_id = pt.player_id
    where g.id = p_game_id
      and ppl.parent_user_id = (select auth.uid())
      and pt.joined_on <= coalesce(g.game_date, current_date)
      and (pt.left_on is null or pt.left_on >= coalesce(g.game_date, current_date))
  )
  -- 2. the coach put the kid in this game's lineup
  or exists (
    select 1
    from game_lineups gl
    join parent_player_links ppl on ppl.player_id = gl.player_id
    where gl.game_id = p_game_id
      and ppl.parent_user_id = (select auth.uid())
  )
  -- 3. the kid's roster spell is pinned to this game's season
  or exists (
    select 1
    from games g
    join player_teams pt         on pt.team_id = g.team_id and pt.season_id is not null
    join parent_player_links ppl on ppl.player_id = pt.player_id
    where g.id = p_game_id
      and ppl.parent_user_id = (select auth.uid())
      and pt.season_id = coalesce(
            g.season_id,
            season_for_date(g.team_id, coalesce(g.game_date, current_date))
          )
  );
$$;
