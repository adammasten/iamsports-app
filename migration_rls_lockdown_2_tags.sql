-- ============================================================
-- RLS lockdown 2 of N — FIRST CONTENT TABLE (tags).
--
-- This is the first content-table lockdown. It introduces the
-- reusable is_team_member(uuid) helper, which later content-table
-- lockdowns (clips, videos, games, seasons, ...) will reuse to
-- gate access by confirmed team membership.
--
-- tags access model:
--   read   — global tags are visible to everyone; team tags only
--            to confirmed members of that team; super admins see all.
--   write  — team tags may be created/edited/deleted by confirmed
--            members of the owning team; global tags (team_id NULL)
--            are system-managed, so only super admins may write them
--            (is_team_member(NULL) is false, so the super-admin
--            branch is the only one that matches for globals).
--
-- Depends on: migration_step1.sql (tags, team_memberships),
--             migration_rls_helpers.sql (is_super_admin()).
-- ============================================================

-- Reusable helper: confirmed membership of a given team by the
-- current user. SECURITY DEFINER so it can read team_memberships
-- regardless of that table's own RLS; locked search_path.
CREATE OR REPLACE FUNCTION is_team_member(check_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = check_team_id
      AND user_id = auth.uid()
      AND status = 'confirmed'
  );
$$;

-- Replace the allow_all placeholder with real, per-operation policies.
DROP POLICY IF EXISTS allow_all_tags ON tags;

-- READ — exact predicate as specified.
CREATE POLICY tags_read ON tags
  FOR SELECT
  USING (scope = 'global' OR is_team_member(team_id) OR is_super_admin());

-- INSERT — team tags by confirmed members; global tags super-admin only.
CREATE POLICY tags_insert ON tags
  FOR INSERT
  WITH CHECK ((scope = 'team' AND is_team_member(team_id)) OR is_super_admin());

-- UPDATE — confirmed members of the owning team, or super admin.
CREATE POLICY tags_update ON tags
  FOR UPDATE
  USING (is_team_member(team_id) OR is_super_admin())
  WITH CHECK (is_team_member(team_id) OR is_super_admin());

-- DELETE — confirmed members of the owning team, or super admin.
CREATE POLICY tags_delete ON tags
  FOR DELETE
  USING (is_team_member(team_id) OR is_super_admin());

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
