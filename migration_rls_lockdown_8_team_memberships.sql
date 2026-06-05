-- ============================================================
-- RLS lockdown 8 of N — team_memberships.
--
-- IMPORTANT (no recursion): this is the very table that the
-- is_team_member()/is_team_coach() helpers read. Those helpers are
-- SECURITY DEFINER, so they run as the function owner and BYPASS the
-- policies below — they do not re-trigger team_memberships RLS, so
-- there is no infinite recursion when a policy here (or on any other
-- table) calls them.
--
-- Access model:
--   read   — super admin, your own membership rows, or any membership
--            of a team you are a confirmed member of.
--   insert — super admin or a coach of the team (adding members).
--   update/delete — super admin, a coach of the team, OR the row's
--            own user (so a member can edit/leave their own membership).
--
-- Depends on: migration_step1.sql (team_memberships),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- Replace the allow_all placeholder with real, per-operation policies.
DROP POLICY IF EXISTS allow_all_team_memberships ON team_memberships;

-- READ — own rows, or memberships of teams you belong to.
CREATE POLICY tm_read ON team_memberships
  FOR SELECT
  USING (is_super_admin() OR user_id = auth.uid() OR is_team_member(team_id));

-- INSERT — coaches add members.
CREATE POLICY tm_insert ON team_memberships
  FOR INSERT
  WITH CHECK (is_super_admin() OR is_team_coach(team_id));

-- UPDATE — coaches manage, or the user edits their own row.
CREATE POLICY tm_update ON team_memberships
  FOR UPDATE
  USING (is_super_admin() OR is_team_coach(team_id) OR user_id = auth.uid())
  WITH CHECK (is_super_admin() OR is_team_coach(team_id) OR user_id = auth.uid());

-- DELETE — coaches remove members, or the user leaves (deletes own row).
CREATE POLICY tm_delete ON team_memberships
  FOR DELETE
  USING (is_super_admin() OR is_team_coach(team_id) OR user_id = auth.uid());

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
