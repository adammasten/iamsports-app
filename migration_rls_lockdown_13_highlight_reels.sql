-- ============================================================
-- RLS lockdown 13 of N — highlight_reels.
--
-- RECONCILIATION: mirrors the policies applied live in the Supabase
-- SQL editor.
--   read   — super admin, the creator (created_by_user_id), any reel
--            that has a public_share_token set, or a confirmed member
--            of the reel's team.
--   insert — super admin or a confirmed team member.
--   update/delete — super admin, the creator, or a team coach.
--
-- COLUMN NOTE: ownership column is created_by_user_id (NOT created_by).
--
-- SECURITY NOTE: the read predicate exposes the ENTIRE reel row to any
-- caller whenever public_share_token IS NOT NULL — token presence
-- alone grants read, the policy does not check that the caller knows
-- the token value. That makes shared reels effectively world-readable
-- at the row level (intended for public sharing). The token still
-- gates access to the underlying media via storage policies / signed
-- URLs, which are handled separately.
--
-- Depends on: migration_walls_reels_sharing.sql (highlight_reels),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

DROP POLICY IF EXISTS allow_all_highlight_reels ON highlight_reels;

-- READ — creator, shared (token present), team member, or super admin.
CREATE POLICY highlight_reels_read ON highlight_reels
  FOR SELECT
  USING (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR public_share_token IS NOT NULL
    OR is_team_member(team_id)
  );

-- INSERT — confirmed team member.
CREATE POLICY highlight_reels_insert ON highlight_reels
  FOR INSERT
  WITH CHECK (is_super_admin() OR is_team_member(team_id));

-- UPDATE — creator or team coach.
CREATE POLICY highlight_reels_update ON highlight_reels
  FOR UPDATE
  USING (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_coach(team_id))
  WITH CHECK (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_coach(team_id));

-- DELETE — creator or team coach.
CREATE POLICY highlight_reels_delete ON highlight_reels
  FOR DELETE
  USING (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_coach(team_id));

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
