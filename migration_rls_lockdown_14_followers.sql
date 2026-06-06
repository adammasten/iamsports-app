-- ============================================================
-- RLS lockdown 14 of N — followers.
--
-- RECONCILIATION: mirrors the policies applied live in the Supabase
-- SQL editor. followers is scoped either to a team (scope='team',
-- team_id set) or to a player (scope='player', player_id set);
-- the gatekeepers differ by scope.
--
--   read   — super admin; the follower themselves; for team-scope, a
--            coach of that team; for player-scope, a coach of the
--            player's team OR a parent linked to that player.
--   insert — super admin or the follower themselves (self-request).
--   update — super admin; for team-scope a team coach; for
--            player-scope a coach of the player's team OR a linked
--            parent (i.e. the approvers).
--   delete — super admin; the follower themselves (unfollow); plus
--            the same coach/linked-parent approvers as update.
--
-- Player-scope "linked parent" = a parent_player_links row matching
-- the followed player with parent_user_id = auth.uid().
--
-- Depends on: migration_walls_reels_sharing.sql (followers),
--             migration_step1.sql (players, parent_player_links),
--             migration_rls_helpers.sql (is_super_admin()),
--             migration_rls_lockdown_3_clips.sql (is_team_coach()).
-- ============================================================

DROP POLICY IF EXISTS allow_all_followers ON followers;

-- READ — follower self, team-scope coach, player-scope coach, or
-- player-scope linked parent.
CREATE POLICY followers_read ON followers
  FOR SELECT
  USING (
    is_super_admin()
    OR follower_user_id = auth.uid()
    OR (scope = 'team' AND is_team_coach(team_id))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM players p
          WHERE p.id = followers.player_id
            AND is_team_coach(p.team_id)
       ))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = followers.player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  );

-- INSERT — the follower requesting to follow (self), or super admin.
CREATE POLICY followers_insert ON followers
  FOR INSERT
  WITH CHECK (is_super_admin() OR follower_user_id = auth.uid());

-- UPDATE — approvers: team-scope coach, player-scope coach, or linked parent.
CREATE POLICY followers_update ON followers
  FOR UPDATE
  USING (
    is_super_admin()
    OR (scope = 'team' AND is_team_coach(team_id))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM players p
          WHERE p.id = followers.player_id
            AND is_team_coach(p.team_id)
       ))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = followers.player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  )
  WITH CHECK (
    is_super_admin()
    OR (scope = 'team' AND is_team_coach(team_id))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM players p
          WHERE p.id = followers.player_id
            AND is_team_coach(p.team_id)
       ))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = followers.player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  );

-- DELETE — the follower (unfollow), plus the same approvers as update.
CREATE POLICY followers_delete ON followers
  FOR DELETE
  USING (
    is_super_admin()
    OR follower_user_id = auth.uid()
    OR (scope = 'team' AND is_team_coach(team_id))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM players p
          WHERE p.id = followers.player_id
            AND is_team_coach(p.team_id)
       ))
    OR (scope = 'player' AND EXISTS (
          SELECT 1 FROM parent_player_links ppl
          WHERE ppl.player_id = followers.player_id
            AND ppl.parent_user_id = auth.uid()
       ))
  );

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
