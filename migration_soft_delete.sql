-- =====================================================================
-- SOFT DELETE + ADMIN GATE + RECOVERY  (run in the Supabase SQL editor)
-- =====================================================================
-- Footage is TEAM-OWNED. Deletion must be admin-gated, reversible for 30
-- days, and never leave orphaned wall cards. This migration:
--   1. adds deleted_at to games / videos / highlight_reels
--   2. adds is_team_admin(team) (admin role only — distinct from is_team_coach)
--   3. rewrites delete_game + adds soft_delete_video / soft_delete_reel to
--      SOFT-delete behind the gate (admin OR has_team_permission('delete_content')
--      for team footage; the uploader/creator for PERSONAL, team-less footage)
--   4. adds restore_* (admin-only)
--   5. makes resolve_shared_content skip deleted/missing content (cascade —
--      cards vanish from every wall at once; restore brings them back)
--   6. makes the playback authorizers refuse deleted content
--   7. adds list_deleted_content(team) for the admin "Recently Deleted" view
--
-- NOT in this migration (separate, noted at the bottom): the 30-day auto-PURGE
-- job (pg_cron + a service-role edge function to remove storage objects) and
-- the Door #2 storage tightening. Nothing purges for 30 days, so those aren't
-- urgent — but they must ship before the recovery window elapses.
--
-- After running: NOTIFY pgrst, 'reload schema';
-- =====================================================================

begin;

-- ── 1. deleted_at columns ────────────────────────────────────────────
alter table public.games           add column if not exists deleted_at timestamptz;
alter table public.videos          add column if not exists deleted_at timestamptz;
alter table public.highlight_reels add column if not exists deleted_at timestamptz;

create index if not exists games_deleted_at_idx           on public.games(deleted_at)           where deleted_at is not null;
create index if not exists videos_deleted_at_idx          on public.videos(deleted_at)          where deleted_at is not null;
create index if not exists highlight_reels_deleted_at_idx on public.highlight_reels(deleted_at) where deleted_at is not null;

-- ── 2. is_team_admin — the ADMIN role only (is_team_coach is admin+head_coach+coach) ──
create or replace function public.is_team_admin(check_team_id uuid)
  returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from team_memberships
    where team_id = check_team_id and user_id = auth.uid()
      and status = 'confirmed' and role = 'admin'
  );
$function$;

-- Shared gate: who may delete a given team's footage. Admin always; others only
-- if granted the (default-off) delete_content permission.
create or replace function public.can_delete_team_content(p_team_id uuid)
  returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select is_super_admin()
      or is_team_admin(p_team_id)
      or has_team_permission(p_team_id, 'delete_content');
$function$;

-- ── 3. soft-delete RPCs ──────────────────────────────────────────────
-- GAME: always team footage → admin/permission gate. Soft-deletes the game AND
-- its videos so their wall cards drop too. (Keeps game_lineups for restore.)
create or replace function public.delete_game(p_game_id uuid)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id and deleted_at is null;
  if t is null then raise exception 'Game not found'; end if;
  if not can_delete_team_content(t) then
    raise exception 'Only a team admin (or someone granted Delete content) can delete a game';
  end if;
  update games  set deleted_at = now() where id = p_game_id;
  update videos set deleted_at = now() where game_id = p_game_id and deleted_at is null;
end $function$;

-- VIDEO: team footage → gate; PERSONAL (team_id null) → the uploader.
create or replace function public.soft_delete_video(p_video_id uuid)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v videos%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if not (
       is_super_admin()
    or (v.team_id is null and v.uploaded_by_user_id = auth.uid())
    or (v.team_id is not null and can_delete_team_content(v.team_id))
  ) then raise exception 'Not allowed to delete this video'; end if;
  update videos set deleted_at = now() where id = p_video_id and deleted_at is null;
end $function$;

-- REEL: team reel → gate; personal reel (team_id null) → the creator.
create or replace function public.soft_delete_reel(p_reel_id uuid)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r highlight_reels%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if not (
       is_super_admin()
    or (r.team_id is null and r.created_by_user_id = auth.uid())
    or (r.team_id is not null and can_delete_team_content(r.team_id))
  ) then raise exception 'Not allowed to delete this reel'; end if;
  update highlight_reels set deleted_at = now() where id = p_reel_id and deleted_at is null;
end $function$;

-- ── 4. restore RPCs (admin-only) ─────────────────────────────────────
create or replace function public.restore_game(p_game_id uuid)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare t uuid;
begin
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_super_admin() or is_team_admin(t)) then raise exception 'Only a team admin can restore'; end if;
  update games  set deleted_at = null where id = p_game_id;
  update videos set deleted_at = null where game_id = p_game_id;
end $function$;

create or replace function public.restore_video(p_video_id uuid)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v videos%rowtype;
begin
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if not (is_super_admin() or (v.team_id is null and v.uploaded_by_user_id = auth.uid()) or (v.team_id is not null and is_team_admin(v.team_id)))
    then raise exception 'Not allowed to restore this video'; end if;
  update videos set deleted_at = null where id = p_video_id;
end $function$;

create or replace function public.restore_reel(p_reel_id uuid)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r highlight_reels%rowtype;
begin
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if not (is_super_admin() or (r.team_id is null and r.created_by_user_id = auth.uid()) or (r.team_id is not null and is_team_admin(r.team_id)))
    then raise exception 'Not allowed to restore this reel'; end if;
  update highlight_reels set deleted_at = null where id = p_reel_id;
end $function$;

-- ── 5. resolve_shared_content — skip deleted/missing (the read-layer cascade) ──
create or replace function public.resolve_shared_content(p_share_id uuid)
  returns table(content_type share_content, content_id uuid, title text, storage_path text,
                duration_seconds numeric, start_time numeric, end_time numeric, thumbnail_path text)
  language plpgsql security definer set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); s shares%rowtype; entitled boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into s from shares where id = p_share_id;
  if not found then raise exception 'Share not found'; end if;

  entitled :=
       is_super_admin()
    or s.shared_by_user_id = uid
    or (s.audience = 'public'  and s.visible = true and s.hidden_by_family = false)
    or (s.audience = 'team'    and is_team_member(s.team_id))
    or (s.audience = 'coaches' and is_team_coach(s.team_id))
    or (s.audience = 'player'  and exists (select 1 from parent_player_links ppl
          where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid));
  if not entitled then raise exception 'Not allowed to view this share'; end if;

  if s.content_type = 'reel' then
    return query select 'reel'::share_content, hr.id, hr.name, hr.storage_path,
        hr.duration_seconds, null::numeric, null::numeric, hr.thumbnail_path
      from highlight_reels hr where hr.id = s.content_id and hr.deleted_at is null;
  elsif s.content_type = 'video' then
    return query select 'video'::share_content, v.id, v.label, v.url,
        null::numeric, null::numeric, null::numeric, v.thumbnail_path
      from videos v where v.id = s.content_id and v.deleted_at is null;
  elsif s.content_type = 'clip' then
    return query select 'clip'::share_content, c.id, v.label, v.url,
        null::numeric, c.start_time, c.end_time, v.thumbnail_path
      from clips c join videos v on v.id = c.video_id
      where c.id = s.content_id and v.deleted_at is null;
  elsif s.content_type = 'game' then
    return query select 'game'::share_content, g.id, g.title, null::text,
        null::numeric, null::numeric, null::numeric,
        (select v.thumbnail_path from videos v
         where v.game_id = g.id and v.thumbnail_path is not null and v.deleted_at is null
         order by v.sort_order nulls last limit 1)
      from games g where g.id = s.content_id and g.deleted_at is null;
  end if;
end $function$;

-- ── 6. playback authorizers refuse deleted content ───────────────────
create or replace function public.authorize_video_playback(p_video_id uuid)
  returns text language plpgsql security definer set search_path to 'public'
as $function$
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
  if v.player_id is not null and exists (select 1 from parent_player_links ppl
       where ppl.player_id = v.player_id and ppl.parent_user_id = uid) then return v.url; end if;
  if v.game_id is not null and exists (select 1 from game_lineups gl
       join parent_player_links ppl on ppl.player_id = gl.player_id
       where gl.game_id = v.game_id and ppl.parent_user_id = uid) then return v.url; end if;
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

create or replace function public.authorize_reel_playback(p_reel_id uuid)
  returns text language plpgsql security definer set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r highlight_reels%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if r.storage_path is null then raise exception 'Reel has no file yet'; end if;
  if r.deleted_at is not null then raise exception 'This reel was deleted'; end if;
  if is_super_admin() or r.created_by_user_id = uid or is_team_coach(r.team_id) then return r.storage_path; end if;
  if exists (select 1 from shares s
       where s.content_type = 'reel' and s.content_id = r.id
         and ( is_super_admin() or s.shared_by_user_id = uid
            or (s.audience='team'    and is_team_member(s.team_id))
            or (s.audience='coaches' and is_team_coach(s.team_id))
            or (s.audience='player'  and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid)))
     ) then return r.storage_path; end if;
  raise exception 'Not allowed to view this reel';
end $function$;

-- ── 7. Recently Deleted list (admin-only, 30-day window) ─────────────
create or replace function public.list_deleted_content(p_team_id uuid)
  returns table(kind text, id uuid, title text, deleted_at timestamptz)
  language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not (is_super_admin() or is_team_admin(p_team_id)) then
    raise exception 'Only a team admin can view deleted content';
  end if;
  return query
    select 'game'::text, g.id, g.title, g.deleted_at from games g
      where g.team_id = p_team_id and g.deleted_at is not null and g.deleted_at > now() - interval '30 days'
    union all
    select 'video'::text, v.id, v.label, v.deleted_at from videos v
      where v.team_id = p_team_id and v.game_id is null
        and v.deleted_at is not null and v.deleted_at > now() - interval '30 days'
    union all
    select 'reel'::text, hr.id, hr.name, hr.deleted_at from highlight_reels hr
      where hr.team_id = p_team_id and hr.deleted_at is not null and hr.deleted_at > now() - interval '30 days'
    order by 4 desc;
end $function$;

commit;

-- =====================================================================
-- AFTER RUNNING:  NOTIFY pgrst, 'reload schema';
-- =====================================================================
-- OPTIONAL one-time cleanup of EXISTING orphaned shares (rows whose content
-- was hard-deleted before soft-delete existed). The app already HIDES these;
-- this removes the dead rows. Review the count first (the SELECT I gave you),
-- then run:
--
--   delete from shares s where
--        (s.content_type='reel'  and not exists (select 1 from highlight_reels where id=s.content_id))
--     or (s.content_type='video' and not exists (select 1 from videos          where id=s.content_id))
--     or (s.content_type='game'  and not exists (select 1 from games           where id=s.content_id))
--     or (s.content_type='clip'  and not exists (select 1 from clips           where id=s.content_id));
--
-- STILL TODO (separate work, not urgent — nothing purges for 30 days):
--   * 30-day PURGE job: pg_cron to hard-delete rows past the window + a
--     service-role edge function to remove the storage objects.
--   * Door #2: scope storage.objects INSERT/UPDATE on the Videos bucket to
--     owner/coach (today any authenticated user can overwrite any object).
-- =====================================================================
