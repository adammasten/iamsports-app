-- ============================================================
-- RLS lockdown 3 of N — clips (visibility-aware).
--
-- Introduces is_team_coach(uuid): confirmed membership of a team
-- with a coaching role. NOTE: 'assistant_coach' is intentionally
-- OMITTED from the role list because it is not in the
-- membership_role enum yet (current enum: admin, head_coach,
-- coach, parent, player, follower — see migration_step1.sql).
-- When assistant_coach is added to the enum, update this helper.
--
-- clips access model (mirrors content_visibility enum):
--   read   — super admin, or the clip's creator, or a confirmed
--            team member for 'team'/'public_link' clips, or a
--            team coach for 'coaches_only' clips. 'private_to_creator'
--            is covered only by the created_by_user_id branch.
--   insert — super admin or any confirmed team member.
--   update/delete — super admin, the creator, or a team coach.
--
-- Depends on: migration_step1.sql (clips, team_memberships),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()).
-- ============================================================

-- Reusable helper: confirmed COACHING membership of a given team by
-- the current user. SECURITY DEFINER + locked search_path.
CREATE OR REPLACE FUNCTION is_team_coach(check_team_id uuid)
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
      AND role IN ('admin', 'head_coach', 'coach')
  );
$$;

-- Replace the allow_all placeholder with real, per-operation policies.
DROP POLICY IF EXISTS allow_all_clips ON clips;

-- READ — visibility-aware.
CREATE POLICY clips_read ON clips
  FOR SELECT
  USING (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR (visibility = 'team'         AND is_team_member(team_id))
    OR (visibility = 'public_link'  AND is_team_member(team_id))
    OR (visibility = 'coaches_only' AND is_team_coach(team_id))
  );

-- INSERT — super admin or any confirmed team member.
CREATE POLICY clips_insert ON clips
  FOR INSERT
  WITH CHECK (is_super_admin() OR is_team_member(team_id));

-- UPDATE — super admin, the creator, or a team coach.
CREATE POLICY clips_update ON clips
  FOR UPDATE
  USING (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_coach(team_id))
  WITH CHECK (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_coach(team_id));

-- DELETE — super admin, the creator, or a team coach.
CREATE POLICY clips_delete ON clips
  FOR DELETE
  USING (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_coach(team_id));

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
