-- ============================================================
-- authorize_video_playback(video_id) — Move 2, piece 1 of 3 (video authorizer).
--
-- Server-side entitlement gate for signing a RAW VIDEO in the private 'Videos'
-- bucket. Runs as the requesting user (auth.uid()); returns the video's storage
-- object key (videos.url) if the user may watch it, else RAISES. The thin
-- 'sign-media' Edge Function calls this, and only signs the returned key.
--
-- SAFE TO RUN NOW: this only DEFINES a function. Nothing calls it until the Edge
-- Function ships and the bucket is locked (later pieces). No access changes yet.
--
-- Doors (any one grants access):
--   1. DIRECT   — owner / team member / coach (mirrors the videos_read policy).
--   2. BELONGING— linked parent of the video's own kid (videos.player_id), OR of
--                 any kid in the video's game lineup (game_lineups). "The game
--                 sticks with the kid" — un-sharing a wall post never touches this.
--   3. SHARE    — an active share to this user that resolves to this video
--                 (a video share, a shared clip cut from it, or a shared game it
--                 belongs to). Mirrors resolve_shared_content / shares_read
--                 entitlement (NO public branch — Public is retired).
--
-- DRIFT NOTE: the SHARE door duplicates the shares_read/resolve_shared_content
-- entitlement expression. If that expression ever changes, update it in all three
-- (shares_read policy, resolve_shared_content, here). Kept inline (not a shared
-- helper) to avoid churning the freshly-verified resolve_shared_content.
--
-- Depends on: videos, clips, shares, game_lineups, parent_player_links,
--   is_super_admin() / is_team_member() / is_team_coach().
-- ============================================================

create or replace function authorize_video_playback(p_video_id uuid)
returns text                       -- storage object key (videos.url) if allowed
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v   videos%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v from videos where id = p_video_id;
  if not found then
    raise exception 'Video not found';
  end if;

  -- Door 1: DIRECT (owner / team) — mirrors videos_read. is_team_member(NULL) /
  -- is_team_coach(NULL) are false, so teamless personal uploads fall to the owner.
  if is_super_admin()
     or v.uploaded_by_user_id = uid
     or (v.visibility in ('team', 'public_link') and is_team_member(v.team_id))
     or (v.visibility = 'coaches_only'            and is_team_coach(v.team_id))
  then
    return v.url;
  end if;

  -- Door 2a: BELONGING — linked parent of the video's own kid.
  if v.player_id is not null and exists (
       select 1 from parent_player_links ppl
       where ppl.player_id = v.player_id
         and ppl.parent_user_id = uid
     )
  then
    return v.url;
  end if;

  -- Door 2b: BELONGING — linked parent of a kid in the video's game lineup.
  if v.game_id is not null and exists (
       select 1
       from game_lineups gl
       join parent_player_links ppl on ppl.player_id = gl.player_id
       where gl.game_id = v.game_id
         and ppl.parent_user_id = uid
     )
  then
    return v.url;
  end if;

  -- Door 3: SHARE — an active share to this user resolving to this video.
  if exists (
       select 1
       from shares s
       where (
                (s.content_type = 'video' and s.content_id = v.id)
             or (s.content_type = 'clip'  and s.content_id in
                   (select c.id from clips c where c.video_id = v.id))
             or (s.content_type = 'game'  and v.game_id is not null
                   and s.content_id = v.game_id)
             )
         and (
                is_super_admin()
             or s.shared_by_user_id = uid
             or (s.audience = 'team'    and is_team_member(s.team_id))
             or (s.audience = 'coaches' and is_team_coach(s.team_id))
             or (s.audience = 'player'  and exists (
                   select 1 from parent_player_links ppl
                   where ppl.player_id = s.target_player_id
                     and ppl.parent_user_id = uid))
             )
     )
  then
    return v.url;
  end if;

  raise exception 'Not allowed to view this video';
end;
$$;

notify pgrst, 'reload schema';
