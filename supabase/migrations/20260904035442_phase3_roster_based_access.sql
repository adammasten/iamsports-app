-- Season rosters — PHASE 3: roster-based durable family access
-- Plan: docs/SEASON_ROSTERS_PLAN.md  (Phases 1+2: 20260904034415, 20260904034418)
--
-- This is the phase that pays the product promise: "film follows the kid, even
-- after they leave the team."
--
-- BEFORE: a family's durable access rode `game_lineups` — a snapshot taken when
-- the game row was inserted. The normal coach workflow (create team → upload
-- Saturday's film → THEN enter the roster) produced an EMPTY snapshot, so those
-- families had no durable claim to that film, ever. Two live Centex Attack
-- Regents games (2026-08-10/11, 4 videos) are exactly this.
--
-- AFTER: access also rides Phase 1's roster SPELLS — "was a kid of mine on this
-- team on this game's date". Neither spells nor guardian links depend on team
-- membership, so access survives leaving the team.
--
-- ADDITIVE, NOT A SWAP — this matters. Measured before writing: **30 game_lineups
-- rows are NOT covered by any spell** (mostly because `joined_on` backfilled from
-- `created_at`, which is later than the game). Replacing the lineup path with the
-- spell path would have REVOKED access from those families. So the helpers are
-- `spell OR lineup`: the spell is inferred participation, the lineup is the
-- coach's explicit assertion of it, and either grants. Nobody loses access.
--
-- FOUR policies use the old helpers, not three as the plan estimated — `clips_read`
-- was found by searching pg_policies rather than trusting the doc.

-- ---------------------------------------------------------------------------
-- 1. The two spell-aware helpers (replacing is_lineup_parent / is_family_film_parent)
-- ---------------------------------------------------------------------------

-- Am I the guardian of a kid who was on this game's team on the game's date
-- (or whom the coach explicitly put in the lineup)? No film toggle — this is the
-- "may I see that this game exists" question.
create or replace function public.is_roster_parent(p_game_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from games g
    join player_teams pt        on pt.team_id = g.team_id
    join parent_player_links ppl on ppl.player_id = pt.player_id
    where g.id = p_game_id
      and ppl.parent_user_id = (select auth.uid())
      and pt.joined_on <= coalesce(g.game_date, current_date)
      and (pt.left_on is null or pt.left_on >= coalesce(g.game_date, current_date))
  )
  or exists (
    select 1
    from game_lineups gl
    join parent_player_links ppl on ppl.player_id = gl.player_id
    where gl.game_id = p_game_id
      and ppl.parent_user_id = (select auth.uid())
  );
$$;

-- Same, but gated on the team's parent_film_visible toggle — the "may I watch the
-- film" question. Mirrors what is_family_film_parent enforced.
create or replace function public.is_roster_film_parent(p_game_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from games g join teams tm on tm.id = g.team_id
    where g.id = p_game_id and tm.parent_film_visible
  )
  and is_roster_parent(p_game_id);
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in ('is_roster_parent','is_roster_film_parent')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Rewire the four policies
--    `(select auth.uid())` wrapping preserved from 20260903170000 — do not
--    un-wrap it, it is what keeps these from re-evaluating per row.
-- ---------------------------------------------------------------------------

-- videos_read: swap the family branch to the spell-aware helper AND close the
-- loose-footage hole. authorize_video_playback has always had a `v.player_id`
-- branch (a guardian may PLAY footage attached to their kid) but videos_read had
-- none — so loose footage tagged to a kid was playable-but-not-findable. For a
-- product whose promise is "film that sticks with the kid", the footage attached
-- directly TO the kid being the one kind that doesn't stick was backwards.
drop policy if exists videos_read on public.videos;
create policy videos_read on public.videos for select using (
  is_super_admin()
  or uploaded_by_user_id = (select auth.uid())
  or (visibility = 'team'::content_visibility        and is_team_member(team_id))
  or (visibility = 'public_link'::content_visibility and is_team_member(team_id))
  or (visibility = 'coaches_only'::content_visibility and is_team_coach(team_id))
  or (game_id is not null   and is_roster_film_parent(game_id))
  or (player_id is not null and is_linked_parent(player_id))   -- loose footage
  or can_tag_video(id)
);

drop policy if exists games_read on public.games;
create policy games_read on public.games for select using (
  is_team_member(team_id)
  or is_super_admin()
  or is_roster_parent(id)
  or can_tag_game(id)
);

drop policy if exists game_lineups_read on public.game_lineups;
create policy game_lineups_read on public.game_lineups for select using (
  is_super_admin()
  or exists (select 1 from games g where g.id = game_lineups.game_id and is_team_member(g.team_id))
  or (is_linked_parent(player_id) and is_roster_film_parent(game_id))
);

-- clips_read: only the family branch changes; the visibility rules and the
-- pure-negative-clip guard are preserved verbatim.
drop policy if exists clips_read on public.clips;
create policy clips_read on public.clips for select using (
  is_super_admin()
  or created_by_user_id = (select auth.uid())
  or (visibility = 'team'::content_visibility         and is_team_member(team_id))
  or (visibility = 'public_link'::content_visibility  and is_team_member(team_id))
  or (visibility = 'coaches_only'::content_visibility and is_team_coach(team_id))
  or (
    visibility = any (array['team'::content_visibility, 'public_link'::content_visibility])
    and exists (
      select 1 from videos v
      where v.id = clips.video_id and v.game_id is not null
        and is_roster_film_parent(v.game_id)
    )
    and (clip_involves_my_kid(id) or (not clip_is_pure_negative(id)))
  )
);

-- ---------------------------------------------------------------------------
-- 3. Playback ("Door 2b")
-- ---------------------------------------------------------------------------
-- Two changes:
--   a) the raw game_lineups join becomes the spell-aware helper, so a family whose
--      kid was rostered keeps playback after leaving the team; and
--   b) it now uses the FILM-VISIBLE variant. Previously videos_read respected
--      teams.parent_film_visible but playback did NOT — so a coach who turned the
--      toggle off hid the video from the list while anyone holding the id could
--      still stream it. A privacy switch that doesn't gate the bytes is broken.
--      ZERO live impact: all 6 teams currently have parent_film_visible = true.
create or replace function public.authorize_video_playback(p_video_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); v videos%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if v.deleted_at is not null then raise exception 'This video was deleted'; end if;
  if is_super_admin()
     or v.uploaded_by_user_id = uid
     or (v.visibility in ('team','public_link') and is_team_member(v.team_id))
     or (v.visibility = 'coaches_only'          and is_team_coach(v.team_id))
  then return v.url; end if;
  -- Tagger with an active grant on this video.
  if can_tag_video(p_video_id) then return v.url; end if;
  -- Guardian of the kid this footage is attached to (loose footage).
  if v.player_id is not null and exists (select 1 from parent_player_links ppl
       where ppl.player_id = v.player_id and ppl.parent_user_id = uid) then return v.url; end if;
  -- Door 2b: guardian of a kid rostered on the game date (or in the lineup).
  if v.game_id is not null and is_roster_film_parent(v.game_id) then return v.url; end if;
  if exists (select 1 from shares s
       where ( (s.content_type = 'video' and s.content_id = v.id)
            or (s.content_type = 'clip'  and s.content_id in (select c.id from clips c where c.video_id = v.id))
            or (s.content_type = 'game'  and v.game_id is not null and s.content_id = v.game_id) )
         and ( is_super_admin() or s.shared_by_user_id = uid
            or (s.audience='team'    and is_team_member(s.team_id))
            or (s.audience='coaches' and is_team_coach(s.team_id))
            or (s.audience='player'  and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid)))
     ) then return v.url; end if;
  raise exception 'Not allowed to view this video';
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Retire the superseded helpers (cleanup rule: zero references is the bar)
-- ---------------------------------------------------------------------------
-- Verified above: their only references were the four policies rewritten in §2
-- and authorize_video_playback in §3. DROP fails loudly if anything still depends
-- on them, which is the check we want.
drop function if exists public.is_family_film_parent(uuid);
drop function if exists public.is_lineup_parent(uuid);
