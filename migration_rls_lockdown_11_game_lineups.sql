-- ============================================================
-- RLS lockdown 11 of N — game_lineups (junction table).
--
-- game_lineups has no team_id / visibility of its own; access is
-- derived from the parent game via games.team_id:
--   read   — super admin, or any confirmed member of the game's team.
--   insert/delete — super admin, or a coach of the game's team.
--
-- NO UPDATE policy: a lineup entry is add/remove only (INSERT a
-- (game_id, player_id) row, DELETE it). Rows are never mutated in
-- place, so with RLS enabled UPDATE stays denied to everyone via
-- the API by default.
--
-- NAMING NOTE: unlike lockdown 10 (parent_player_links, whose
-- placeholder broke the convention), the placeholder here IS named
-- per convention — 'allow_all_game_lineups' (migration_step1.sql:170).
-- So the "real name" and the belt-and-suspenders name are identical;
-- a second DROP of the same name would be a redundant no-op, so it is
-- intentionally not duplicated.
--
-- Depends on: migration_step1.sql (game_lineups, games),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- Drop the allow_all placeholder (real name == convention name here).
DROP POLICY IF EXISTS allow_all_game_lineups ON game_lineups;

-- 1. READ — confirmed members of the parent game's team.
CREATE POLICY game_lineups_read ON game_lineups
  FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_lineups.game_id
        AND is_team_member(g.team_id)
    )
  );

-- 2. INSERT — coaches of the parent game's team.
CREATE POLICY game_lineups_insert ON game_lineups
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_lineups.game_id
        AND is_team_coach(g.team_id)
    )
  );

-- 3. DELETE — coaches of the parent game's team.
CREATE POLICY game_lineups_delete ON game_lineups
  FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_lineups.game_id
        AND is_team_coach(g.team_id)
    )
  );

-- 4. (No UPDATE policy — see header: lineups are add/remove only.)

-- 5. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
