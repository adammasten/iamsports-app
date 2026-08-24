-- =====================================================================
-- Stage 3: public team messaging + notification generalization.
-- APPLIED LIVE via the Supabase MCP (migration: messages_and_notif_generalize).
-- One table for announcements + team chat + (event-attached) conversations.
-- ALL public to team members; adults-only by policy (kids aren't accounts).
-- No private DMs. Announcements ride the SAME notification backbone (outbox
-- generalized to carry a message_id) → push. Chat/replies are in-app for v1.
-- =====================================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,     -- null = team-level; set = event conversation
  parent_id uuid references public.messages(id) on delete cascade,  -- null = top-level; set = public reply
  author_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'chat' check (kind in ('chat','announcement')),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
);
create index messages_team_created_idx on public.messages (team_id, created_at desc);
create index messages_event_idx on public.messages (event_id) where event_id is not null;
create index messages_parent_idx on public.messages (parent_id) where parent_id is not null;
alter table public.messages enable row level security;

create policy messages_read on public.messages for select to authenticated
  using (is_team_member(team_id) or is_super_admin());
create policy messages_insert on public.messages for insert to authenticated
  with check (author_user_id = auth.uid() and is_team_member(team_id)
              and (kind = 'chat' or is_team_coach(team_id)));
create policy messages_update on public.messages for update to authenticated
  using (author_user_id = auth.uid() or is_team_coach(team_id) or is_super_admin())
  with check (author_user_id = auth.uid() or is_team_coach(team_id) or is_super_admin());

-- Generalize the notification backbone for message-sourced notifications.
alter table public.notification_outbox alter column event_id drop not null;
alter table public.notification_outbox add column if not exists message_id uuid references public.messages(id) on delete cascade;
alter table public.notification_outbox add column if not exists source text not null default 'event';

create or replace function public.resolve_team_recipients(p_team_id uuid, p_exclude uuid default null)
returns table (recipient_user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct uid from (
    select tm.user_id as uid from public.team_memberships tm
      where tm.team_id = p_team_id and tm.status = 'confirmed'
    union
    select ppl.parent_user_id as uid from public.players p
      join public.parent_player_links ppl on ppl.player_id = p.id
      where p.team_id = p_team_id
  ) r
  where uid is not null and (p_exclude is null or uid <> p_exclude);
$$;
grant execute on function public.resolve_team_recipients(uuid, uuid) to authenticated, service_role;

create or replace function public.enqueue_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'announcement' and new.parent_id is null and new.deleted_at is null then
    insert into public.notification_outbox (source, message_id, team_id, change_kind, actor_user_id, dispatch_after)
    values ('message', new.id, new.team_id, 'custom', new.author_user_id, now());
  end if;
  return null;
exception when others then
  return null;
end;
$$;
create trigger messages_enqueue_notification
  after insert on public.messages
  for each row execute function public.enqueue_message_notification();
-- Worker (supabase/functions/process-notifications/index.ts) handles both event
-- and message outbox rows (expandEvent / expandMessage).
-- =====================================================================
