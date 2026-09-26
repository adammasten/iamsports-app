-- ============================================================
-- test_d0_merge_players_closed.sql — proves the destructive merge_players is closed.
--
-- Builds the EXACT authority scenarios the old gate accepted, then shows each is refused:
--   1. ordinary authenticated user           (was already refused by the gate)
--   2. COACH of a team BOTH players are on   (was ACCEPTED -> the hole)
--   3. GUARDIAN of BOTH players              (was ACCEPTED -> also insufficient now)
--   4. anon
--   5. super admin                           (no granted path remains)
-- Plus: the function still EXISTS with its original signature, so a legacy Build 61
-- caller gets a clear error rather than "function not found"; and no data is destroyed.
--
-- SAFE: everything inside BEGIN ... ROLLBACK, synthetic fixtures only.
-- Run as a privileged connection (needs superuser for auth.users fixtures + SET ROLE).
-- ============================================================
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-000000000001','d0-coach@example.test'),
  ('d0000000-0000-0000-0000-000000000002','d0-guardian-of-both@example.test'),
  ('d0000000-0000-0000-0000-000000000003','d0-superadmin@example.test'),
  ('d0000000-0000-0000-0000-000000000004','d0-ordinary@example.test');

INSERT INTO public.super_admins (user_id) VALUES ('d0000000-0000-0000-0000-000000000003');

INSERT INTO public.teams (id, name, sport, created_by_user_id, join_code, join_code_expires_at)
VALUES ('d0000000-1111-0000-0000-000000000001','D0 Team','Basketball',
        'd0000000-0000-0000-0000-000000000001','D0TEAM01', now() + interval '30 days');

INSERT INTO public.team_memberships (team_id, user_id, role, status) VALUES
  ('d0000000-1111-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','coach'::membership_role,'confirmed'::membership_status);

-- FOUR INDEPENDENT PAIRS of different children -- one pair per authority case -- so a
-- merge that SUCCEEDS in one case cannot destroy the fixtures the next case needs.
-- (The first run of this suite against the unpatched function proved that matters: the
--  coach case destroyed child two, and every later case was then measured against a
--  half-deleted fixture and looked "refused" for the wrong reason.)
INSERT INTO public.players (id, name, team_id)
SELECT ('d0000000-2222-0000-0000-00000000000'||g)::uuid, 'D0 Child '||g,
       'd0000000-1111-0000-0000-000000000001'
  FROM generate_series(1,8) g;
INSERT INTO public.player_teams (player_id, team_id)
SELECT ('d0000000-2222-0000-0000-00000000000'||g)::uuid, 'd0000000-1111-0000-0000-000000000001'
  FROM generate_series(1,8) g;

-- guardian-of-both fixture applies to pair 3 (children 5 and 6)
INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship) VALUES
  ('d0000000-0000-0000-0000-000000000002','d0000000-2222-0000-0000-000000000005','parent'),
  ('d0000000-0000-0000-0000-000000000002','d0000000-2222-0000-0000-000000000006','parent');

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== SLICE D0 SUITE (synthetic, will ROLLBACK) ==='; END $$;

-- ============================================================
-- D0-T1..T4 — every role the old gate accepted is now refused.
-- Distinguishes 42501 (no EXECUTE privilege) from 0A000 (body refuses).
-- ============================================================
-- NOTE ON METHOD (changed after a local-stack crash, 2026-09-26):
-- This block originally PROVED the revoke by having each actor actually CALL
-- merge_players and asserting SQLSTATE 42501. That is impossible on the local Supabase
-- stack: `supautils` (session_preload_libraries) decorates permission-denied errors with a
-- "GRANT the required privileges..." HINT, and its FUNCTION-privilege hint path segfaults
-- the backend (signal 11). Reproduced with a brand-new, unrelated security-definer function
-- that `authenticated` lacks EXECUTE on, so it is not caused by anything in Slice D0;
-- table-privilege denials are unaffected, which is why every other suite still runs.
--
-- The privilege is therefore asserted DIRECTLY via has_function_privilege() and the ACL,
-- which is stronger evidence than a caught exception (it reads the grant itself rather than
-- inferring it from an error code) and does not depend on the crashing code path.
-- Defence-in-depth layer 2 -- the body refusing even for a role that CAN execute -- is
-- proven separately by D0-T5 below.
DO $$
DECLARE
  r record; v_qualified text; v_can boolean; v_acl text;
BEGIN
  SELECT coalesce(array_to_string(proacl,' | '),'(default: EXECUTE to PUBLIC)') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='merge_players';
  RAISE NOTICE 'D0-T0 merge_players ACL: %', v_acl;

  FOR r IN SELECT * FROM (VALUES
      ('ordinary authenticated',      'd0000000-0000-0000-0000-000000000004'::uuid, 1, 2, 'authenticated'),
      ('COACH of a team BOTH are on', 'd0000000-0000-0000-0000-000000000001'::uuid, 3, 4, 'authenticated'),
      ('GUARDIAN of BOTH players',    'd0000000-0000-0000-0000-000000000002'::uuid, 5, 6, 'authenticated'),
      ('SUPER ADMIN',                 'd0000000-0000-0000-0000-000000000003'::uuid, 7, 8, 'authenticated'),
      ('anon (unauthenticated)',      NULL::uuid,                                   1, 2, 'anon'),
      ('PUBLIC pseudo-role',          NULL::uuid,                                   1, 2, 'public')) AS t(who, uid, a, b, grantee)
  LOOP
    DECLARE
      c_keep uuid := ('d0000000-2222-0000-0000-00000000000'||r.a)::uuid;
      c_dup  uuid := ('d0000000-2222-0000-0000-00000000000'||r.b)::uuid;
    BEGIN
      -- Would the OLD gate have accepted this actor, on INTACT fixtures?
      IF r.uid IS NULL THEN
        v_qualified := 'n/a';
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object('sub', r.uid::text,'role','authenticated')::text, true);
        IF auth.uid() IS DISTINCT FROM r.uid THEN RAISE EXCEPTION 'CONTROL FAILED: impersonation not in effect'; END IF;
        IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'CONTROL FAILED: current_user=%', current_user; END IF;
        SELECT CASE
          WHEN public.is_super_admin() THEN 'yes (super admin)'
          WHEN public.is_linked_parent(c_keep) AND public.is_linked_parent(c_dup) THEN 'yes (guardian of both)'
          WHEN EXISTS (SELECT 1 FROM public.player_teams a2 JOIN public.player_teams b2 ON b2.team_id=a2.team_id
                       WHERE a2.player_id=c_keep AND b2.player_id=c_dup AND public.is_team_coach(a2.team_id))
               THEN 'yes (coach of both)'
          ELSE 'no' END INTO v_qualified;
      END IF;

      v_can := has_function_privilege(r.grantee, 'public.merge_players(uuid,uuid)', 'EXECUTE');

      RAISE NOTICE 'D0 % | old gate: % | can EXECUTE now: % -> %',
        rpad(r.who, 28), rpad(v_qualified, 23), rpad(v_can::text, 5),
        CASE WHEN v_can THEN 'FAIL still invocable' ELSE 'PASS no EXECUTE privilege' END;
    END;
  END LOOP;
END $$;

-- ============================================================
-- D0-T5 — signature preserved: a legacy Build 61 caller gets a clear error,
-- not "function not found" (42883).
-- ============================================================
RESET ROLE;
DO $$
DECLARE v_sig text; v_state text;
BEGIN
  SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||') -> '||pg_get_function_result(p.oid)
    INTO v_sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='merge_players';
  RAISE NOTICE 'D0-T5 signature still present: %', coalesce(v_sig,'MISSING — legacy callers would get 42883');

  BEGIN
    PERFORM public.merge_players('d0000000-2222-0000-0000-000000000001','d0000000-2222-0000-0000-000000000002');
    v_state := 'EXECUTED';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  RAISE NOTICE 'D0-T5 even as postgres the body refuses -> % (%)', v_state,
    CASE WHEN v_state='0A000' THEN 'PASS destructive SQL no longer exists' ELSE 'REVIEW' END;
END $$;

-- ============================================================
-- D0-T6 — nothing was destroyed. Both children and all their content intact.
-- ============================================================
DO $$
DECLARE v_players int; v_spells int; v_links int;
BEGIN
  SELECT count(*) INTO v_players FROM public.players WHERE id::text LIKE 'd0000000-2222-%';
  SELECT count(*) INTO v_spells  FROM public.player_teams WHERE player_id::text LIKE 'd0000000-2222-%';
  SELECT count(*) INTO v_links   FROM public.parent_player_links WHERE player_id::text LIKE 'd0000000-2222-%';
  RAISE NOTICE 'D0-T6 after all attempts: players=%/8 spells=%/8 guardian_links=%/2 -> %',
    v_players, v_spells, v_links,
    CASE WHEN v_players=8 AND v_spells=8 AND v_links=2 THEN 'PASS nothing destroyed' ELSE 'FAIL DATA LOST' END;
END $$;

-- ============================================================
-- D0-T7 — C.5 controls untouched by D0.
-- ============================================================
DO $$
DECLARE v_coach_code_revoked boolean; v_ppl_clean boolean; v_csprng boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='teams' AND column_name='coach_code'
      AND grantee='authenticated' AND privilege_type='SELECT') INTO v_coach_code_revoked;
  SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='parent_player_links' AND cmd IN ('INSERT','UPDATE','DELETE')
    AND coalesce(qual,with_check) ILIKE '%is_team_coach%') INTO v_ppl_clean;
  SELECT prosrc ILIKE '%gen_random_bytes%' INTO v_csprng FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='gen_join_code';
  RAISE NOTICE 'D0-T7 C.5 intact: coach_code revoked=%, ppl coach-mutation gone=%, CSPRNG codes=% -> %',
    v_coach_code_revoked, v_ppl_clean, v_csprng,
    CASE WHEN v_coach_code_revoked AND v_ppl_clean AND v_csprng THEN 'PASS' ELSE 'FAIL' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
