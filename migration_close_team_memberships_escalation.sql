-- ============================================================
-- CLOSE team_memberships PRIVILEGE-ESCALATION (security fix).
--
-- Applied to live via Supabase apply_migration (name:
-- close_team_memberships_escalation). This repo file mirrors the EXACT SQL that
-- was applied, so live and repo stay in sync — no wrapping transaction or
-- `notify pgrst` was applied, so none is added here.
--
-- Two escalation doors on public.team_memberships were closed:
--
--   1. allow_all_memberships — an ALL policy with `USING true` / `WITH CHECK
--      true`. Because RLS PERMISSIVE policies OR together, it granted
--      unconditional SELECT/INSERT/UPDATE/DELETE to any caller, making the
--      scoped tm_* policies redundant. Dropped.
--
--   2. tm_update carried `(user_id = auth.uid())` in BOTH its USING and its
--      WITH CHECK. Since the check only constrained user_id (never `role`), a
--      confirmed member could UPDATE their OWN row and set role='admin'/'coach'
--      — self-promoting to coach-level authority, which cascades through
--      is_team_coach()/is_team_member() into nearly every write policy in the
--      schema. Recreated WITHOUT the self-service branch: only a super admin or
--      an existing team coach/admin may UPDATE a membership row.
--
-- Unchanged (intentionally): tm_read (read own + teammates), tm_insert (team
-- creator adds their own admin row), tm_delete (a user may leave a team via
-- `user_id = auth.uid()`). Only UPDATE was tightened.
--
-- FOLLOW-UP NOTE: with allow_all gone, any future "accept invite" flow that
-- flips a pending row to 'confirmed' on the member's own behalf can no longer do
-- so via a plain client UPDATE (tm_update is now coach/admin-only) — it will
-- need a SECURITY DEFINER RPC or a coach action.
-- ============================================================

DROP POLICY IF EXISTS allow_all_memberships ON public.team_memberships;

DROP POLICY IF EXISTS tm_update ON public.team_memberships;
CREATE POLICY tm_update ON public.team_memberships
  FOR UPDATE
  USING (is_super_admin() OR is_team_coach(team_id))
  WITH CHECK (is_super_admin() OR is_team_coach(team_id));
