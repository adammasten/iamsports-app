-- ============================================================
-- RLS lockdown 9 of N — teams + seasons.
--
-- teams access model:
--   read   — super admin, confirmed members, or the team's creator.
--   insert — any authenticated user may create a team (the creator
--            is recorded via created_by_user_id; their first
--            membership is inserted via the bootstrap policy in
--            migration_rls_lockdown_9b_tm_insert_bootstrap.sql).
--   update/delete — super admin, a team coach, or the creator.
--
-- seasons access model:
--   read   — super admin or confirmed team members.
--   write  — super admin or team coaches.
--
-- Depends on: migration_step1.sql (teams), migration_seasons.sql
--             (seasons), migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- ---------- teams ----------
DROP POLICY IF EXISTS allow_all_teams ON teams;

-- READ — members, creator, or super admin.
CREATE POLICY teams_read ON teams
  FOR SELECT
  USING (is_super_admin() OR is_team_member(id) OR created_by_user_id = auth.uid());

-- INSERT — any authenticated user may create a team.
CREATE POLICY teams_insert ON teams
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE — super admin, a team coach, or the creator.
CREATE POLICY teams_update ON teams
  FOR UPDATE
  USING (is_super_admin() OR is_team_coach(id) OR created_by_user_id = auth.uid())
  WITH CHECK (is_super_admin() OR is_team_coach(id) OR created_by_user_id = auth.uid());

-- DELETE — super admin, a team coach, or the creator.
CREATE POLICY teams_delete ON teams
  FOR DELETE
  USING (is_super_admin() OR is_team_coach(id) OR created_by_user_id = auth.uid());

-- ---------- seasons ----------
DROP POLICY IF EXISTS allow_all_seasons ON seasons;

-- READ — confirmed team members or super admin.
CREATE POLICY seasons_read ON seasons
  FOR SELECT
  USING (is_super_admin() OR is_team_member(team_id));

-- INSERT — coaches only.
CREATE POLICY seasons_insert ON seasons
  FOR INSERT
  WITH CHECK (is_super_admin() OR is_team_coach(team_id));

-- UPDATE — coaches only.
CREATE POLICY seasons_update ON seasons
  FOR UPDATE
  USING (is_super_admin() OR is_team_coach(team_id))
  WITH CHECK (is_super_admin() OR is_team_coach(team_id));

-- DELETE — coaches only.
CREATE POLICY seasons_delete ON seasons
  FOR DELETE
  USING (is_super_admin() OR is_team_coach(team_id));

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
