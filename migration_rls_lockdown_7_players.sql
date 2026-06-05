-- ============================================================
-- RLS lockdown 7 of N — players (roster table).
--
-- Roster access: any confirmed team member may read the roster;
-- only coaching roles may add/edit/remove players. A player who is
-- linked to an auth user (players.user_id) may always read their
-- own row, even outside the team-membership path.
--
-- NOTE: "name-drop-on-delete" (preserving a player's name on
-- dependent rows when the roster entry is removed) is application
-- logic, not enforced by RLS or by this migration.
--
-- Depends on: migration_step1.sql (players, team_memberships),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- Replace the allow_all placeholder with real, per-operation policies.
DROP POLICY IF EXISTS allow_all_players ON players;

-- READ — team members, the linked user themselves, or super admin.
CREATE POLICY players_read ON players
  FOR SELECT
  USING (is_super_admin() OR is_team_member(team_id) OR user_id = auth.uid());

-- INSERT — coaching roles only.
CREATE POLICY players_insert ON players
  FOR INSERT
  WITH CHECK (is_team_coach(team_id) OR is_super_admin());

-- UPDATE — coaching roles only.
CREATE POLICY players_update ON players
  FOR UPDATE
  USING (is_team_coach(team_id) OR is_super_admin())
  WITH CHECK (is_team_coach(team_id) OR is_super_admin());

-- DELETE — coaching roles only.
CREATE POLICY players_delete ON players
  FOR DELETE
  USING (is_team_coach(team_id) OR is_super_admin());

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
