-- migration_phase0_delete_guards.sql — Phase 0: stop deletes that silently erase
-- history, before later phases rely on history surviving.
--
-- Confirmed live cascade holes: teams → {games, videos, clips, highlight_reels}
-- are ON DELETE CASCADE, so deleting a TEAM nukes all its footage. And
-- parent_player_links → players was CASCADE (repo drift — the earlier
-- history-cascade-restrict migration intended RESTRICT). game_lineups already
-- RESTRICTs game_id (blocks game/team delete once lineups exist).
--
-- Fixes:
--  1. teams → content = RESTRICT: a team holding any game/video/clip/reel can no
--     longer be deleted (blocked, not cascaded). An EMPTY just-created team
--     (the only team-delete path today, select-team.tsx rollback) has no children
--     so it still deletes fine.
--  2. parent_player_links → players = RESTRICT: can't delete a player who still
--     has a guardian link (reconciles the documented intent).
--  3. remove_roster_placeholder(): a coach-gated RPC replacing the raw
--     players.delete() in the roster — it DETACHES a player from the team and only
--     hard-deletes when the player is a truly blank placeholder (no guardians, no
--     videos, no lineups, no tagged clips). History is never destroyed.
--
-- Additive/behavioral only — touches no rows, no RLS.

-- 1. teams → content : CASCADE -> RESTRICT
alter table games          drop constraint if exists games_team_id_fkey;
alter table games          add  constraint games_team_id_fkey          foreign key (team_id) references teams(id) on delete restrict;
alter table videos         drop constraint if exists videos_team_id_fkey;
alter table videos         add  constraint videos_team_id_fkey         foreign key (team_id) references teams(id) on delete restrict;
alter table clips          drop constraint if exists clips_team_id_fkey;
alter table clips          add  constraint clips_team_id_fkey          foreign key (team_id) references teams(id) on delete restrict;
alter table highlight_reels drop constraint if exists highlight_reels_team_id_fkey;
alter table highlight_reels add  constraint highlight_reels_team_id_fkey foreign key (team_id) references teams(id) on delete restrict;

-- 2. parent_player_links → players : CASCADE -> RESTRICT (drift reconcile)
alter table parent_player_links drop constraint if exists parent_player_links_player_id_fkey;
alter table parent_player_links add  constraint parent_player_links_player_id_fkey foreign key (player_id) references players(id) on delete restrict;

-- 3. Guarded roster removal — never cascade-destroy a real kid.
create or replace function public.remove_roster_placeholder(p_player_id uuid, p_team_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Only a team coach can remove roster spots';
  end if;

  -- Any history/relationship → keep the player, just detach from THIS team.
  if exists (select 1 from parent_player_links where player_id = p_player_id)
     or exists (select 1 from videos where player_id = p_player_id)
     or exists (select 1 from game_lineups where player_id = p_player_id)
     or exists (select 1 from clip_tags ct join tags t on t.id = ct.tag_id
                where t.player_id = p_player_id) then
    delete from player_teams where player_id = p_player_id and team_id = p_team_id;
    return 'detached';
  end if;

  -- Truly blank placeholder → detach; if now on no team, delete it + its auto tags.
  delete from player_teams where player_id = p_player_id and team_id = p_team_id;
  if not exists (select 1 from player_teams where player_id = p_player_id) then
    delete from tags where player_id = p_player_id and category = 'players';
    delete from players where id = p_player_id;
    return 'deleted';
  end if;
  return 'detached';
end $$;
grant execute on function public.remove_roster_placeholder(uuid, uuid) to authenticated;
