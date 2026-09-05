-- Notifications: make the bell an INBOX instead of an append-only log.
--
-- FOUND (read-only audit, 2026-09-04):
--   * The schema has three states — seen_at, read_at, and deletion — but the UI
--     only ever drove two. A notifications_delete RLS policy already existed and
--     NOTHING called it: no swipe, no dismiss, no clear-all anywhere in the
--     codebase. So the list only ever grew. 37 rows and climbing.
--   * All 37 rows were seen_at IS NULL *and* read_at IS NULL across 4 accounts.
--     mark_notifications_seen was fired without await and without an error check
--     (notifications.tsx:57) — the swallow pattern, so a failure was invisible.
--   * Almost nothing generates a notification. Only shares, coach comments, team
--     announcements and schedule changes did. UPLOADING FILM NOTIFIED NOBODY,
--     which for a film app is the notification that matters most.
--
-- This migration adds dismissal + auto-expiry, and notifies on new film and on a
-- finished reel. Dismissal is SOFT (dismissed_at) so it can be undone.

-- ---------------------------------------------------------------------------
-- 1. Dismissal
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists dismissed_at timestamptz;

create index if not exists notifications_inbox_idx
  on public.notifications (recipient_user_id, created_at desc)
  where dismissed_at is null;

create or replace function public.dismiss_notification(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update notifications set dismissed_at = now()
   where id = p_id and recipient_user_id = auth.uid() and dismissed_at is null;
$$;

-- Undo, for the "Dismissed — Undo" affordance.
create or replace function public.undismiss_notification(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update notifications set dismissed_at = null
   where id = p_id and recipient_user_id = auth.uid();
$$;

-- Returns how many were cleared so the UI can say so instead of guessing.
create or replace function public.dismiss_all_notifications()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  with done as (
    update notifications set dismissed_at = now()
     where recipient_user_id = auth.uid() and dismissed_at is null
     returning 1
  ) select count(*) into n from done;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Reads exclude dismissed, and self-expire after 60 days
--    (so the inbox stays clean even for someone who never dismisses anything)
-- ---------------------------------------------------------------------------
create or replace function public.get_notifications()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'actor_name', coalesce((select up.display_name from user_profiles up where up.user_id = n.actor_user_id), 'Someone'),
    'player_name', split_part(coalesce(p.name, ''), ' ', 1),
    'team_name', t.name,
    'team_id', n.team_id,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'target_player_id', n.target_player_id,
    'created_at', n.created_at,
    'read_at', n.read_at
  ) order by n.created_at desc), '[]'::jsonb)
  into result
  from notifications n
  left join players p on p.id = n.target_player_id
  left join teams t on t.id = n.team_id
  where n.recipient_user_id = uid
    and n.dismissed_at is null
    and n.created_at > now() - interval '60 days';
  return result;
end $function$;

-- The badge must agree with the list, or the count points at rows you can't see.
create or replace function public.notifications_unseen_count()
returns integer language sql stable security definer set search_path to 'public' as $function$
  select count(*)::int from notifications
   where recipient_user_id = auth.uid()
     and seen_at is null
     and dismissed_at is null
     and created_at > now() - interval '60 days';
$function$;

-- Returns the number marked, so the caller can verify instead of assuming.
-- It previously returned void, and CREATE OR REPLACE cannot change a return
-- type, so it has to be dropped first. The grant is re-applied in §5.
drop function if exists public.mark_notifications_seen();
create or replace function public.mark_notifications_seen()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  with done as (
    update notifications set seen_at = now()
     where recipient_user_id = auth.uid() and seen_at is null
     returning 1
  ) select count(*) into n from done;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. NEW FILM notifies the team — the missing one that matters most
-- ---------------------------------------------------------------------------
-- Deliberately throttled: a coach uploading four quarters must not fire four
-- notifications per parent. If a recipient already has an undismissed
-- 'video_uploaded' for this team from the last 6 hours, skip them. The UI groups
-- the rest by team and day.
create or replace function public.notify_on_video_upload()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.team_id is null then return new; end if;
  if new.deleted_at is not null then return new; end if;

  insert into notifications (recipient_user_id, type, actor_user_id, target_player_id,
                             team_id, entity_type, entity_id)
  select tm.user_id, 'video_uploaded', new.uploaded_by_user_id, new.player_id,
         new.team_id, 'video', new.id
  from team_memberships tm
  where tm.team_id = new.team_id
    and tm.status = 'confirmed'
    and tm.left_on is null
    and tm.user_id is distinct from new.uploaded_by_user_id
    and not exists (
      select 1 from notifications n
      where n.recipient_user_id = tm.user_id
        and n.team_id = new.team_id
        and n.type = 'video_uploaded'
        and n.dismissed_at is null
        and n.created_at > now() - interval '6 hours'
    );
  return new;
exception when others then
  return new;   -- never block an upload on a notification hiccup
end $$;

drop trigger if exists on_video_insert_notify on public.videos;
create trigger on_video_insert_notify
  after insert on public.videos
  for each row execute function public.notify_on_video_upload();

-- ---------------------------------------------------------------------------
-- 4. A finished reel notifies whoever asked for it
-- ---------------------------------------------------------------------------
-- The render runs on Railway under the service role, so auth.uid() is null here;
-- the creator is named explicitly as the recipient.
create or replace function public.notify_on_reel_ready()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready'
     and new.created_by_user_id is not null then
    insert into notifications (recipient_user_id, type, actor_user_id, team_id,
                               entity_type, entity_id)
    values (new.created_by_user_id, 'reel_ready', null, new.team_id, 'reel', new.id);
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists on_reel_ready_notify on public.highlight_reels;
create trigger on_reel_ready_notify
  after update of status on public.highlight_reels
  for each row execute function public.notify_on_reel_ready();

-- ---------------------------------------------------------------------------
-- 5. Lock the new functions to authenticated
--    (a bare `grant ... to authenticated` leaves the inherited PUBLIC grant —
--     see 20260904033115_harden_resolve_any_code)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname in ('dismiss_notification','undismiss_notification',
                        'dismiss_all_notifications','get_notifications',
                        'mark_notifications_seen','mark_notification_read',
                        'notifications_unseen_count')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
