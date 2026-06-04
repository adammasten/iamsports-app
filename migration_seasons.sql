-- ============================================================
-- Seasons migration — ADDITIVE ONLY. Nothing is dropped.
-- Adds a seasons table, a teams.grad_class column, and season_id
-- foreign keys onto team_memberships, players, games, and videos.
-- Safe to re-run: guarded with IF NOT EXISTS / existence checks.
-- ============================================================

BEGIN;

-- 1. Enum: season_status (guarded so re-running is a no-op)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'season_status') THEN
    CREATE TYPE season_status AS ENUM ('active', 'archived');
  END IF;
END $$;

-- 2. seasons table
CREATE TABLE IF NOT EXISTS seasons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name                text NOT NULL,
  starts_on           date,
  ends_on             date,
  status              season_status NOT NULL DEFAULT 'active',
  created_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, name)
);
CREATE INDEX IF NOT EXISTS idx_seasons_team ON seasons(team_id);

-- 3. teams.grad_class
ALTER TABLE teams ADD COLUMN IF NOT EXISTS grad_class text;

-- 4. team_memberships.season_id
ALTER TABLE team_memberships ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES seasons(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_memberships_season ON team_memberships(season_id);

-- 5. players.season_id
ALTER TABLE players ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES seasons(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_players_season ON players(season_id);

-- 6. players.player_lineage_id (no FK; groups a player's rows across seasons)
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_lineage_id uuid;
CREATE INDEX IF NOT EXISTS idx_players_lineage ON players(player_lineage_id);

-- 7. games.season_id
ALTER TABLE games ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES seasons(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season_id);

-- 8. videos.season_id
ALTER TABLE videos ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES seasons(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_videos_season ON videos(season_id);

-- 9. RLS — allow_all placeholder on seasons, matching the existing tables
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seasons' AND policyname = 'allow_all_seasons'
  ) THEN
    CREATE POLICY allow_all_seasons ON seasons FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;

-- 10. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
