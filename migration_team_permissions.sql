-- ============================================================
-- Team permissions — FOUNDATION (enum + team-wide defaults).
--
-- This file is the base layer: the permission enum and the team-wide defaults
-- store ("All players (default)" row). The PER-PLAYER override store and the
-- has_team_permission resolver live in migration_team_player_permissions.sql
-- (which runs after this and references the player-keyed table).
--
-- Reconciled 2026-07-08 to the PLAYER-keyed model: the old user-keyed
-- team_member_permissions table + its RPCs were retired (see the reconciliation
-- migration). There is intentionally NO user-keyed override table anymore.
--
-- Depends on (live): is_super_admin(), is_team_member(uuid), is_team_coach(uuid),
-- teams, auth.users. Idempotent + single transaction.
-- ============================================================

BEGIN;

-- 1. The 8 permissions as a typed enum (typo-proof keys).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'team_permission') then
    create type team_permission as enum (
      'post_wall', 'upload_video', 'tag_videos', 'send_to_team',
      'create_games', 'build_reels', 'delete_content', 'manage_roster'
    );
  end if;
end $$;

-- 2. Team-wide defaults — the "All players (default)" row of the grid.
create table if not exists team_permission_defaults (
  team_id            uuid not null references teams(id) on delete cascade,
  permission         team_permission not null,
  allowed            boolean not null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (team_id, permission)
);

-- 3. RLS: any confirmed member of the team can read the defaults; writes go
--    through the RPC below (no write policy = direct writes denied).
alter table team_permission_defaults enable row level security;

drop policy if exists tpd_read on team_permission_defaults;
create policy tpd_read on team_permission_defaults
  for select using (is_super_admin() or is_team_member(team_id));

-- 4. Write RPC — set/replace a team-wide default. CONFIRMED coach/admin of the
--    team only (is_team_coach requires status='confirmed').
create or replace function set_team_default_permission(
  p_team_id uuid, p_permission team_permission, p_allowed boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  insert into team_permission_defaults (team_id, permission, allowed, updated_by_user_id, updated_at)
  values (p_team_id, p_permission, p_allowed, auth.uid(), now())
  on conflict (team_id, permission) do update
    set allowed = excluded.allowed,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
end; $$;

revoke all on function set_team_default_permission(uuid, team_permission, boolean) from public, anon;
grant execute on function set_team_default_permission(uuid, team_permission, boolean) to authenticated;

notify pgrst, 'reload schema';

COMMIT;
