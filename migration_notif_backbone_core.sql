-- =====================================================================
-- Notification backbone (Stage 1) — outbox + delivery log + resolver.
-- APPLIED LIVE via the Supabase MCP (migration: notif_backbone_core).
-- The schedule is the source of truth; a DB trigger on `events` writes ONE
-- outbox row per notify-worthy change, the `process-notifications` worker fans
-- it out to per-recipient rows (idempotent), and channel dispatchers deliver.
-- Extends the LIVE events/team_memberships/parent_player_links schema — there is
-- NO parallel schedule_events / event_availability table.
-- =====================================================================
alter table public.user_profiles add column if not exists timezone text;
alter table public.parent_player_links
  add column if not exists receives_logistics_alerts boolean not null default true;

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid not null,
  change_kind text not null check (change_kind in ('created','time_changed','venue_changed','canceled','completed','custom')),
  actor_user_id uuid,
  event_version int,
  payload jsonb not null default '{}',
  dispatch_after timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notification_outbox_one_pending on public.notification_outbox (event_id) where processed_at is null;
create index notification_outbox_due_idx on public.notification_outbox (dispatch_after) where processed_at is null;
alter table public.notification_outbox enable row level security;  -- service-role only (no policies)

create table public.schedule_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  team_id uuid,
  recipient_user_id uuid not null,
  channel text not null check (channel in ('push','sms','wall')),
  change_kind text not null,
  dedupe_key text not null unique,               -- (event, recipient, channel, kind, version) → never double-send
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','opted_out','skipped')),
  send_after timestamptz not null default now(),
  title text, body text, data jsonb not null default '{}',
  provider_message_id text, error_code text,
  sent_at timestamptz,
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index schedule_notifications_due_idx on public.schedule_notifications (send_after) where status='queued';
create index schedule_notifications_event_idx on public.schedule_notifications (event_id);
alter table public.schedule_notifications enable row level security;
create policy schedule_notifications_read on public.schedule_notifications
  for select to authenticated using (is_team_coach(team_id) or is_super_admin());

-- Adult recipients for an event: confirmed team members + linked guardians
-- (respecting receives_logistics_alerts), minus an optional excluded actor.
create or replace function public.resolve_event_recipients(p_event_id uuid, p_exclude uuid default null)
returns table (recipient_user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct uid from (
    select tm.user_id as uid
      from public.events e
      join public.team_memberships tm on tm.team_id = e.team_id and tm.status = 'confirmed'
      where e.id = p_event_id
    union
    select ppl.parent_user_id as uid
      from public.events e
      join public.players p on p.team_id = e.team_id
      join public.parent_player_links ppl on ppl.player_id = p.id and ppl.receives_logistics_alerts
      where e.id = p_event_id
  ) r
  where uid is not null and (p_exclude is null or uid <> p_exclude);
$$;
grant execute on function public.resolve_event_recipients(uuid, uuid) to authenticated, service_role;
-- =====================================================================
