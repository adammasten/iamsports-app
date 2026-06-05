-- ============================================================
-- RLS lockdown 9b — team_memberships INSERT bootstrap fix.
--
-- PROBLEM: lockdown 8 set tm_insert to
--   is_super_admin() OR is_team_coach(team_id)
-- which makes team creation impossible for normal users. When a user
-- creates a brand-new team, no membership exists yet, so
-- is_team_coach(team_id) is false and they cannot insert their own
-- first (owner) membership — the app then rolls back the new team.
--
-- FIX: also allow inserting a membership for a team the current user
-- CREATED (teams.created_by_user_id = auth.uid()). This lets a team's
-- creator insert their own first membership exactly once at creation
-- time, without granting any broader self-insert rights.
--
-- Depends on: migration_rls_lockdown_8_team_memberships.sql,
--             migration_rls_lockdown_3_clips.sql (is_team_coach()),
--             migration_rls_helpers.sql (is_super_admin()).
-- ============================================================

DROP POLICY IF EXISTS tm_insert ON team_memberships;
CREATE POLICY tm_insert ON team_memberships
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR is_team_coach(team_id)
    OR EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_id
        AND t.created_by_user_id = auth.uid()
    )
  );

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
