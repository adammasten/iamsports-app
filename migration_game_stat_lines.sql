-- ============================================================
-- migration_game_stat_lines.sql
-- Manual / override stat entry for games. A coach can type in a box
-- score for games that weren't tagged, OR override a tagged game's
-- derived stats. Model is override-PER-GAME: if ANY game_stat_lines
-- row exists for a game, manual is the source of truth for that game
-- and derived stats (from game_box_score) are ignored. No per-cell
-- merging — a game is either tagged-derived or manual, never mixed.
--
-- Depends on:
--   migration_step1.sql          (games, players)
--   migration_stats_layer.sql    (game_box_score view)
--   migration_rls_helpers.sql    (is_super_admin, is_team_member, is_team_coach)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
-- One row per (game_id, player_id, stat_side).
-- player_id NULL = TEAM row (unattributed stats).
-- Points and total rebounds are DERIVED in resolved_game_stats — not
-- stored — so a coach can never enter an internally-inconsistent line.

CREATE TABLE IF NOT EXISTS game_stat_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id          uuid REFERENCES players(id) ON DELETE CASCADE,
  stat_side          text NOT NULL DEFAULT 'own' CHECK (stat_side IN ('own','opponent')),

  fgm                integer NOT NULL DEFAULT 0 CHECK (fgm  >= 0),
  fga                integer NOT NULL DEFAULT 0 CHECK (fga  >= 0),
  fg3m               integer NOT NULL DEFAULT 0 CHECK (fg3m >= 0),
  fg3a               integer NOT NULL DEFAULT 0 CHECK (fg3a >= 0),
  ftm                integer NOT NULL DEFAULT 0 CHECK (ftm  >= 0),
  fta                integer NOT NULL DEFAULT 0 CHECK (fta  >= 0),
  oreb               integer NOT NULL DEFAULT 0 CHECK (oreb >= 0),
  dreb               integer NOT NULL DEFAULT 0 CHECK (dreb >= 0),
  ast                integer NOT NULL DEFAULT 0 CHECK (ast  >= 0),
  tov                integer NOT NULL DEFAULT 0 CHECK (tov  >= 0),
  stl                integer NOT NULL DEFAULT 0 CHECK (stl  >= 0),
  blk                integer NOT NULL DEFAULT 0 CHECK (blk  >= 0),
  pf                 integer NOT NULL DEFAULT 0 CHECK (pf   >= 0),
  tf                 integer NOT NULL DEFAULT 0 CHECK (tf   >= 0),

  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Internal-consistency guards. fgm/fga are TOTAL field goals (3s
  -- included), fg3m/fg3a are the 3-point subset.
  CHECK (fgm  <= fga),
  CHECK (fg3m <= fg3a),
  CHECK (fg3m <= fgm),
  CHECK (fg3a <= fga),
  CHECK (ftm  <= fta)
);

-- Split uniqueness because NULL isn't distinct in a normal UNIQUE:
-- one row per (game, player, side) for real players, and one TEAM row
-- per (game, side) when player_id is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS game_stat_lines_player_uniq
  ON game_stat_lines (game_id, player_id, stat_side)
  WHERE player_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS game_stat_lines_team_uniq
  ON game_stat_lines (game_id, stat_side)
  WHERE player_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_stat_lines_game   ON game_stat_lines (game_id);
CREATE INDEX IF NOT EXISTS idx_game_stat_lines_player ON game_stat_lines (player_id);

-- Bump updated_at on any change.
CREATE OR REPLACE FUNCTION game_stat_lines_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_game_stat_lines_updated_at ON game_stat_lines;
CREATE TRIGGER trg_game_stat_lines_updated_at
  BEFORE UPDATE ON game_stat_lines
  FOR EACH ROW EXECUTE FUNCTION game_stat_lines_touch_updated_at();

-- ------------------------------------------------------------
-- 2. RLS — parent-game-derived access, matches game_lineups pattern.
--    read: any confirmed member of the game's team.
--    write: coaches of the game's team.
-- ------------------------------------------------------------
ALTER TABLE game_stat_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY game_stat_lines_read ON game_stat_lines
  FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_stat_lines.game_id
        AND is_team_member(g.team_id)
    )
  );

CREATE POLICY game_stat_lines_insert ON game_stat_lines
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_stat_lines.game_id
        AND is_team_coach(g.team_id)
    )
  );

CREATE POLICY game_stat_lines_update ON game_stat_lines
  FOR UPDATE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_stat_lines.game_id
        AND is_team_coach(g.team_id)
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_stat_lines.game_id
        AND is_team_coach(g.team_id)
    )
  );

CREATE POLICY game_stat_lines_delete ON game_stat_lines
  FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_stat_lines.game_id
        AND is_team_coach(g.team_id)
    )
  );

-- ------------------------------------------------------------
-- 3. View: resolved_game_stats
--    Manual-if-any-else-derived. Column shape is NCAA-total-FG
--    (fgm/fga include 3s; fg3m/fg3a are the subset). game_box_score
--    stores 2FG and 3FG split, so we sum in the derived branch.
--
--    source = 'manual' | 'tagged' — UI uses this to decide between
--    "Edit" and "Override with manual entry" affordances.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW resolved_game_stats AS
WITH games_with_manual AS (
  SELECT DISTINCT game_id FROM game_stat_lines
),
manual AS (
  SELECT
    gsl.game_id,
    gsl.player_id,
    COALESCE(p.name, 'TEAM') AS player_name,
    gsl.stat_side,
    gsl.fgm, gsl.fga, gsl.fg3m, gsl.fg3a,
    gsl.ftm, gsl.fta,
    gsl.oreb, gsl.dreb,
    (gsl.oreb + gsl.dreb) AS reb,
    gsl.ast, gsl.tov, gsl.stl, gsl.blk, gsl.pf, gsl.tf,
    (2 * (gsl.fgm - gsl.fg3m) + 3 * gsl.fg3m + gsl.ftm) AS pts,
    'manual'::text AS source
  FROM game_stat_lines gsl
  LEFT JOIN players p ON p.id = gsl.player_id
),
derived AS (
  SELECT
    gbs.game_id,
    NULL::uuid AS player_id,
    gbs.player AS player_name,
    gbs.stat_side,
    (gbs.fgm_2 + gbs.fgm_3) AS fgm,
    (gbs.fga_2 + gbs.fga_3) AS fga,
    gbs.fgm_3 AS fg3m,
    gbs.fga_3 AS fg3a,
    gbs.ftm, gbs.fta,
    gbs.oreb, gbs.dreb,
    gbs.reb,
    gbs.ast, gbs.tov, gbs.stl, gbs.blk, gbs.pf, gbs.tf,
    gbs.pts,
    'tagged'::text AS source
  FROM game_box_score gbs
  WHERE gbs.game_id NOT IN (SELECT game_id FROM games_with_manual)
)
SELECT * FROM manual
UNION ALL
SELECT * FROM derived;

-- ------------------------------------------------------------
-- 4. Schema cache trap — force PostgREST to reload
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;
