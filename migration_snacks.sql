-- =====================================================================
-- Stage 5: snack sign-up + targeted notifications + game-completed film hook.
-- APPLIED LIVE via the Supabase MCP (migration: snacks_and_targeted_notifs).
-- One snack slot per event (first family claims). Reminders + film prompts ride
-- the same notification backbone but target ONE user / coaches (not the team).
-- =====================================================================
create table public.event_snack_signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid not null,
  claimed_by_user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  unique (event_id)
);
create index event_snack_signups_team_idx on public.event_snack_signups(team_id);
alter table public.event_snack_signups enable row level security;
create policy snack_read on public.event_snack_signups for select to authenticated
  using (is_team_member(team_id) or is_super_admin());
create policy snack_insert on public.event_snack_signups for insert to authenticated
  with check (is_team_member(team_id) and claimed_by_user_id = auth.uid());
create policy snack_delete on public.event_snack_signups for delete to authenticated
  using (claimed_by_user_id = auth.uid() or is_team_coach(team_id) or is_super_admin());

-- Targeted notifications: a row can now name ONE recipient.
alter table public.notification_outbox add column if not exists target_user_id uuid;
-- Distinct notification TYPES per event must not coalesce → key by (event, kind).
drop index if exists public.notification_outbox_one_pending;
create unique index notification_outbox_one_pending
  on public.notification_outbox (event_id, change_kind) where processed_at is null;
alter table public.notification_outbox drop constraint if exists notification_outbox_change_kind_check;
alter table public.notification_outbox add constraint notification_outbox_change_kind_check
  check (change_kind in ('created','time_changed','venue_changed','canceled','completed','custom','snack_reminder'));
-- (enqueue_event_notification updated to ON CONFLICT (event_id, change_kind) — see
--  migration_notif_backbone_trigger.sql / the live function.)

create or replace function public.resolve_team_coaches(p_team_id uuid)
returns table (recipient_user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct tm.user_id from public.team_memberships tm
  where tm.team_id = p_team_id and tm.status = 'confirmed' and tm.role in ('admin','head_coach','coach');
$$;
grant execute on function public.resolve_team_coaches(uuid) to authenticated, service_role;

-- Day-before snack reminder for the claimer (targeted, deduped). Hourly cron.
create or replace function public.enqueue_snack_reminders()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_outbox (event_id, team_id, change_kind, target_user_id, source, dispatch_after)
  select e.id, e.team_id, 'snack_reminder', s.claimed_by_user_id, 'snack', now()
  from public.events e
  join public.event_snack_signups s on s.event_id = e.id
  where e.status = 'scheduled' and e.starts_at is not null
    and e.starts_at between now() and now() + interval '24 hours'
    and not exists (select 1 from public.schedule_notifications n
                    where n.event_id = e.id and n.recipient_user_id = s.claimed_by_user_id and n.change_kind = 'snack_reminder')
    and not exists (select 1 from public.notification_outbox o
                    where o.event_id = e.id and o.change_kind = 'snack_reminder' and o.processed_at is null);
end;
$$;
-- select cron.schedule('snack-reminders', '0 * * * *', $$ select public.enqueue_snack_reminders(); $$);
-- Worker (process-notifications) routes: target_user_id → that user; 'completed'
-- → team coaches ("add film"); else the team. See its expandEvent().
-- =====================================================================
