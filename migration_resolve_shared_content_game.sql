-- ============================================================
-- resolve_shared_content — add a 'game' branch so game shares resolve to the
-- game's TITLE (they previously returned no row → the app showed "Shared game").
--
-- ADDITIVE ONLY: reel/video/clip branches are byte-for-byte unchanged; this just
-- appends an `elsif s.content_type = 'game'` case. Same return signature, so a
-- plain CREATE OR REPLACE (no DROP needed).
--
-- A game has N videos and no single file, so storage_path/durations are NULL —
-- the client uses the returned title for the card + header and routes taps to the
-- /shared-game viewer (which loads the videos via resolve_shared_game). This
-- function is SECURITY DEFINER and re-checks share entitlement up front, so it
-- returns the title to an entitled NON-team-member without touching games_read RLS.
--
-- Depends on: shares, highlight_reels, videos, clips, games, parent_player_links,
--   is_super_admin()/is_team_member()/is_team_coach().
-- ============================================================

create or replace function resolve_shared_content(p_share_id uuid)
returns table (
  content_type     share_content,
  content_id       uuid,
  title            text,
  storage_path     text,
  duration_seconds numeric,
  start_time       numeric,
  end_time         numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s shares%rowtype;
  entitled boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into s from shares where id = p_share_id;
  if not found then
    raise exception 'Share not found';
  end if;

  -- Mirror shares_read entitlement.
  entitled :=
    is_super_admin()
    or s.shared_by_user_id = uid
    or (s.audience = 'public'  and s.visible = true and s.hidden_by_family = false)
    or (s.audience = 'team'    and is_team_member(s.team_id))
    or (s.audience = 'coaches' and is_team_coach(s.team_id))
    or (s.audience = 'player'  and exists (
          select 1 from parent_player_links ppl
          where ppl.player_id = s.target_player_id
            and ppl.parent_user_id = uid
       ));
  if not entitled then
    raise exception 'Not allowed to view this share';
  end if;

  if s.content_type = 'reel' then
    return query
      select 'reel'::share_content, hr.id, hr.name, hr.storage_path,
             hr.duration_seconds, null::numeric, null::numeric
      from highlight_reels hr
      where hr.id = s.content_id;
  elsif s.content_type = 'video' then
    return query
      select 'video'::share_content, v.id, v.label, v.url,
             null::numeric, null::numeric, null::numeric
      from videos v
      where v.id = s.content_id;
  elsif s.content_type = 'clip' then
    return query
      select 'clip'::share_content, c.id, v.label, v.url,
             null::numeric, c.start_time, c.end_time
      from clips c
      join videos v on v.id = c.video_id
      where c.id = s.content_id;
  elsif s.content_type = 'game' then
    -- A game has multiple videos + no single file: return its title only.
    -- Playback happens per-video via resolve_shared_game in the /shared-game view.
    return query
      select 'game'::share_content, g.id, g.title, null::text,
             null::numeric, null::numeric, null::numeric
      from games g
      where g.id = s.content_id;
  end if;
end;
$$;

-- Schema cache trap — force PostgREST to reload (see CLAUDE.md).
notify pgrst, 'reload schema';
