-- ============================================================
-- authorize_photo_view(player_id) — Move 2, piece 3 of 3 (kid-photo authorizer).
--
-- Server-side entitlement gate for signing a KID PHOTO (key kid-photos/<playerId>/…)
-- in the private 'Videos' bucket. Runs as the requesting user (auth.uid()); returns
-- the player's photo_path (object key) if the user may see the face, else RAISES.
-- The 'sign-media' Edge Function parses <playerId> from the key, calls this, and
-- signs the returned key.
--
-- SAFE TO RUN NOW: defines a function only. No access changes until the Edge
-- Function ships and the bucket is locked.
--
-- Who may see a kid's face (Adam, 2026-07-22): linked parents + coaches/players/
-- teammates (any confirmed member of a team the kid is on) + invited friends-and-
-- family. The last one has NO backing table yet (viewer tier deferred), so it is a
-- commented seam stubbed `false` — flip it on when player_viewers ships.
--
-- Doors (any one grants access):
--   1. super admin
--   2. linked parent (parent_player_links) — family
--   3. member/coach of ANY team the kid is on (player_teams x is_team_member)
--   4. [SEAM] invited viewer (friends-and-family) — stubbed false until built
--
-- Depends on: players, parent_player_links, player_teams,
--   is_super_admin() / is_team_member().
-- ============================================================

create or replace function authorize_photo_view(p_player_id uuid)
returns text                       -- players.photo_path (object key) if allowed
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p   players%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into p from players where id = p_player_id;
  if not found then
    raise exception 'Player not found';
  end if;
  if p.photo_path is null then
    raise exception 'No photo set';
  end if;

  -- Doors 1-3: super admin / linked parent / member of a team the kid is on.
  if is_super_admin()
     or exists (
          select 1 from parent_player_links ppl
          where ppl.player_id = p_player_id
            and ppl.parent_user_id = uid)
     or exists (
          select 1 from player_teams pt
          where pt.player_id = p_player_id
            and is_team_member(pt.team_id))
  then
    return p.photo_path;
  end if;

  -- Door 4 (VIEWER SEAM): invited friends-and-family. The parent-controlled
  -- viewer tier (player_viewers) is NOT built yet, so this is stubbed false.
  -- When it ships, replace `false` with an EXISTS over player_viewers (an
  -- approved viewer of p_player_id) and mirror the same seam into the video +
  -- reel authorizers. Do NOT use `followers` (reserved/dormant per CLAUDE.md).
  if false then
    return p.photo_path;
  end if;

  raise exception 'Not allowed to view this photo';
end;
$$;

notify pgrst, 'reload schema';
