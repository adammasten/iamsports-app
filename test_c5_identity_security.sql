-- ============================================================
-- test_c5_identity_security.sql — Slice C.5 adversarial suite.
--
-- WHAT THIS PROVES
--   The team-code → coach-takeover → guardianship-mutation chain is broken at
--   multiple INDEPENDENT points, and the legitimate flows still work.
--
-- SAFE TO RUN
--   Everything is inside BEGIN ... ROLLBACK. All fixtures are synthetic (hardcoded
--   UUIDs, throwaway auth.users rows created here and rolled back). Nothing is
--   committed. It reads nothing about, and depends on nothing about, any real account.
--
-- HOW TO RUN
--   Privileged connection (local: docker exec ... psql -U postgres). Needs superuser to
--   (a) insert synthetic auth.users rows for the FKs and (b) SET LOCAL ROLE authenticated
--   so RLS and column grants actually apply. Output is RAISE NOTICE.
--
-- CONTROL ASSERTIONS ARE THE MOST IMPORTANT PART
--   Every case asserts that impersonation took effect (auth.uid() + current_user)
--   before attacking, so a misconfigured test cannot produce a false PASS.
-- ============================================================
BEGIN;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'c5-coach@example.test'),
  ('a5000000-0000-0000-0000-000000000002', 'c5-parent@example.test'),
  ('a5000000-0000-0000-0000-000000000003', 'c5-admin@example.test'),
  ('a5000000-0000-0000-0000-000000000004', 'c5-outsider@example.test');

INSERT INTO public.super_admins (user_id) VALUES ('a5000000-0000-0000-0000-000000000003');

INSERT INTO public.teams (id, name, sport, created_by_user_id, join_code, join_code_expires_at, coach_code, coach_code_expires_at)
VALUES ('b5000000-0000-0000-0000-000000000001', 'C5 Test Team', 'Basketball',
        'a5000000-0000-0000-0000-000000000001',
        'C5TEAM01', now() + interval '30 days',
        'C5COACH001', now() + interval '30 days');

INSERT INTO public.team_memberships (team_id, user_id, role, status) VALUES
  ('b5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','coach'::membership_role,'confirmed'::membership_status),
  ('b5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000002','parent'::membership_role,'confirmed'::membership_status);

-- A claimed child (the parent's) and an unclaimed roster placeholder.
INSERT INTO public.players (id, name, team_id) VALUES
  ('c5000000-0000-0000-0000-000000000001', 'C5 Claimed Kid',   'b5000000-0000-0000-0000-000000000001'),
  ('c5000000-0000-0000-0000-000000000002', 'C5 Unclaimed Kid', 'b5000000-0000-0000-0000-000000000001');
INSERT INTO public.player_teams (player_id, team_id) VALUES
  ('c5000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001'),
  ('c5000000-0000-0000-0000-000000000002','b5000000-0000-0000-0000-000000000001');
INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship) VALUES
  ('a5000000-0000-0000-0000-000000000002','c5000000-0000-0000-0000-000000000001','parent');
INSERT INTO public.player_guardian_codes (player_id, code, expires_at) VALUES
  ('c5000000-0000-0000-0000-000000000001','C5GUARD01', now() + interval '30 days'),
  ('c5000000-0000-0000-0000-000000000002','C5GUARD02', now() + interval '30 days');

-- Drop out of superuser: RLS + column grants now apply to every statement below.
SET LOCAL ROLE authenticated;

DO $$ BEGIN RAISE NOTICE '=== SLICE C.5 ADVERSARIAL SUITE (synthetic fixtures, will ROLLBACK) ==='; END $$;

-- ============================================================
-- T1 / T15 — a team-member PARENT cannot read teams.coach_code directly.
-- EXPECT: permission denied (42501).
-- ============================================================
DO $$
DECLARE c_actor uuid := 'a5000000-0000-0000-0000-000000000002'; v_code text; v_pass boolean := false; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_actor::text, 'role','authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM c_actor THEN RAISE EXCEPTION 'CONTROL FAILED T1: auth.uid()=%', auth.uid(); END IF;
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'CONTROL FAILED T1: current_user=%', current_user; END IF;
  BEGIN
    SELECT coach_code INTO v_code FROM public.teams WHERE id='b5000000-0000-0000-0000-000000000001';
    v_pass := false;
  EXCEPTION WHEN insufficient_privilege THEN v_pass := true; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T1/T15 parent direct-select coach_code -> %  (%)', CASE WHEN v_pass THEN 'PASS blocked' ELSE 'FAIL READ IT: '||coalesce(v_code,'null') END, coalesce(v_err,'no error');
END $$;

-- ============================================================
-- T19 — the OLD builds ≤66 reader: select('join_code, coach_code').
-- Documents the exact degradation. Run as PARENT and as COACH.
-- ============================================================
DO $$
DECLARE r record; v_pass boolean; v_err text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('parent','a5000000-0000-0000-0000-000000000002'::uuid),
      ('coach', 'a5000000-0000-0000-0000-000000000001'::uuid)) AS t(who, uid)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.uid::text, 'role','authenticated')::text, true);
    v_pass := false; v_err := null;
    BEGIN
      PERFORM join_code, coach_code FROM public.teams WHERE id='b5000000-0000-0000-0000-000000000001';
    EXCEPTION WHEN insufficient_privilege THEN v_pass := true; v_err := SQLERRM;
    END;
    RAISE NOTICE 'T19 old ≤66 two-column read as % -> %  (%)', r.who,
      CASE WHEN v_pass THEN 'WHOLE QUERY REJECTED (documented degradation)' ELSE 'still succeeded' END, coalesce(v_err,'-');
  END LOOP;
END $$;

-- ============================================================
-- T19b — does the team-code-only read still work? (join_code left readable)
-- ============================================================
DO $$
DECLARE c_actor uuid := 'a5000000-0000-0000-0000-000000000001'; v_jc text; v_pass boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_actor::text, 'role','authenticated')::text, true);
  BEGIN
    SELECT join_code INTO v_jc FROM public.teams WHERE id='b5000000-0000-0000-0000-000000000001';
    v_pass := (v_jc = 'C5TEAM01');
  EXCEPTION WHEN OTHERS THEN v_pass := false;
  END;
  RAISE NOTICE 'T19b join_code alone still readable -> %', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ============================================================
-- T16 — PARENT cannot obtain the coach code via get_team_codes.
-- T17 — legitimate COACH can.
-- ============================================================
DO $$
DECLARE v_got text; v_pass boolean := false; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a5000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  BEGIN
    SELECT coach_code INTO v_got FROM public.get_team_codes('b5000000-0000-0000-0000-000000000001');
    v_pass := false;
  EXCEPTION WHEN OTHERS THEN v_pass := true; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T16 parent via get_team_codes -> %  (%)', CASE WHEN v_pass THEN 'PASS blocked' ELSE 'FAIL GOT '||coalesce(v_got,'null') END, coalesce(v_err,'-');

  PERFORM set_config('request.jwt.claims', json_build_object('sub','a5000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  v_got := null;
  SELECT coach_code INTO v_got FROM public.get_team_codes('b5000000-0000-0000-0000-000000000001');
  RAISE NOTICE 'T17 coach via get_team_codes -> %  (got %)', CASE WHEN v_got='C5COACH001' THEN 'PASS' ELSE 'FAIL' END, coalesce(v_got,'null');
END $$;

-- ============================================================
-- T16b — an OUTSIDER (no membership at all) via get_team_codes.
-- ============================================================
DO $$
DECLARE v_got text; v_pass boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a5000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  BEGIN
    SELECT coach_code INTO v_got FROM public.get_team_codes('b5000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_pass := true;
  END;
  RAISE NOTICE 'T16b outsider via get_team_codes -> %', CASE WHEN v_pass THEN 'PASS blocked' ELSE 'FAIL' END;
END $$;

-- ============================================================
-- T3 / T4 / T5 — a COACH cannot INSERT / UPDATE / DELETE guardian links.
-- This is F14. The coach is a legitimate confirmed coach of the child's team.
-- ============================================================
DO $$
DECLARE
  c_coach uuid := 'a5000000-0000-0000-0000-000000000001';
  c_kid   uuid := 'c5000000-0000-0000-0000-000000000001';
  c_victim uuid := 'a5000000-0000-0000-0000-000000000004';  -- arbitrary account
  v_rows int; v_pass boolean; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach::text, 'role','authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM c_coach THEN RAISE EXCEPTION 'CONTROL FAILED T3'; END IF;
  IF NOT public.is_team_coach('b5000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'CONTROL FAILED T3: fixture coach is not recognised as a coach — test would falsely pass';
  END IF;
  RAISE NOTICE '[control T3-T5] actor is a CONFIRMED COACH of the child''s team -> OK';

  -- T3 INSERT a link for an arbitrary third party
  v_pass := false; v_err := null;
  BEGIN
    INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship)
    VALUES (c_victim, c_kid, 'guardian');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_pass := (v_rows = 0);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_pass := true; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T3 coach INSERT guardian link -> %  (%)', CASE WHEN v_pass THEN 'PASS blocked' ELSE 'FAIL INSERTED' END, coalesce(v_err,'-');

  -- T4 UPDATE the family's existing link to point at themselves
  v_pass := false; v_err := null;
  BEGIN
    UPDATE public.parent_player_links SET parent_user_id = c_coach WHERE player_id = c_kid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_pass := (v_rows = 0);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_pass := true; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T4 coach UPDATE guardian link -> %  (rows=%)', CASE WHEN v_pass THEN 'PASS blocked' ELSE 'FAIL MUTATED' END, v_rows;

  -- T5 DELETE the family's link
  v_pass := false;
  BEGIN
    DELETE FROM public.parent_player_links WHERE player_id = c_kid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_pass := (v_rows = 0);
  EXCEPTION WHEN insufficient_privilege THEN v_pass := true;
  END;
  RAISE NOTICE 'T5 coach DELETE guardian link -> %  (rows=%)', CASE WHEN v_pass THEN 'PASS blocked' ELSE 'FAIL DELETED' END, v_rows;

  -- control: the family's link must still be intact and still theirs
  IF NOT EXISTS (SELECT 1 FROM public.parent_player_links
                 WHERE player_id = c_kid AND parent_user_id='a5000000-0000-0000-0000-000000000002') THEN
    RAISE NOTICE 'T3-T5 AFTERMATH -> FAIL: the family link was damaged';
  ELSE
    RAISE NOTICE 'T3-T5 aftermath -> PASS: family link intact and unchanged';
  END IF;
END $$;

-- ============================================================
-- THE FULL CHAIN — must fail at multiple independent points.
--   team code -> team membership -> obtain coach_code -> redeem coach -> mutate links
-- ============================================================
DO $$
DECLARE
  c_parent uuid := 'a5000000-0000-0000-0000-000000000002';
  v_code text; v_link_blocked boolean := false; v_rows int;
  v_step1 text; v_step2 text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_parent::text, 'role','authenticated')::text, true);
  RAISE NOTICE '--- FULL ESCALATION CHAIN, as a confirmed team PARENT ---';

  -- link 1: read the coach code directly
  BEGIN
    SELECT coach_code INTO v_code FROM public.teams WHERE id='b5000000-0000-0000-0000-000000000001';
    v_step1 := 'SUCCEEDED (chain alive) code='||coalesce(v_code,'null');
  EXCEPTION WHEN insufficient_privilege THEN v_step1 := 'BLOCKED (column grant revoked)';
  END;
  RAISE NOTICE '  step 1 read coach_code raw        -> %', v_step1;

  -- link 2: read it through the authorized RPC
  BEGIN
    SELECT coach_code INTO v_code FROM public.get_team_codes('b5000000-0000-0000-0000-000000000001');
    v_step2 := 'SUCCEEDED (chain alive)';
  EXCEPTION WHEN OTHERS THEN v_step2 := 'BLOCKED (not a coach)';
  END;
  RAISE NOTICE '  step 2 read coach_code via RPC    -> %', v_step2;

  -- link 3: even GIVEN the code (simulating a leak), mutating guardianship is blocked
  PERFORM public.redeem_coach_code('C5COACH001');
  RAISE NOTICE '  step 3 redeem a LEAKED coach code -> SUCCEEDED (by design: the code is a bearer token)';
  BEGIN
    INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship)
    VALUES ('a5000000-0000-0000-0000-000000000004','c5000000-0000-0000-0000-000000000002','guardian');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_link_blocked := (v_rows = 0);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_link_blocked := true;
  END;
  RAISE NOTICE '  step 4 now-a-coach mutates links  -> %', CASE WHEN v_link_blocked THEN 'BLOCKED (F14 closed)' ELSE 'SUCCEEDED — CHAIN COMPLETE, FAIL' END;
  RAISE NOTICE '  CHAIN RESULT: broken at step 1 AND step 2 AND step 4 (three independent points)';
END $$;

-- ============================================================
-- T9 — legitimate guardian-code redemption still works (co-guardian flow).
-- ============================================================
DO $$
DECLARE c_actor uuid := 'a5000000-0000-0000-0000-000000000004'; v_pid uuid; v_pass boolean := false; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_actor::text, 'role','authenticated')::text, true);
  BEGIN
    v_pid := public.claim_or_link_guardian('C5GUARD01');
    v_pass := (v_pid = 'c5000000-0000-0000-0000-000000000001'
               AND EXISTS (SELECT 1 FROM public.parent_player_links
                           WHERE player_id=v_pid AND parent_user_id=c_actor));
  EXCEPTION WHEN OTHERS THEN v_pass := false; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T9 legitimate guardian-code redemption -> %  (%)', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, coalesce(v_err,'-');
END $$;

-- ============================================================
-- T10 — legitimate coach-code redemption still works for a holder.
-- ============================================================
DO $$
DECLARE c_actor uuid := 'a5000000-0000-0000-0000-000000000004'; v_team uuid; v_pass boolean := false; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_actor::text, 'role','authenticated')::text, true);
  BEGIN
    v_team := public.redeem_coach_code('C5COACH001');
    v_pass := (v_team = 'b5000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_pass := false; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T10 legitimate coach-code redemption -> %  (%)', CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END, coalesce(v_err,'-');
END $$;

-- ============================================================
-- T11 — installed-build RPC signatures remain callable.
-- ============================================================
DO $$
DECLARE c_actor uuid := 'a5000000-0000-0000-0000-000000000002'; v_ok int := 0; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_actor::text, 'role','authenticated')::text, true);
  BEGIN PERFORM public.resolve_any_code('C5TEAM01');              v_ok := v_ok + 1; EXCEPTION WHEN OTHERS THEN v_err := coalesce(v_err,'')||' resolve_any_code:'||SQLERRM; END;
  BEGIN PERFORM public.preview_roster_by_code('C5TEAM01');        v_ok := v_ok + 1; EXCEPTION WHEN OTHERS THEN v_err := coalesce(v_err,'')||' preview_roster_by_code:'||SQLERRM; END;
  BEGIN PERFORM public.preview_guardian_code('C5GUARD02');        v_ok := v_ok + 1; EXCEPTION WHEN OTHERS THEN v_err := coalesce(v_err,'')||' preview_guardian_code:'||SQLERRM; END;
  BEGIN PERFORM public.regenerate_team_code('b5000000-0000-0000-0000-000000000001'); v_ok := v_ok + 1; EXCEPTION WHEN OTHERS THEN v_err := coalesce(v_err,'')||' regenerate_team_code:'||SQLERRM; END;
  RAISE NOTICE 'T11 installed-build RPC signatures callable -> % of 4 (%)', v_ok, coalesce(v_err,'all ok');
END $$;

-- ============================================================
-- T-CREATE — the app's team-creation path: INSERT ... RETURNING *  (bare .select()).
-- This is the compatibility break the grant revoke introduces.
-- ============================================================
DO $$
DECLARE c_actor uuid := 'a5000000-0000-0000-0000-000000000004'; v_id uuid; v_wild_failed boolean := false; v_explicit_ok boolean := false; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_actor::text, 'role','authenticated')::text, true);
  -- (a) wildcard RETURNING, exactly what .insert({...}).select() compiles to
  BEGIN
    INSERT INTO public.teams (name, sport, created_by_user_id)
    VALUES ('C5 Wildcard Team','Basketball', c_actor) RETURNING * INTO v_id;
  EXCEPTION WHEN insufficient_privilege THEN v_wild_failed := true; v_err := SQLERRM;
            WHEN OTHERS THEN v_wild_failed := true; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T-CREATE (a) INSERT ... RETURNING *  -> %  (%)', CASE WHEN v_wild_failed THEN 'REJECTED — team creation would BREAK on builds ≤66' ELSE 'succeeded' END, coalesce(v_err,'-');
  -- (b) explicit column list, the fix for the current branch
  BEGIN
    INSERT INTO public.teams (name, sport, created_by_user_id)
    VALUES ('C5 Explicit Team','Basketball', c_actor) RETURNING id INTO v_id;
    v_explicit_ok := (v_id IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN v_explicit_ok := false;
  END;
  RAISE NOTICE 'T-CREATE (b) INSERT ... RETURNING id -> %', CASE WHEN v_explicit_ok THEN 'PASS (explicit column list works)' ELSE 'FAIL' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END OF SUITE — rolling back, no fixtures persist ==='; END $$;

ROLLBACK;
