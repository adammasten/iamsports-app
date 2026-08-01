-- ============================================================
-- migration_stats_per_row_override.sql
--
-- Model D: per-player override. game_stat_lines rows override
-- tagged stats for a SINGLE player row (not the whole game).
-- Display resolves per-row: manual row wins if one exists for
-- (game, player, stat_side); otherwise the tagged derivation shows.
-- Revert = delete that player's row. Revert-all = delete all rows
-- for a game.
--
-- Changes:
--   1. stat_events: expose t.player_id (was player_name only).
--   2. game_box_score: expose se.player_id (was player name only).
--   3. resolved_game_stats: per-row resolution using
--      IS NOT DISTINCT FROM on player_id so the TEAM row
--      (player_id = NULL on both sides) matches correctly.
--
-- Depends on:
--   migration_step1.sql         (games, players)
--   migration_stats_layer.sql   (stat_events, game_box_score,
--                                tags.player_id)
--   migration_game_stat_lines.sql (game_stat_lines table)
-- ============================================================


-- ------------------------------------------------------------
-- 1. stat_events — add player_id column (additive; existing
--    consumers still read player_name).
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW stat_events AS
WITH bundle_player AS (
  SELECT ct.clip_id, ct.bundle_number, t.name AS player_name, t.player_id
  FROM clip_tags ct
  JOIN tags t ON t.id = ct.tag_id
  WHERE ct.bundle_number >= 1
    AND t.category = 'players'
),
bundle_stat AS (
  SELECT DISTINCT ct.clip_id, ct.bundle_number, t.stat_primitive, t.stat_side
  FROM clip_tags ct
  JOIN tags t ON t.id = ct.tag_id
  WHERE ct.bundle_number >= 1
    AND t.stat_primitive IS NOT NULL
)
SELECT
  bs.clip_id,
  bs.bundle_number,
  bp.player_name,
  bs.stat_primitive,
  bs.stat_side,
  (bp.player_name IS NULL) AS is_team_stat,
  bp.player_id                    -- appended: CREATE OR REPLACE VIEW can only
                                  -- add columns at the end, not reorder.
FROM bundle_stat bs
LEFT JOIN bundle_player bp
  ON bp.clip_id = bs.clip_id
 AND bp.bundle_number = bs.bundle_number;


-- ------------------------------------------------------------
-- 2. game_box_score — add player_id column. TEAM rows have
--    player_id = NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW game_box_score AS
SELECT
  v.game_id,
  COALESCE(se.player_name, 'TEAM') AS player,
  se.stat_side,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'made_2')                  AS fgm_2,
  COUNT(*) FILTER (WHERE se.stat_primitive IN ('made_2','missed_2'))    AS fga_2,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'made_3')                  AS fgm_3,
  COUNT(*) FILTER (WHERE se.stat_primitive IN ('made_3','missed_3'))    AS fga_3,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'made_ft')                 AS ftm,
  COUNT(*) FILTER (WHERE se.stat_primitive IN ('made_ft','missed_ft'))  AS fta,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'made_2') * 2
    + COUNT(*) FILTER (WHERE se.stat_primitive = 'made_3') * 3
    + COUNT(*) FILTER (WHERE se.stat_primitive = 'made_ft')             AS pts,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'off_reb')                 AS oreb,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'def_reb')                 AS dreb,
  COUNT(*) FILTER (WHERE se.stat_primitive IN ('off_reb','def_reb'))    AS reb,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'assist')                  AS ast,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'steal')                   AS stl,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'block')                   AS blk,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'turnover')                AS tov,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'foul')                    AS pf,
  COUNT(*) FILTER (WHERE se.stat_primitive = 'technical')               AS tf,
  se.player_id                    -- appended: same reason as stat_events above.
FROM stat_events se
JOIN clips c  ON c.id = se.clip_id
JOIN videos v ON v.id = c.video_id
WHERE v.game_id IS NOT NULL
GROUP BY v.game_id, se.player_id, COALESCE(se.player_name, 'TEAM'), se.stat_side;


-- ------------------------------------------------------------
-- 3. resolved_game_stats — per-row resolution.
--    Manual wins for a given (game, player, stat_side); tagged
--    derivation fills every other row. IS NOT DISTINCT FROM
--    on player_id so NULL (TEAM) matches NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW resolved_game_stats AS
WITH manual AS (
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
    gbs.player_id,
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
  WHERE NOT EXISTS (
    SELECT 1 FROM manual m
    WHERE m.game_id   = gbs.game_id
      AND m.stat_side = gbs.stat_side
      AND m.player_id IS NOT DISTINCT FROM gbs.player_id
  )
)
SELECT * FROM manual
UNION ALL
SELECT * FROM derived;


-- ------------------------------------------------------------
-- 4. Schema cache trap — force PostgREST to reload
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
