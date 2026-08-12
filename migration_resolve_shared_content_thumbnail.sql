-- migration_resolve_shared_content_thumbnail.sql
--
-- Tier 2 thumbnails: teach resolve_shared_content to also return thumbnail_path so
-- the WALL cards (kid wall / team page / Coaches' Corner / team tab) can show a
-- poster, like the home feed + Film Room already do. Adds ONE output column.
--
-- Because RETURNS TABLE changes, CREATE OR REPLACE won't work — must DROP + CREATE
-- (and re-apply the revoke/grant posture, since DROP loses grants and a fresh
-- function defaults to PUBLIC execute). Everything else is byte-for-byte the same
-- as migration_resolve_shared_content_game.sql.
--
-- Per branch: video → its own thumbnail; clip → its video's thumbnail; game → a
-- representative video's thumbnail (first by sort_order that has one); reel →
-- hr.thumbnail_path (null until reels get thumbnails). Additive + backward-safe:
-- existing callers that don't select the new column are unaffected.
--
-- Depends on: shares, highlight_reels, videos, clips, games, parent_player_links,
--   is_super_admin()/is_team_member()/is_team_coach(), videos.thumbnail_path
--   (migration_video_thumbnails.sql).

drop function if exists resolve_shared_content(uuid);

create function resolve_shared_content(p_share_id uuid)
returns table (
  content_type     share_content,
  content_id       uuid,
  title            text,
  storage_path     text,
  duration_seconds numeric,
  start_time       numeric,
  end_time         numeric,
  thumbnail_path   text
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
             hr.duration_seconds, null::numeric, null::numeric, hr.thumbnail_path
      from highlight_reels hr
      where hr.id = s.content_id;
  elsif s.content_type = 'video' then
    return query
      select 'video'::share_content, v.id, v.label, v.url,
             null::numeric, null::numeric, null::numeric, v.thumbnail_path
      from videos v
      where v.id = s.content_id;
  elsif s.content_type = 'clip' then
    return query
      select 'clip'::share_content, c.id, v.label, v.url,
             null::numeric, c.start_time, c.end_time, v.thumbnail_path
      from clips c
      join videos v on v.id = c.video_id
      where c.id = s.content_id;
  elsif s.content_type = 'game' then
    -- A game has multiple videos + no single file: return its title, plus a
    -- representative video's poster (first with a thumbnail, by sort order).
    return query
      select 'game'::share_content, g.id, g.title, null::text,
             null::numeric, null::numeric, null::numeric,
             (select v.thumbnail_path from videos v
              where v.game_id = g.id and v.thumbnail_path is not null
              order by v.sort_order nulls last limit 1)
      from games g
      where g.id = s.content_id;
  end if;
end;
$$;

-- Restore the security posture DROP wiped (a fresh function defaults to PUBLIC).
revoke all on function resolve_shared_content(uuid) from public, anon;
grant execute on function resolve_shared_content(uuid) to authenticated;

notify pgrst, 'reload schema';
