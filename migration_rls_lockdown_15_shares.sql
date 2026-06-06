-- ============================================================
-- RLS lockdown 15 of N — shares.
--
-- RECONCILIATION: mirrors the policies applied live in the Supabase
-- SQL editor. shares is polymorphic (content_type + content_id) with
-- an audience that determines who can read:
--   read   — super admin; the sharer; public+visible shares to anyone;
--            team shares to team members; coaches shares to coaches;
--            player shares to a parent linked to the target player.
--   insert — a team coach, or a team member sharing as themselves.
--   update — the sharer, a team coach, or (for player-audience shares)
--            a linked parent (family controls over player shares).
--   delete — the sharer or a team coach.
--
-- Depends on: migration_walls_reels_sharing.sql (shares),
--             migration_step1.sql (parent_player_links),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_2_tags.sql (is_team_member()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

DROP POLICY IF EXISTS allow_all_shares ON shares;

-- READ — audience-aware.
CREATE POLICY shares_read ON shares
  FOR SELECT
  USING (
    is_super_admin()
    OR shared_by_user_id = auth.uid()
    OR (audience = 'public'  AND visible = true)
    OR (audience = 'team'    AND is_team_member(team_id))
    OR (audience = 'coaches' AND is_team_coach(team_id))
    OR (audience = 'player'  AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = shares.target_player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  );

-- INSERT — a team coach, or a team member sharing as themselves.
CREATE POLICY shares_insert ON shares
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR is_team_coach(team_id)
    OR (shared_by_user_id = auth.uid() AND is_team_member(team_id))
  );

-- UPDATE — sharer, team coach, or linked parent (player audience).
CREATE POLICY shares_update ON shares
  FOR UPDATE
  USING (
    is_super_admin()
    OR shared_by_user_id = auth.uid()
    OR is_team_coach(team_id)
    OR (audience = 'player' AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = shares.target_player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  )
  WITH CHECK (
    is_super_admin()
    OR shared_by_user_id = auth.uid()
    OR is_team_coach(team_id)
    OR (audience = 'player' AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = shares.target_player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  );

-- DELETE — sharer or team coach.
CREATE POLICY shares_delete ON shares
  FOR DELETE
  USING (
    is_super_admin()
    OR shared_by_user_id = auth.uid()
    OR is_team_coach(team_id)
  );

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
