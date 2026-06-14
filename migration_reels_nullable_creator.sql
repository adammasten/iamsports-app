-- ============================================================
-- highlight_reels — creator-owned, team-optional.
--
-- GOAL: let a parent (or anyone) own a reel with NO team, while
-- team reels keep working for coaches. Two changes:
--   1. team_id becomes nullable (FK to teams is kept).
--   2. RLS gains a creator-ownership branch on every policy:
--      created_by_user_id = auth.uid() always grants the creator
--      full read/insert/update/delete on their own reel, regardless
--      of team_id (so a null-team reel is fully usable by its owner).
--
-- The existing team-membership branches are preserved unchanged:
--   read   — super admin, creator, any reel with a public_share_token,
--            or a confirmed member of the reel's team.
--   insert — super admin, creator, or a confirmed team member.
--   update — super admin, creator, or a team coach.
--   delete — super admin, creator, or a team coach.
--
-- The only behavioral change vs. lockdown 13 is the creator branch on
-- INSERT (read/update/delete already had it). WITH CHECK on
-- insert/update accepts created_by_user_id = auth.uid() with a null
-- team_id — that's how creator-owned, team-less reels are written.
--
-- COLUMN NOTE: ownership column is created_by_user_id (NOT created_by).
--
-- Idempotent: the ALTER is a no-op if team_id is already nullable, and
-- each policy is DROP-IF-EXISTS then recreated. Safe to re-run.
--
-- Mirrors: migration_rls_lockdown_13_highlight_reels.sql (policy
--          names/style), migration_walls_reels_sharing.sql (table),
--          migration_rls_helpers.sql (is_super_admin()),
--          migration_rls_lockdown_2_tags.sql (is_team_member()),
--          migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- 1. team_id nullable — keep the FK, drop only the NOT NULL constraint.
ALTER TABLE highlight_reels ALTER COLUMN team_id DROP NOT NULL;

-- 2. RLS — every policy gains/keeps the creator-ownership branch.

-- READ — super admin, creator, shared (token present), or team member.
DROP POLICY IF EXISTS highlight_reels_read ON highlight_reels;
CREATE POLICY highlight_reels_read ON highlight_reels
  FOR SELECT
  USING (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR public_share_token IS NOT NULL
    OR is_team_member(team_id)
  );

-- INSERT — super admin, creator, or confirmed team member.
DROP POLICY IF EXISTS highlight_reels_insert ON highlight_reels;
CREATE POLICY highlight_reels_insert ON highlight_reels
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR is_team_member(team_id)
  );

-- UPDATE — super admin, creator, or team coach.
DROP POLICY IF EXISTS highlight_reels_update ON highlight_reels;
CREATE POLICY highlight_reels_update ON highlight_reels
  FOR UPDATE
  USING (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR is_team_coach(team_id)
  )
  WITH CHECK (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR is_team_coach(team_id)
  );

-- DELETE — super admin, creator, or team coach.
DROP POLICY IF EXISTS highlight_reels_delete ON highlight_reels;
CREATE POLICY highlight_reels_delete ON highlight_reels
  FOR DELETE
  USING (
    is_super_admin()
    OR created_by_user_id = auth.uid()
    OR is_team_coach(team_id)
  );

-- Schema cache trap — force PostgREST to reload
notify pgrst, 'reload schema';
