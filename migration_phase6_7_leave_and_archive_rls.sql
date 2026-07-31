-- migration_phase6_7_leave_and_archive_rls.sql
-- Phase 6 (soft-leave, never delete) + Phase 7 (durable kid-scoped read of games
-- the kid played, surviving leaving the team).
--
-- Access rides parent_player_links + game_lineups — NEITHER depends on team
-- membership — so a family keeps read access to every game their kid played in,
-- forever, even after leaving. The video BYTES already work: authorize_video_
-- playback has "Door 2b" (linked parent of a kid in the game lineup). This adds
-- the matching TABLE-level reads so a former member can still FIND those rows,
-- and makes leaving a soft flag so the past team is remembered.
--
-- Additive RLS: adds a branch, removes NONE. Verify on a non-member-but-linked
-- test account before relying on it.

-- Phase 6.1 — soft-leave marker on the roster link (null = current, ts = past).
alter table player_teams add column if not exists left_at timestamptz;

-- Phase 6.2 — game-lineup snapshot only includes ACTIVE roster (a kid who has
-- left isn't auto-added to games created after they left).
create or replace function public.snapshot_game_lineup()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into game_lineups (game_id, player_id, added_by_user_id)
  select NEW.id, pt.player_id, auth.uid()
  from player_teams pt
  where pt.team_id = NEW.team_id and pt.left_at is null
  on conflict do nothing;
  return NEW;
end $$;

-- Phase 6.3 — leaving sets left_at; it NEVER deletes the link (that's how the
-- past team stays visible + the logo/archive stay reachable). Parent or coach.
create or replace function public.leave_team(p_player_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to leave this team';
  end if;
  update player_teams set left_at = now()
  where player_id = p_player_id and team_id = p_team_id and left_at is null;
end $$;
grant execute on function public.leave_team(uuid, uuid) to authenticated;

-- Phase 6.4 — re-adding / re-joining a team you left REACTIVATES (clears left_at).
create or replace function public.attach_kid_to_team(p_player_id uuid, p_team_id uuid, p_jersey_number text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_super_admin() and not is_team_coach(p_team_id) then
    raise exception 'Only a coach or admin of this team can add players';
  end if;
  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (p_player_id, p_team_id, nullif(trim(coalesce(p_jersey_number, '')), ''), uid)
  on conflict (player_id, team_id) do update
    set jersey_number = excluded.jersey_number, left_at = null
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.join_team_with_code(p_code text, p_player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_player_id) then
    raise exception 'You are not a guardian of this player';
  end if;
  select id into t_id from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (p_player_id, t_id, uid)
  on conflict (player_id, team_id) do update set left_at = null;
  update players set team_id = t_id where id = p_player_id and team_id is null;

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;
  return t_id;
end $$;

-- Phase 6.5 — coach roster removal now SOFT-leaves a kid with history (preserve
-- the past-team record + games); only a truly blank placeholder is hard-deleted.
create or replace function public.remove_roster_placeholder(p_player_id uuid, p_team_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Only a team coach can remove roster spots';
  end if;

  if exists (select 1 from parent_player_links where player_id = p_player_id)
     or exists (select 1 from videos where player_id = p_player_id)
     or exists (select 1 from game_lineups where player_id = p_player_id)
     or exists (select 1 from clip_tags ct join tags t on t.id = ct.tag_id
                where t.player_id = p_player_id) then
    update player_teams set left_at = now()
    where player_id = p_player_id and team_id = p_team_id and left_at is null;
    return 'left';
  end if;

  delete from player_teams where player_id = p_player_id and team_id = p_team_id;
  if not exists (select 1 from player_teams where player_id = p_player_id) then
    delete from tags where player_id = p_player_id and category = 'players';
    delete from players where id = p_player_id;
    return 'deleted';
  end if;
  return 'detached';
end $$;

-- Phase 7 — durable kid-scoped read of games the kid played in. Wrapped in a
-- SECURITY DEFINER helper (mirrors is_team_member/is_linked_parent) so the
-- game_lineups sub-read can't hit RLS recursion.
create or replace function public.is_lineup_parent(p_game_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from game_lineups gl
    where gl.game_id = p_game_id and is_linked_parent(gl.player_id)
  );
$$;
grant execute on function public.is_lineup_parent(uuid) to authenticated;

-- games_read: + linked parent of a kid in the game's lineup (survives leaving).
alter policy games_read on games
  using (is_team_member(team_id) or is_super_admin() or is_lineup_parent(id));

-- videos_read: + linked parent of a kid in the video's game lineup.
alter policy videos_read on videos
  using (
    is_super_admin()
    or (uploaded_by_user_id = auth.uid())
    or ((visibility = 'team'::content_visibility) and is_team_member(team_id))
    or ((visibility = 'public_link'::content_visibility) and is_team_member(team_id))
    or ((visibility = 'coaches_only'::content_visibility) and is_team_coach(team_id))
    or (game_id is not null and is_lineup_parent(game_id))
  );
