-- Part 3: team announcements now appear in the in-app bell feed, not just push.
-- Previously enqueue_message_notification() only wrote to notification_outbox
-- (push/SMS). Now it ALSO inserts one `notifications` bell row per recipient so
-- the bell surfaces announcements and tap can deep-link into the thread.
-- Scope stays announcements-only (top-level, not deleted) to match the existing
-- push behavior — regular chat messages do NOT spam the bell.
create or replace function public.enqueue_message_notification()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.kind = 'announcement' and new.parent_id is null and new.deleted_at is null then
    -- push/SMS delivery pipeline (unchanged)
    insert into public.notification_outbox (source, message_id, team_id, change_kind, actor_user_id, dispatch_after)
    values ('message', new.id, new.team_id, 'custom', new.author_user_id, now());

    -- in-app bell feed: one row per team recipient (author excluded by resolver)
    insert into public.notifications (recipient_user_id, type, actor_user_id, team_id, entity_type, entity_id)
    select r.recipient_user_id, 'team_message', new.author_user_id, new.team_id, 'message', new.id
    from public.resolve_team_recipients(new.team_id, new.author_user_id) r;
  end if;
  return null;
exception when others then
  return null;  -- never block posting on a notification hiccup
end;
$function$;
