-- ============================================================
-- 20260928200000_highlight_reels_team_id_write_authorization.sql
--
-- Closes two WRITE-authorization gaps on public.highlight_reels. Touches ONLY the
-- two write policies. SELECT and DELETE policies, the schema, and may_reel_clip()
-- are deliberately untouched.
--
-- GAP 1 — team_id was never validated.
--   The old WITH CHECK read:
--     (is_super_admin() OR created_by_user_id = auth.uid() OR is_team_member(team_id))
--   Because that is an OR, `created_by_user_id = auth.uid()` is true for every reel
--   a user creates, so the is_team_member(team_id) branch was NEVER REACHED and
--   team_id was effectively free text. A user could attach a reel to ANY team, or
--   mutate team_id afterwards. highlight_reels_read grants SELECT on
--   is_team_coach(team_id), so a planted team_id injected an attacker-named row
--   into that team's coaches' reel lists.
--
-- GAP 2 — created_by_user_id could be spoofed on INSERT.
--   The same OR meant is_team_member(team_id) alone satisfied the actor gate, so a
--   confirmed member of ANY team could insert a reel attributed to another user.
--   That row would then land in the other user's My Work (which reads
--   created_by_user_id = auth.uid()).
--
-- NEITHER GAP LEAKED MEDIA. The clip-content gate (may_reel_clip over
-- source_clip_ids) held throughout and is preserved verbatim below; a foreign clip
-- was and remains refused. These were metadata/association gaps.
--
-- THE INVARIANT, derived from product code (NOT invented):
--   app/export.tsx:141-145 and app/edit-reel.tsx:45-49 both build the reel's team
--   dropdown from userTeams (CONFIRMED memberships, ANY role) plus "None"; and
--   app/make-highlight.tsx:248 (the parent flow) passes no teamId at all.
--   Therefore:  team_id IS NULL  OR  actor is a confirmed member of team_id.
--   It is NOT coach-only (the dropdown offers every membership role), and it is
--   NOT "must match every source clip's team" — 3 live reels legitimately span
--   multiple clip teams.
--
-- WHY is_team_member AND NOT is_team_coach: tightening to coach would break the
-- product's own dropdown, which offers parent/player/follower memberships too.
--
-- SCOPE NOTE — created_by_user_id remains MUTABLE ON UPDATE via the
-- is_team_coach(team_id) branch, which keeps WITH CHECK satisfied whatever the new
-- creator value is. Closing that would require removing a coach's existing ability
-- to update authorized reels (explicitly out of scope), and an RLS policy cannot
-- compare OLD to NEW. Left as-is and reported; a BEFORE UPDATE trigger is the
-- correct tool if it is ever prioritised.
--
-- BACKWARD COMPATIBILITY: verified before applying — all 16 live team-attached
-- reels have a creator who is a confirmed, non-departed member of the reel's team,
-- so 0 existing rows fail the new WITH CHECK. The 9 null-team reels pass trivially.
-- Regression coverage: test_highlight_reels_team_id_authorization.sql
-- ============================================================

-- INSERT: actor must be themselves (or super-admin); team_id must be null or a
-- team they are a confirmed member of; clip authorization unchanged.
ALTER POLICY highlight_reels_insert ON public.highlight_reels
  WITH CHECK (
    (is_super_admin() OR created_by_user_id = (SELECT auth.uid()))
    AND (team_id IS NULL OR is_super_admin() OR is_team_member(team_id))
    AND (
      source_clip_ids IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(highlight_reels.source_clip_ids) cid(cid)
        WHERE NOT may_reel_clip(cid.cid)
      )
    )
  );

-- UPDATE: actor gate preserved EXACTLY as it was (creator OR coach of the reel's
-- team OR super-admin) so coaches keep their existing ability to manage authorized
-- reels. Only the team_id destination check is added. USING is not modified, so a
-- coach can still reach and correct a mis-attached reel.
ALTER POLICY highlight_reels_update ON public.highlight_reels
  WITH CHECK (
    (is_super_admin() OR created_by_user_id = (SELECT auth.uid()) OR is_team_coach(team_id))
    AND (team_id IS NULL OR is_super_admin() OR is_team_member(team_id))
    AND (
      source_clip_ids IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(highlight_reels.source_clip_ids) cid(cid)
        WHERE NOT may_reel_clip(cid.cid)
      )
    )
  );
