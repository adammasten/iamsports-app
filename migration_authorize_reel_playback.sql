-- ============================================================
-- authorize_reel_playback(reel_id) — Move 2, piece 2 of 3 (reel authorizer).
--
-- Server-side entitlement gate for signing a HIGHLIGHT REEL file in the private
-- 'Videos' bucket. Runs as the requesting user (auth.uid()); returns the reel's
-- storage_path if the user may watch it, else RAISES. The 'sign-media' Edge
-- Function calls this and signs only the returned key.
--
-- SAFE TO RUN NOW: defines a function only. Nothing calls it until the Edge
-- Function ships and the bucket is locked. No access changes yet.
--
-- Doors (any one grants access):
--   1. DIRECT — super admin / creator / team member. Mirrors highlight_reels_read
--      EXCEPT the `public_share_token IS NOT NULL` branch is DELIBERATELY OMITTED:
--      that is world-exposure of kid footage, inconsistent with the retire-Public
--      decision. (public_share_token is dead — zero app refs — but still lingers
--      in the reel READ policies; flagged for separate cleanup.)
--   2. SHARE  — an active 'reel' share to this user. Mirrors shares_read
--      entitlement (NO public branch). Reels reach families via explicit shares,
--      NOT an automatic per-kid "belonging" door (a reel is a compilation of many
--      players' clips), so there is intentionally no game_lineups door here.
--
-- DRIFT NOTE: Door 2 duplicates the shares_read entitlement expression (see the
-- same note in migration_authorize_video_playback.sql). Keep the three in sync.
--
-- Depends on: highlight_reels, shares, parent_player_links,
--   is_super_admin() / is_team_member() / is_team_coach().
-- ============================================================

create or replace function authorize_reel_playback(p_reel_id uuid)
returns text                       -- storage key (highlight_reels.storage_path) if allowed
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r   highlight_reels%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into r from highlight_reels where id = p_reel_id;
  if not found then
    raise exception 'Reel not found';
  end if;
  if r.storage_path is null then
    raise exception 'Reel has no file yet';
  end if;

  -- Door 1: DIRECT (owner / team) — mirrors highlight_reels_read MINUS the
  -- public_share_token branch (see header). is_team_member(NULL) is false.
  if is_super_admin()
     or r.created_by_user_id = uid
     or is_team_member(r.team_id)
  then
    return r.storage_path;
  end if;

  -- Door 2: SHARE — an active reel share to this user (mirrors shares_read).
  if exists (
       select 1
       from shares s
       where s.content_type = 'reel'
         and s.content_id = r.id
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
    return r.storage_path;
  end if;

  raise exception 'Not allowed to view this reel';
end;
$$;

notify pgrst, 'reload schema';
