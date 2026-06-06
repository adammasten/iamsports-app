-- ============================================================
-- RLS lockdown 12 of N — video_tagging_rights.
--
-- RECONCILIATION: mirrors the policies applied live in the Supabase
-- SQL editor. Access derives from the parent video via videos.team_id:
--   read   — super admin, the grantee themselves
--            (granted_to_user_id = auth.uid()), or a coach of the
--            video's team.
--   insert/update/delete — super admin, or a coach of the video's team.
--
-- Depends on: migration_tagging_rights.sql (video_tagging_rights),
--             migration_step1.sql (videos),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

DROP POLICY IF EXISTS allow_all_video_tagging_rights ON video_tagging_rights;

-- READ — grantee or coach of the video's team.
CREATE POLICY video_tagging_rights_read ON video_tagging_rights
  FOR SELECT
  USING (
    is_super_admin()
    OR granted_to_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM videos v
      WHERE v.id = video_tagging_rights.video_id
        AND is_team_coach(v.team_id)
    )
  );

-- INSERT — coach of the video's team.
CREATE POLICY video_tagging_rights_insert ON video_tagging_rights
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM videos v
      WHERE v.id = video_tagging_rights.video_id
        AND is_team_coach(v.team_id)
    )
  );

-- UPDATE — coach of the video's team.
CREATE POLICY video_tagging_rights_update ON video_tagging_rights
  FOR UPDATE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM videos v
      WHERE v.id = video_tagging_rights.video_id
        AND is_team_coach(v.team_id)
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM videos v
      WHERE v.id = video_tagging_rights.video_id
        AND is_team_coach(v.team_id)
    )
  );

-- DELETE — coach of the video's team.
CREATE POLICY video_tagging_rights_delete ON video_tagging_rights
  FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM videos v
      WHERE v.id = video_tagging_rights.video_id
        AND is_team_coach(v.team_id)
    )
  );

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
