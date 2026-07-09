-- ============================================================
-- Game scores — STRUCTURED integer scores. Supersedes the earlier freeform
-- text games.score / games.result (dropped here). W/L/T is DERIVED in the app
-- from the two numbers, so there is no stored result column.
--   team_score     = the game team's score (labeled with the team name in-app)
--   opponent_score = the opponent's score
--
-- ⚠️ DESTRUCTIVE: drops games.score / games.result. Run the empty-check first
-- (both columns must be all-null) — proven, not assumed — before applying.
-- Idempotent (drop/add IF EXISTS/NOT EXISTS), single transaction. Works on a
-- fresh DB (drops are no-ops) and on the already-drifted live DB (removes the
-- freeform columns that were added earlier).
-- ============================================================

BEGIN;

alter table games drop column if exists score;
alter table games drop column if exists result;

alter table games add column if not exists team_score     int;
alter table games add column if not exists opponent_score int;

notify pgrst, 'reload schema';

COMMIT;
