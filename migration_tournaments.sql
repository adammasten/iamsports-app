-- ============================================================
-- Upload rebuild — tournaments as a small pick-or-create entity (not free text),
-- scoped per team + unique per team so "Summer Slam" / "summer slam" don't
-- fork. games.tournament_id links a game to its tournament.
-- Writes: any confirmed team member of that team (they picked one of their own
-- teams on the upload form). Additive, idempotent.
-- Depends on (live): is_super_admin(), is_team_member(uuid), teams, games, auth.users.
-- ============================================================

BEGIN;

create table if not exists tournaments (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references teams(id) on delete cascade,
  name               text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (team_id, name)
);
create index if not exists idx_tournaments_team on tournaments(team_id);

alter table tournaments enable row level security;

drop policy if exists tournaments_read on tournaments;
create policy tournaments_read on tournaments
  for select using (is_super_admin() or is_team_member(team_id));

drop policy if exists tournaments_insert on tournaments;
create policy tournaments_insert on tournaments
  for insert with check (is_super_admin() or is_team_member(team_id));

alter table games add column if not exists tournament_id uuid references tournaments(id) on delete set null;
create index if not exists idx_games_tournament on games(tournament_id);

notify pgrst, 'reload schema';

COMMIT;
