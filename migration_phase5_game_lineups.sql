-- migration_phase5_game_lineups.sql — Phase 5: record who played each game.
-- game_lineups(game_id, player_id) is the athlete-attribution spine for the
-- leaving-a-team archive: "every game my kid played" = games where the kid has a
-- lineup row. We snapshot the team's roster at game-creation time (a frozen
-- record of who was on the team then), via a trigger so it's path-independent
-- (upload.tsx and any future game-creation flow are all caught).
--
-- Forward-only: existing games are NOT backfilled (their attribution comes from
-- player-tags where tagged). Deliberate — a snapshot means "roster at creation."
--
-- Because game_lineups.game_id is ON DELETE RESTRICT (Phase 0), a raw
-- games.delete() now errors once a game has a lineup. delete_game() is the
-- graceful path: coach-gated, clears the lineup, then deletes the game (which
-- cascades its videos -> clips -> clip_tags). Intentional coach deletes still
-- work; accidental/silent cascades stay blocked.

create or replace function public.snapshot_game_lineup()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into game_lineups (game_id, player_id, added_by_user_id)
  select NEW.id, pt.player_id, auth.uid()
  from player_teams pt
  where pt.team_id = NEW.team_id
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists on_games_insert on games;
create trigger on_games_insert
  after insert on games
  for each row execute function public.snapshot_game_lineup();

create or replace function public.delete_game(p_game_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then
    raise exception 'Only a team coach can delete a game';
  end if;
  delete from game_lineups where game_id = p_game_id;  -- release the RESTRICT guard
  delete from games where id = p_game_id;              -- cascades videos -> clips -> clip_tags
end $$;
grant execute on function public.delete_game(uuid) to authenticated;
