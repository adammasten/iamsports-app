-- ============================================================
-- Seasons backfill — DATA ONLY, additive. Nothing is dropped.
-- Run AFTER migration_seasons.sql. Safe to re-run (idempotent):
-- inserts use ON CONFLICT DO NOTHING and updates only touch NULLs.
-- ============================================================

BEGIN;

-- 1. One "Legacy" season per existing team
INSERT INTO seasons (team_id, name)
SELECT id, 'Legacy' FROM teams
ON CONFLICT (team_id, name) DO NOTHING;

-- 2. Backfill team_memberships to their team's Legacy season
UPDATE team_memberships m
SET season_id = s.id
FROM seasons s
WHERE s.team_id = m.team_id
  AND s.name = 'Legacy'
  AND m.season_id IS NULL;

-- 2. Backfill games to their team's Legacy season
UPDATE games g
SET season_id = s.id
FROM seasons s
WHERE s.team_id = g.team_id
  AND s.name = 'Legacy'
  AND g.season_id IS NULL;

-- 2. Backfill videos to their team's Legacy season.
--    Videos without a team_id are left NULL (s.team_id = v.team_id
--    never matches a NULL, so those rows are untouched).
UPDATE videos v
SET season_id = s.id
FROM seasons s
WHERE s.team_id = v.team_id
  AND s.name = 'Legacy'
  AND v.season_id IS NULL;

-- 3. Backfill players: season_id -> team's Legacy season where NULL
UPDATE players p
SET season_id = s.id
FROM seasons s
WHERE s.team_id = p.team_id
  AND s.name = 'Legacy'
  AND p.season_id IS NULL;

-- 3. Each existing player becomes its own lineage root
UPDATE players
SET player_lineage_id = id
WHERE player_lineage_id IS NULL;

COMMIT;

-- 4. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
