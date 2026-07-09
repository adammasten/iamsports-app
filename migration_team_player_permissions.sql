-- ============================================================
-- Per-player permissions (the ONE override store) + the has_team_permission
-- resolver. Reconciled 2026-07-08 to be fully PLAYER-keyed:
--   * grid read/write and enforcement all use team_player_permissions;
--   * team-wide defaults stay in team_permission_defaults;
--   * the old user-keyed team_member_permissions is retired (see the drop at the
--     bottom — run only after verifying zero references).
--
-- has_team_permission resolution order:
--   1. super admin -> true
--   2. HIGHEST role the user holds on the team (admin>head_coach>coach>parent>
--      player>follower); coach-level roles -> true (all 8, role-derived)
--   3. non-coach: their linked player(s) on the team (parent_player_links x
--      player_teams) -> per-player override in team_player_permissions
--      (MOST-PERMISSIVE across multiple kids, v1)
--   4. team default -> 5. system default (6 ON; delete/roster OFF)
--
-- Depends on (live): team_permission enum + team_permission_defaults
-- (migration_team_permissions.sql), is_super_admin(), is_team_coach(uuid),
-- teams, players, player_teams, parent_player_links, team_memberships,
-- auth.users. Idempotent + single transaction.
-- ============================================================

BEGIN;

-- 1. The per-player override table (team_id, player_id, permission).
create table if not exists team_player_permissions (
  team_id            uuid not null references teams(id) on delete cascade,
  player_id          uuid not null references players(id) on delete cascade,
  permission         team_permission not null,
  allowed            boolean not null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (team_id, player_id, permission)
);
create index if not exists idx_tpp_team on team_player_permissions(team_id);

-- 2. RLS: read for a coach of the team or the player's linked parent; writes go
--    through the RPCs below (no write policy = direct writes denied).
alter table team_player_permissions enable row level security;

drop policy if exists tpp_read on team_player_permissions;
create policy tpp_read on team_player_permissions
  for select using (
    is_super_admin() or is_team_coach(team_id) or is_linked_parent(player_id)
  );

-- 3. Write RPCs — CONFIRMED coach/admin of the team only.
create or replace function set_team_player_permission(
  p_team_id uuid, p_player_id uuid, p_permission team_permission, p_allowed boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  insert into team_player_permissions (team_id, player_id, permission, allowed, updated_by_user_id, updated_at)
  values (p_team_id, p_player_id, p_permission, p_allowed, auth.uid(), now())
  on conflict (team_id, player_id, permission) do update
    set allowed = excluded.allowed,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
end; $$;

create or replace function clear_team_player_permission(
  p_team_id uuid, p_player_id uuid, p_permission team_permission
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  delete from team_player_permissions
  where team_id = p_team_id and player_id = p_player_id and permission = p_permission;
end; $$;

-- 4. THE RESOLVER — player-keyed, most-powerful-role-wins.
create or replace function has_team_permission(p_team_id uuid, p_permission team_permission)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_top membership_role;
  v_allowed boolean;
begin
  if v_uid is null then
    return false;
  end if;

  if is_super_admin() then
    return true;
  end if;

  -- Highest-ranked role this user holds on the team.
  select role into v_top
  from team_memberships
  where team_id = p_team_id and user_id = v_uid and status = 'confirmed'
  order by case role
    when 'admin' then 6 when 'head_coach' then 5 when 'coach' then 4
    when 'parent' then 3 when 'player' then 2 when 'follower' then 1 else 0
  end desc
  limit 1;

  if v_top is null then
    return false;                               -- not a confirmed member
  end if;
  if v_top in ('admin', 'head_coach', 'coach') then
    return true;                                -- coach roles win → all 8
  end if;

  -- Non-coach: per-PLAYER override for THIS user's linked player(s) on the team.
  -- MOST-PERMISSIVE across multiple kids (bool_or). NULL = no override rows.
  select bool_or(tpp.allowed) into v_allowed
  from parent_player_links ppl
  join player_teams pt
    on pt.player_id = ppl.player_id and pt.team_id = p_team_id
  join team_player_permissions tpp
    on tpp.player_id = ppl.player_id and tpp.team_id = p_team_id and tpp.permission = p_permission
  where ppl.parent_user_id = v_uid;
  if v_allowed is not null then
    return v_allowed;
  end if;

  -- Team-wide default.
  select allowed into v_allowed
  from team_permission_defaults
  where team_id = p_team_id and permission = p_permission;
  if found then
    return v_allowed;
  end if;

  -- System default (6 ON; two destructive/structural OFF).
  return case p_permission
    when 'delete_content' then false
    when 'manage_roster'  then false
    else true
  end;
end;
$$;

-- 5. Grants.
revoke all on function set_team_player_permission(uuid, uuid, team_permission, boolean) from public, anon;
grant execute on function set_team_player_permission(uuid, uuid, team_permission, boolean) to authenticated;
revoke all on function clear_team_player_permission(uuid, uuid, team_permission) from public, anon;
grant execute on function clear_team_player_permission(uuid, uuid, team_permission) to authenticated;
revoke all on function has_team_permission(uuid, team_permission) from public, anon;
grant execute on function has_team_permission(uuid, team_permission) to authenticated;

notify pgrst, 'reload schema';

COMMIT;
