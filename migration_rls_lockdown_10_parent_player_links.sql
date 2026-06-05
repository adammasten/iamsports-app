-- ============================================================
-- RLS lockdown 10 of N — parent_player_links.
--
-- Access derives from the linked player's team (via players.team_id):
--   read   — super admin, the parent themselves, or a coach of the
--            linked player's team.
--   insert/delete — super admin or a coach of the player's team.
--   update — super admin, the parent themselves, or a team coach.
--
-- NAMING NOTE: the placeholder policy from migration_step1.sql is
-- named 'allow_all_parent_player' (NOT 'allow_all_parent_player_links'
-- — it's the one table that breaks the allow_all_<table> convention).
-- We DROP IF EXISTS both spellings so the real placeholder is removed
-- regardless; leaving it would keep a permissive FOR-ALL USING(true)
-- policy that, OR-combined with the policies below, would leave the
-- table effectively open.
--
-- Depends on: migration_step1.sql (parent_player_links, players),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

-- 1. Drop the allow_all placeholder (both possible spellings).
DROP POLICY IF EXISTS allow_all_parent_player_links ON parent_player_links;
DROP POLICY IF EXISTS allow_all_parent_player ON parent_player_links;

-- 2. READ — parent themselves, a coach of the player's team, or super admin.
CREATE POLICY parent_player_links_read ON parent_player_links
  FOR SELECT
  USING (
    is_super_admin()
    OR parent_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM players p
      WHERE p.id = parent_player_links.player_id
        AND is_team_coach(p.team_id)
    )
  );

-- 3. INSERT — super admin or a coach of the player's team.
CREATE POLICY parent_player_links_insert ON parent_player_links
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM players p
      WHERE p.id = parent_player_links.player_id
        AND is_team_coach(p.team_id)
    )
  );

-- 4. UPDATE — parent themselves, a coach of the player's team, or super admin.
CREATE POLICY parent_player_links_update ON parent_player_links
  FOR UPDATE
  USING (
    is_super_admin()
    OR parent_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM players p
      WHERE p.id = parent_player_links.player_id
        AND is_team_coach(p.team_id)
    )
  )
  WITH CHECK (
    is_super_admin()
    OR parent_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM players p
      WHERE p.id = parent_player_links.player_id
        AND is_team_coach(p.team_id)
    )
  );

-- 5. DELETE — super admin or a coach of the player's team.
CREATE POLICY parent_player_links_delete ON parent_player_links
  FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM players p
      WHERE p.id = parent_player_links.player_id
        AND is_team_coach(p.team_id)
    )
  );

-- 6. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
