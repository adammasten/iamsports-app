-- ============================================================
-- Inbox / wall — step 1 (security fixes + content-resolution RPCs).
--
--   1. shares_read: public branch now also requires hidden_by_family = false
--      (a family hide removes a kid's public share from anonymous read). All
--      other branches identical to migration_rls_lockdown_15_shares.sql.
--   2. shares unique constraint now includes shared_by_user_id, so a coach share
--      and a family's wall post of the same content/audience/player coexist as
--      distinct rows (who-shared-what is never overwritten).
--   3. post_to_wall(...) RPC: a linked parent (or super admin) creates a NEW
--      'owned' shares row on their kid's wall — always the caller's own row,
--      never merged with any coach share, so a coach recall can't remove it.
--   4. resolve_shared_content(p_share_id) RPC: entitlement-checks the caller
--      against the share, then resolves content_type/content_id to the
--      underlying reel/video/clip and returns display metadata + storage path.
--      Fixes the gap where a parent can read the share row but NOT the content
--      (content RLS has no linked-parent branch); the SECURITY DEFINER RPC
--      reads the content on the caller's behalf after validating the share.
--
-- Depends on: shares, highlight_reels, videos, clips, parent_player_links,
--   enums share_content/share_audience, and is_super_admin()/is_team_member()/
--   is_team_coach().
-- All RPCs: SECURITY DEFINER, search_path=public, authenticated-only.
-- ============================================================

-- 1. shares_read — add hidden_by_family to the public branch; rest unchanged.
drop policy if exists shares_read on shares;
create policy shares_read on shares
  for select
  using (
    is_super_admin()
    or shared_by_user_id = auth.uid()
    or (audience = 'public'  and visible = true and hidden_by_family = false)
    or (audience = 'team'    and is_team_member(team_id))
    or (audience = 'coaches' and is_team_coach(team_id))
    or (audience = 'player'  and exists (
          select 1 from parent_player_links ppl
          where ppl.player_id = shares.target_player_id
            and ppl.parent_user_id = auth.uid()
       ))
  );

-- 2. Unique constraint swap — include shared_by_user_id so a coach's share and a
--    family's wall post of the SAME content/audience/player coexist as distinct
--    rows (who-shared-what is never overwritten). Existing data satisfies the new
--    constraint (the old one already guaranteed <=1 row per content/audience/
--    player). NULLs in shared_by_user_id remain distinct — orphaned rows after an
--    account deletion aren't deduped, which is acceptable.
do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  where c.conrelid = 'public.shares'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) k
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
    ) = array['audience','content_id','content_type','target_player_id']::text[]
  limit 1;
  if cname is not null then
    execute format('alter table public.shares drop constraint %I', cname);
  end if;
end $$;

alter table shares
  add constraint shares_content_audience_player_sharer_key
  unique (content_type, content_id, audience, target_player_id, shared_by_user_id);

-- 3. post_to_wall — linked parent (or super admin) posts content to their kid's
--    wall as the caller's OWN row, ALWAYS distinct from any coach share. Never
--    merges or overwrites another sharer's row. Get-or-create the caller's own row
--    so a same-parent repost is idempotent (returns the existing row). team_id is
--    left null (a kid's personal wall is not team-scoped; add a team_id param
--    later if team walls are needed).
create or replace function post_to_wall(
  p_content_type    share_content,
  p_content_id      uuid,
  p_audience        share_audience,
  p_target_player_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if not is_super_admin() and not exists (
    select 1 from parent_player_links ppl
    where ppl.player_id = p_target_player_id
      and ppl.parent_user_id = uid
  ) then
    raise exception 'Not allowed: not a linked parent of this player';
  end if;

  -- Get-or-create THIS caller's own wall row (never touches another sharer's row).
  select id into new_id
  from shares
  where content_type      = p_content_type
    and content_id        = p_content_id
    and audience          = p_audience
    and target_player_id  = p_target_player_id
    and shared_by_user_id = uid;
  if new_id is not null then
    return new_id;
  end if;

  insert into shares (content_type, content_id, audience, target_player_id, shared_by_user_id)
  values (p_content_type, p_content_id, p_audience, p_target_player_id, uid)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function post_to_wall(share_content, uuid, share_audience, uuid) from public, anon;
grant execute on function post_to_wall(share_content, uuid, share_audience, uuid) to authenticated;

-- 4. resolve_shared_content — validate entitlement to a share, then resolve the
--    underlying content and return metadata + storage path. The app mints a
--    signed URL from storage_path (clips also return start/end for segment play).
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
  end if;
end;
$$;

revoke all on function resolve_shared_content(uuid) from public, anon;
grant execute on function resolve_shared_content(uuid) to authenticated;

notify pgrst, 'reload schema';
