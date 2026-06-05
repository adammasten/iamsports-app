-- ============================================================
-- RLS lockdown 4 of N — clip_tags (access follows parent clip).
--
-- clip_tags has no team_id / creator of its own; access is derived
-- from the parent clip via an EXISTS subquery, mirroring the clips
-- read/insert/delete model from lockdown 3.
--
-- NO UPDATE policy: tagging is an add/remove operation (INSERT new
-- rows, DELETE existing ones); rows are never mutated in place, so
-- with RLS enabled UPDATEs are denied to everyone via the API.
--
-- Depends on: migration_step1.sql (clip_tags, clips),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- Replace the allow_all placeholder with parent-derived policies.
DROP POLICY IF EXISTS allow_all_clip_tags ON clip_tags;

-- READ — visible when the parent clip is readable.
CREATE POLICY clip_tags_read ON clip_tags
  FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM clips c
      WHERE c.id = clip_tags.clip_id
        AND (
          c.created_by_user_id = auth.uid()
          OR (c.visibility IN ('team', 'public_link') AND is_team_member(c.team_id))
          OR (c.visibility = 'coaches_only' AND is_team_coach(c.team_id))
        )
    )
  );

-- INSERT — taggable when the user can tag the parent clip
-- (creator or a confirmed team member).
CREATE POLICY clip_tags_insert ON clip_tags
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM clips c
      WHERE c.id = clip_tags.clip_id
        AND (
          c.created_by_user_id = auth.uid()
          OR is_team_member(c.team_id)
        )
    )
  );

-- DELETE — removable by the parent clip's creator or a team coach.
CREATE POLICY clip_tags_delete ON clip_tags
  FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM clips c
      WHERE c.id = clip_tags.clip_id
        AND (
          c.created_by_user_id = auth.uid()
          OR is_team_coach(c.team_id)
        )
    )
  );

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
