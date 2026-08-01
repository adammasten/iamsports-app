-- migration_notifications.sql — in-app notification bell (Phase A: backend).
-- Per-recipient rows (fan-out-on-write), three-state model: unseen (drives the
-- badge, cleared when the list opens) / unread (bold row until tapped) / read.
-- Rows are written by SECURITY DEFINER server actions only (never the client).
-- v1 event: someone shares content to a kid → that kid's OTHER guardians get a
-- row. More events (co-guardian joined, kid added to team) wire in Phase C.
-- Notify SPARINGLY — team-wall/ambient posts deliberately do NOT notify (avoids
-- red-dot blindness).

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                    -- 'share_to_kid' | 'guardian_joined' | 'kid_added_to_team'
  actor_user_id uuid references auth.users(id) on delete set null,
  target_player_id uuid references players(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  entity_type text,                      -- 'game' | 'reel' | 'video' | 'clip' | 'player' | 'team'
  entity_id uuid,
  created_at timestamptz not null default now(),
  seen_at timestamptz,                   -- badge clears (all seen) when the list opens
  read_at timestamptz                    -- per-row, on tap
);
create index if not exists idx_notifications_recipient on notifications (recipient_user_id, created_at desc);

alter table notifications enable row level security;
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select
  using (recipient_user_id = auth.uid() or is_super_admin());
drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications for delete
  using (recipient_user_id = auth.uid());
-- No insert/update policy: rows are inserted by the definer helper; seen/read are
-- set by the definer RPCs below.

-- Fan-out helper (internal — not granted to clients). Never notifies the actor of
-- their own action.
create or replace function public.notify_users(
  p_recipients uuid[], p_type text, p_actor uuid, p_target_player uuid,
  p_team uuid, p_entity_type text, p_entity_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into notifications (recipient_user_id, type, actor_user_id, target_player_id, team_id, entity_type, entity_id)
  select r, p_type, p_actor, p_target_player, p_team, p_entity_type, p_entity_id
  from unnest(p_recipients) r
  where r is not null and r is distinct from p_actor;
end $$;

-- UI RPCs.
create or replace function public.notifications_unseen_count()
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from notifications where recipient_user_id = auth.uid() and seen_at is null;
$$;
grant execute on function public.notifications_unseen_count() to authenticated;

create or replace function public.mark_notifications_seen()
returns void language sql security definer set search_path to 'public' as $$
  update notifications set seen_at = now() where recipient_user_id = auth.uid() and seen_at is null;
$$;
grant execute on function public.mark_notifications_seen() to authenticated;

create or replace function public.mark_notification_read(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update notifications set read_at = now() where id = p_id and recipient_user_id = auth.uid();
$$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- Enriched list for the caller (resolves actor + player + team names so the
-- client can compose "Coach Bobby shared a game with Conrad" without N lookups).
create or replace function public.get_notifications()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'actor_name', coalesce((select up.display_name from user_profiles up where up.user_id = n.actor_user_id), 'Someone'),
    'player_name', split_part(coalesce(p.name, ''), ' ', 1),
    'team_name', t.name,
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
  where n.recipient_user_id = uid;
  return result;
end $$;
grant execute on function public.get_notifications() to authenticated;
