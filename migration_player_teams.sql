-- ============================================================
-- player_teams — junction so one players row can be on many teams.
--
-- A kid (one players row, with team-independent name/grad_class/photo) can be
-- rostered on multiple teams. The jersey NUMBER is per-team and lives here
-- (Lars = 32 on Centex, different elsewhere) — NOT on players.
--
-- Coexistence: players.team_id is KEPT as a legacy single-team pointer used by
-- the existing lockdown-7/10 RLS policies (not rewritten here). New kids are
-- teamless (players.team_id NULL) and gain teams via this junction. A future
-- cleanup can backfill players.team_id -> player_teams and retire the column.
--
-- Writes go through the attach_kid_to_team RPC (SECURITY DEFINER) because a
-- coach can't directly INSERT under default-deny RLS — same pattern as
-- create_kid / update_kid / set_kid_photo.
--
-- DEPENDS ON (functions that live only in Supabase today, not in repo
-- migrations): is_super_admin(), is_team_member(uuid), is_team_coach(uuid),
-- is_linked_parent(uuid). Ensure those exist before running.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Junction table.
create table if not exists player_teams (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references players(id) on delete cascade,
  team_id           uuid not null references teams(id) on delete cascade,
  jersey_number     text,                                   -- per-team number
  added_by_user_id  uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (player_id, team_id)
);
create index if not exists idx_player_teams_player on player_teams(player_id);
create index if not exists idx_player_teams_team   on player_teams(team_id);

-- 2. RLS — read for the kid's linked parent, the team's members, or super admin.
--    No direct write policy: inserts go through attach_kid_to_team (RPC).
alter table player_teams enable row level security;

drop policy if exists player_teams_read on player_teams;
create policy player_teams_read on player_teams
  for select
  using (
    is_super_admin()
    or is_team_member(team_id)
    or is_linked_parent(player_id)
  );

-- 3. attach_kid_to_team — coach/admin of the team links a kid to it.
--    ON CONFLICT updates the jersey, so re-attaching is idempotent and lets a
--    coach correct the number.
create or replace function attach_kid_to_team(p_player_id uuid, p_team_id uuid, p_jersey_number text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if not is_super_admin() and not is_team_coach(p_team_id) then
    raise exception 'Only a coach or admin of this team can add players';
  end if;

  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (
    p_player_id,
    p_team_id,
    nullif(trim(coalesce(p_jersey_number, '')), ''),
    uid
  )
  on conflict (player_id, team_id) do update
    set jersey_number = excluded.jersey_number
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function attach_kid_to_team(uuid, uuid, text) from public, anon;
grant execute on function attach_kid_to_team(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
