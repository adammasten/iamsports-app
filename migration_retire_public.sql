-- ============================================================
-- RETIRE "PUBLIC" — child-safety data-leak fix (minors' app, TOP priority).
--
-- Before this, ANY caller could read every audience='public' share (no team/
-- family gate in shares_read), resolve it to a storage path (resolve_shared_
-- content's public branch), and — as any authenticated user — sign the video.
-- "Public" has no live audience (no discovery feature), so it is pure attack
-- surface. This retires it entirely at the DATA layer (the app UI no longer
-- offers it in the same commit).
--
-- Run the read-only count FIRST to see what's being neutralized:
--     select count(*) from shares where audience = 'public';   -- was 4 (2 kid, 2 team)
--
-- Idempotent. Wrap in one transaction.
-- ============================================================

BEGIN;

-- 1. NEUTRALIZE existing public shares. The public read branch required
--    visible=true, so this alone drops them from it immediately — belt-and-
--    suspenders with the branch removal below. Non-destructive (rows kept).
update shares set visible = false where audience = 'public';

-- 2. shares_read — REMOVE the public branch. A public share is now readable only
--    by its sharer or a super admin; strangers get nothing. (Family-hide branch
--    from migration_inbox_wall_step1 is dropped along with public — public is gone.)
drop policy if exists shares_read on shares;
create policy shares_read on shares
  for select
  using (
    is_super_admin()
    or shared_by_user_id = auth.uid()
    or (audience = 'team'    and is_team_member(team_id))
    or (audience = 'coaches' and is_team_coach(team_id))
    or (audience = 'player'  and exists (
          select 1 from parent_player_links ppl
          where ppl.player_id = shares.target_player_id
            and ppl.parent_user_id = auth.uid()
       ))
  );

-- 3. resolve_shared_content — REMOVE the public branch from the entitlement
--    check, so a direct RPC call can't resolve a public share to a storage path.
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

  -- Mirror shares_read entitlement — NO public branch.
  entitled :=
    is_super_admin()
    or s.shared_by_user_id = uid
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

notify pgrst, 'reload schema';

COMMIT;
