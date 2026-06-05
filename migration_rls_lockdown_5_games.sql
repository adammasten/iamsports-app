-- ============================================================
-- RLS lockdown 5 of N — games (members read, coaches write).
--
-- games are straightforward team content: any confirmed team
-- member may read; only coaching roles may create/update/delete.
-- Reuses is_team_member()/is_team_coach() from the earlier lockdowns.
--
-- Depends on: migration_step1.sql (games, team_memberships),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- Replace the allow_all placeholder with real, per-operation policies.
DROP POLICY IF EXISTS allow_all_games ON games;

-- READ — any confirmed team member.
CREATE POLICY games_read ON games
  FOR SELECT
  USING (is_team_member(team_id) OR is_super_admin());

-- INSERT — coaching roles only.
CREATE POLICY games_insert ON games
  FOR INSERT
  WITH CHECK (is_team_coach(team_id) OR is_super_admin());

-- UPDATE — coaching roles only.
CREATE POLICY games_update ON games
  FOR UPDATE
  USING (is_team_coach(team_id) OR is_super_admin())
  WITH CHECK (is_team_coach(team_id) OR is_super_admin());

-- DELETE — coaching roles only.
CREATE POLICY games_delete ON games
  FOR DELETE
  USING (is_team_coach(team_id) OR is_super_admin());

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
