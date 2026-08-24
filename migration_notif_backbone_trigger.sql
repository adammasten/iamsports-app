-- =====================================================================
-- Notification backbone (Stage 1) — the events trigger + cron worker.
-- APPLIED LIVE via the Supabase MCP (migration: notif_backbone_trigger).
-- A schedule change IS the message: this trigger enqueues one coalesced,
-- debounced outbox row per notify-worthy change. DEFENSIVE — any failure returns
-- quietly so it can NEVER block saving the schedule. Bulk paths suppress via the
-- app.suppress_event_notify GUC (create_practice_series + import_game_events set it).
-- =====================================================================
create or replace function public.enqueue_event_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_kind text;
begin
  if coalesce(current_setting('app.suppress_event_notify', true), '') = '1' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'canceled' then return null; end if;
    v_kind := 'created';
  else
    if new.status = 'canceled' and old.status is distinct from 'canceled' then v_kind := 'canceled';
    elsif new.status = 'completed' and old.status is distinct from 'completed' then v_kind := 'completed';
    elsif new.starts_at is distinct from old.starts_at
       or new.local_date is distinct from old.local_date
       or new.time_status is distinct from old.time_status then v_kind := 'time_changed';
    elsif new.venue_name is distinct from old.venue_name
       or new.venue_address is distinct from old.venue_address then v_kind := 'venue_changed';
    else return null;
    end if;
  end if;

  insert into public.notification_outbox (event_id, team_id, change_kind, actor_user_id, event_version, dispatch_after)
  values (new.id, new.team_id, v_kind, auth.uid(), new.version, now() + interval '90 seconds')
  on conflict (event_id) where processed_at is null
  do update set change_kind = excluded.change_kind, actor_user_id = excluded.actor_user_id,
                event_version = excluded.event_version, dispatch_after = now() + interval '90 seconds';
  return null;
exception when others then
  return null;  -- never block the schedule save on a notification hiccup
end;
$$;

drop trigger if exists events_enqueue_notification on public.events;
create trigger events_enqueue_notification
  after insert or update on public.events
  for each row execute function public.enqueue_event_notification();

-- create_practice_series was updated to set app.suppress_event_notify (see
-- migration_schedule_practice_series.sql header) so a series doesn't blast per occurrence.

-- Worker schedule (pg_cron + pg_net), applied via MCP alongside this migration:
--   select cron.schedule('process-notifications', '* * * * *', $$
--     select net.http_post(
--       url := 'https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/process-notifications',
--       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
--   $$);
-- Edge function source: supabase/functions/process-notifications/index.ts
-- =====================================================================
