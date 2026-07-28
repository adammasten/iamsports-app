-- ============================================================
-- test_rls_escalation.sql — RLS privilege-escalation regression test for
-- public.team_memberships.
--
-- WHAT THIS IS FOR
--   Proves that a non-privileged authenticated user cannot escalate their own
--   team role via the team_memberships RLS policies. It exercises the exact
--   attack that migration_close_team_memberships_escalation.sql closed
--   (a 'player' self-promoting to 'admin'), plus two related cases.
--
-- SAFE TO RUN AGAINST LIVE
--   Everything runs inside a single BEGIN ... ROLLBACK. All fixtures are
--   SYNTHETIC (hardcoded UUIDs, incl. throwaway auth.users rows created here and
--   rolled back). Nothing is committed; production data is untouched. It reads
--   nothing about, and depends on nothing about, any real account.
--
-- HOW TO RUN
--   Run the whole file as a PRIVILEGED connection (Supabase SQL editor or the
--   Supabase MCP — both connect as 'postgres'). It needs superuser to (a) insert
--   synthetic auth.users rows for the FK and (b) SET ROLE authenticated to force
--   RLS to apply. Output is emitted via RAISE NOTICE (see the Messages/Notices
--   pane). Nothing is returned as a result set.
--
-- RE-RUN THIS after ANY change to:
--   * team_memberships RLS policies (tm_read / tm_insert / tm_update / tm_delete
--     or an allow_all-style policy), OR
--   * the helper functions is_team_member() / is_team_coach() / is_super_admin().
--
-- THE CONTROL ASSERTION IS THE MOST IMPORTANT PART
--   Before every attack, the file asserts that impersonation actually took
--   effect (auth.uid() == injected sub AND current_user == 'authenticated'). If
--   either is false it RAISEs and aborts. A test that silently runs as a
--   privileged (RLS-bypassing) role would report a FALSE PASS — worse than no
--   test. Do not weaken these assertions.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Fixtures (created as the privileged connection role; RLS bypassed here).
-- Synthetic UUIDs:
--   owner    aaaaaaaa-…  creates the team
--   player   bbbbbbbb-…  confirmed 'player'  → case A actor
--   coach    cccccccc-…  confirmed 'coach'   → case C actor
--   stranger dddddddd-…  NO membership       → case B actor
--   team     eeeeeeee-…
-- ------------------------------------------------------------

-- Synthetic auth.users (rolled back). Verified against the live schema: the ONLY
-- NOT NULL column on auth.users without a default is `id` (email is nullable), so
-- (id, email) is a complete, valid insert here.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rls-test-owner@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rls-test-player@example.test'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'rls-test-coach@example.test'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'rls-test-stranger@example.test');

-- Synthetic team (mirrors the app's teams insert: name, sport, created_by_user_id).
INSERT INTO public.teams (id, name, sport, created_by_user_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'RLS Test Team', 'Basketball',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Confirmed memberships: a player and a coach on the team. Stranger gets none.
INSERT INTO public.team_memberships (team_id, user_id, role, status) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','player'::membership_role,'confirmed'::membership_status),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cccccccc-cccc-cccc-cccc-cccccccccccc','coach'::membership_role, 'confirmed'::membership_status);

-- Drop out of superuser for the rest of the transaction, so RLS is enforced on
-- every statement below. Each case then injects a JWT 'sub' to pick WHICH user.
SET LOCAL ROLE authenticated;

DO $$ BEGIN
  RAISE NOTICE '=== RLS escalation regression test (team_memberships) — synthetic fixtures, will ROLLBACK ===';
END $$;

-- ============================================================
-- CASE A — SELF-PROMOTE: a confirmed 'player' UPDATEs their own row to 'admin'.
-- EXPECT: 0 rows affected, role unchanged (blocked by tm_update USING).
-- ============================================================
DO $$
DECLARE
  c_case  text := 'A';
  c_team  uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  c_actor uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';   -- the player
  v_rows  int;
  v_after text;
  v_pass  boolean;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_actor::text, 'role', 'authenticated')::text, true);

  -- ===== CONTROL ASSERTION (do NOT weaken) =====
  IF auth.uid() IS DISTINCT FROM c_actor THEN
    RAISE EXCEPTION 'CONTROL FAILED [case %]: auth.uid()=% but expected %. Impersonation is NOT in effect — aborting to avoid a false pass.', c_case, auth.uid(), c_actor;
  END IF;
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'CONTROL FAILED [case %]: current_user=% but expected authenticated — running as a privileged, RLS-bypassing role; aborting to avoid a false pass.', c_case, current_user;
  END IF;
  RAISE NOTICE '[control %] auth.uid()=%  current_user=%  -> OK', c_case, auth.uid(), current_user;

  -- ===== ATTACK =====
  UPDATE public.team_memberships SET role = 'admin'
   WHERE user_id = auth.uid() AND team_id = c_team;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  SELECT role::text INTO v_after
    FROM public.team_memberships WHERE user_id = c_actor AND team_id = c_team;

  v_pass := (v_rows = 0 AND v_after = 'player');
  RAISE NOTICE '[A] SELF-PROMOTE player->admin | attempted UPDATE own row | rows_affected=% role_after=% | expected rows_affected=0, role_after=player | %',
    v_rows, v_after, CASE WHEN v_pass THEN 'PASS — escalation blocked' ELSE 'FAIL — ESCALATION POSSIBLE' END;
END $$;

-- ============================================================
-- CASE B — STRANGER INSERT: an authenticated user with NO membership on the team
-- INSERTs a row for themselves with role='head_coach'.
-- EXPECT: denied (tm_insert WITH CHECK fails -> SQLSTATE 42501).
-- ============================================================
DO $$
DECLARE
  c_case    text := 'B';
  c_team    uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  c_actor   uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';  -- stranger, no membership
  v_outcome text;   -- 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  v_detail  text := '';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_actor::text, 'role', 'authenticated')::text, true);

  -- ===== CONTROL ASSERTION (do NOT weaken) =====
  IF auth.uid() IS DISTINCT FROM c_actor THEN
    RAISE EXCEPTION 'CONTROL FAILED [case %]: auth.uid()=% but expected %. Impersonation is NOT in effect — aborting to avoid a false pass.', c_case, auth.uid(), c_actor;
  END IF;
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'CONTROL FAILED [case %]: current_user=% but expected authenticated — running as a privileged, RLS-bypassing role; aborting to avoid a false pass.', c_case, current_user;
  END IF;
  RAISE NOTICE '[control %] auth.uid()=%  current_user=%  -> OK', c_case, auth.uid(), current_user;

  -- ===== ATTACK ===== (sub-block so the expected denial is caught, not fatal)
  -- THREE DISTINCT OUTCOMES. Only SQLSTATE 42501 (insufficient_privilege) proves
  -- RLS denied the insert. Any OTHER error (wrong column, FK/enum/unique
  -- violation, bad UUID, …) proves NOTHING about the policy and must NOT be
  -- scored as a pass — it is INCONCLUSIVE. This mirrors the rigor of the control
  -- assertion above: an error for the wrong reason is a false pass.
  BEGIN
    INSERT INTO public.team_memberships (team_id, user_id, role, status)
    VALUES (c_team, auth.uid(), 'head_coach'::membership_role, 'confirmed'::membership_status);
    -- Reached only if the INSERT succeeded → RLS did NOT deny it.
    v_outcome := 'FAIL';
    v_detail  := 'INSERT was ALLOWED (no error) — RLS did not deny it';
  EXCEPTION
    WHEN insufficient_privilege THEN               -- SQLSTATE 42501
      v_outcome := 'PASS';
      v_detail  := 'RLS WITH CHECK denied the insert (SQLSTATE 42501)';
    WHEN others THEN
      v_outcome := 'INCONCLUSIVE';
      v_detail  := format('INSERT errored with SQLSTATE %s: %s — this is NOT proof of RLS denial. The test proved NOTHING about the policy and must be fixed before this case can be trusted.', SQLSTATE, SQLERRM);
  END;

  RAISE NOTICE '[B] STRANGER INSERT head_coach (no membership) | outcome=% | % | scoring: 42501 -> PASS (RLS denied), insert-allowed -> FAIL, any other error -> INCONCLUSIVE',
    v_outcome, v_detail;
END $$;

-- ============================================================
-- CASE C — COACH SELF-PROMOTE: a confirmed 'coach' UPDATEs their own row to
-- 'admin'. This currently SUCCEEDS: tm_update permits any team coach/admin to
-- modify membership rows on their team. Reported honestly as a KNOWN, ACCEPTED
-- gap so this file documents reality rather than asserting something untrue.
-- ============================================================
DO $$
DECLARE
  c_case  text := 'C';
  c_team  uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  c_actor uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';   -- the coach
  v_rows  int;
  v_after text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_actor::text, 'role', 'authenticated')::text, true);

  -- ===== CONTROL ASSERTION (do NOT weaken) =====
  IF auth.uid() IS DISTINCT FROM c_actor THEN
    RAISE EXCEPTION 'CONTROL FAILED [case %]: auth.uid()=% but expected %. Impersonation is NOT in effect — aborting to avoid a false pass.', c_case, auth.uid(), c_actor;
  END IF;
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'CONTROL FAILED [case %]: current_user=% but expected authenticated — running as a privileged, RLS-bypassing role; aborting to avoid a false pass.', c_case, current_user;
  END IF;
  RAISE NOTICE '[control %] auth.uid()=%  current_user=%  -> OK', c_case, auth.uid(), current_user;

  -- ===== ATTACK =====
  UPDATE public.team_memberships SET role = 'admin'
   WHERE user_id = auth.uid() AND team_id = c_team;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  SELECT role::text INTO v_after
    FROM public.team_memberships WHERE user_id = c_actor AND team_id = c_team AND role = 'admin';

  IF v_rows > 0 THEN
    RAISE NOTICE '[C] COACH SELF-PROMOTE coach->admin | rows_affected=% role_after=% | SUCCEEDED — KNOWN, ACCEPTED GAP: tm_update lets any confirmed team coach/admin modify membership rows (incl. self-promote). Documented as current reality, NOT a test failure.',
      v_rows, v_after;
  ELSE
    RAISE NOTICE '[C] COACH SELF-PROMOTE coach->admin | rows_affected=0 | NOTE: the coach self-promote was BLOCKED. The previously-accepted gap appears to be CLOSED — the policy changed; update this file''s expectation for case C.';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE '=== done — rolling back; nothing persisted ===';
END $$;

ROLLBACK;
