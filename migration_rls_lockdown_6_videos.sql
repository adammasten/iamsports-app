-- ============================================================
-- RLS lockdown 6 of N — videos (visibility-aware, teamless-safe).
--
-- videos mirror the clips visibility model from lockdown 3, but are
-- adapted for teamless PERSONAL uploads: videos.team_id is nullable,
-- so ownership falls back to uploaded_by_user_id when there is no
-- team. (is_team_member(NULL)/is_team_coach(NULL) are false, so the
-- uploader branch is what covers personal uploads.)
--
-- NOTE: this governs only the videos *table* rows. Access to the
-- actual video files in the 'Videos' storage bucket is controlled by
-- separate storage.objects policies and is NOT addressed here.
--
-- Depends on: migration_step1.sql (videos, team_memberships),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- Replace the allow_all placeholder with real, per-operation policies.
DROP POLICY IF EXISTS allow_all_videos ON videos;

-- READ — visibility-aware (mirrors clips_read), uploader always sees own.
CREATE POLICY videos_read ON videos
  FOR SELECT
  USING (
    is_super_admin()
    OR uploaded_by_user_id = auth.uid()
    OR (visibility = 'team'         AND is_team_member(team_id))
    OR (visibility = 'public_link'  AND is_team_member(team_id))
    OR (visibility = 'coaches_only' AND is_team_coach(team_id))
  );

-- INSERT — team uploads by confirmed members; teamless uploads by the
-- uploader themselves.
CREATE POLICY videos_insert ON videos
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (team_id IS NOT NULL AND is_team_member(team_id))
    OR (team_id IS NULL AND uploaded_by_user_id = auth.uid())
  );

-- UPDATE — super admin, the uploader, or a team coach.
CREATE POLICY videos_update ON videos
  FOR UPDATE
  USING (is_super_admin() OR uploaded_by_user_id = auth.uid() OR is_team_coach(team_id))
  WITH CHECK (is_super_admin() OR uploaded_by_user_id = auth.uid() OR is_team_coach(team_id));

-- DELETE — super admin, the uploader, or a team coach.
CREATE POLICY videos_delete ON videos
  FOR DELETE
  USING (is_super_admin() OR uploaded_by_user_id = auth.uid() OR is_team_coach(team_id));

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
