-- ============================================================
-- test_c5_recovery_throttle_codes.sql — Slice C.5 steps 3-5.
-- Covers: super-admin guardian recovery, layered throttling, secure code generation
-- and real expiry. Companion to test_c5_identity_security.sql (steps 1-2).
--
-- SAFE TO RUN: everything inside BEGIN ... ROLLBACK, synthetic fixtures only.
-- Run as a privileged connection; needs superuser for auth.users fixtures and SET ROLE.
-- ============================================================
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a6000000-0000-0000-0000-000000000001', 'c5b-coach@example.test'),
  ('a6000000-0000-0000-0000-000000000002', 'c5b-mum@example.test'),
  ('a6000000-0000-0000-0000-000000000003', 'c5b-admin@example.test'),
  ('a6000000-0000-0000-0000-000000000004', 'c5b-dad@example.test'),
  ('a6000000-0000-0000-0000-000000000005', 'c5b-stranger@example.test');

INSERT INTO public.super_admins (user_id) VALUES ('a6000000-0000-0000-0000-000000000003');

INSERT INTO public.teams (id, name, sport, created_by_user_id, join_code, join_code_expires_at, coach_code, coach_code_expires_at)
VALUES ('b6000000-0000-0000-0000-000000000001','C5B Team','Basketball','a6000000-0000-0000-0000-000000000001',
        'C5BTEAM1', now() + interval '30 days', 'C5BCOACH01', now() + interval '30 days');

INSERT INTO public.team_memberships (team_id, user_id, role, status) VALUES
  ('b6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','coach'::membership_role,'confirmed'::membership_status),
  ('b6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002','parent'::membership_role,'confirmed'::membership_status);

INSERT INTO public.players (id, name, team_id) VALUES
  ('c6000000-0000-0000-0000-000000000001','C5B Kid','b6000000-0000-0000-0000-000000000001');
INSERT INTO public.player_teams (player_id, team_id) VALUES
  ('c6000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001');

-- The wrong-first-claimer scenario: 'stranger' claimed FIRST and is therefore 'parent';
-- the real mum is only a 'guardian' and cannot remove them under remove_guardian().
INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship) VALUES
  ('a6000000-0000-0000-0000-000000000005','c6000000-0000-0000-0000-000000000001','parent'),
  ('a6000000-0000-0000-0000-000000000002','c6000000-0000-0000-0000-000000000001','guardian');

INSERT INTO public.player_guardian_codes (player_id, code, expires_at) VALUES
  ('c6000000-0000-0000-0000-000000000001','C5BGUARD1', now() + interval '30 days');

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== C.5 STEPS 3-5 SUITE (synthetic, will ROLLBACK) ==='; END $$;

-- ============================================================
-- T4 / T5 — neither a COACH nor a normal GUARDIAN may call the recovery RPCs.
-- ============================================================
DO $$
DECLARE r record; v_blocked_remove boolean; v_blocked_primary boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('coach',    'a6000000-0000-0000-0000-000000000001'::uuid),
      ('guardian', 'a6000000-0000-0000-0000-000000000002'::uuid),
      ('stranger-who-is-primary','a6000000-0000-0000-0000-000000000005'::uuid)) AS t(who, uid)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.uid::text,'role','authenticated')::text, true);
    v_blocked_remove := false; v_blocked_primary := false;
    BEGIN PERFORM public.admin_remove_guardian('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002');
    EXCEPTION WHEN OTHERS THEN v_blocked_remove := true; END;
    BEGIN PERFORM public.admin_set_primary_guardian('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002');
    EXCEPTION WHEN OTHERS THEN v_blocked_primary := true; END;
    RAISE NOTICE 'T4/T5 % -> admin_remove_guardian %, admin_set_primary_guardian %',
      rpad(r.who,24), CASE WHEN v_blocked_remove THEN 'PASS blocked' ELSE 'FAIL ALLOWED' END,
                      CASE WHEN v_blocked_primary THEN 'PASS blocked' ELSE 'FAIL ALLOWED' END;
  END LOOP;
END $$;

-- ============================================================
-- T8 — super admin CANNOT remove the primary while others remain and no replacement exists.
-- ============================================================
DO $$
DECLARE v_pass boolean := false; v_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  BEGIN
    PERFORM public.admin_remove_guardian('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000005');
  EXCEPTION WHEN OTHERS THEN v_pass := true; v_err := SQLERRM;
  END;
  RAISE NOTICE 'T8 remove primary with guardians remaining -> %  (%)',
    CASE WHEN v_pass THEN 'PASS rejected' ELSE 'FAIL stranded the child' END, left(coalesce(v_err,'-'),90);
END $$;

-- ============================================================
-- T6 / T7 / T21 — primary transfer: repairs the inversion, exactly one 'parent',
-- and cannot target someone who is not linked.
-- ============================================================
DO $$
DECLARE v_parents int; v_mum_rel text; v_stranger_rel text; v_pass_unrelated boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000003','role','authenticated')::text, true);

  -- T7 first: an unrelated user must be refused, and must NOT be linked as a side effect.
  BEGIN
    PERFORM public.admin_set_primary_guardian('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000004');
  EXCEPTION WHEN OTHERS THEN v_pass_unrelated := true;
  END;
  RAISE NOTICE 'T7 primary transfer to UNLINKED user -> %  (link created: %)',
    CASE WHEN v_pass_unrelated THEN 'PASS refused' ELSE 'FAIL allowed' END,
    (SELECT count(*) FROM public.parent_player_links
      WHERE player_id='c6000000-0000-0000-0000-000000000001' AND parent_user_id='a6000000-0000-0000-0000-000000000004');

  -- T6/T21: transfer primary to the real mum (already linked as 'guardian').
  PERFORM public.admin_set_primary_guardian('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002','wrong first claimer');
  SELECT count(*) INTO v_parents FROM public.parent_player_links
   WHERE player_id='c6000000-0000-0000-0000-000000000001' AND relationship='parent';
  SELECT relationship INTO v_mum_rel FROM public.parent_player_links
   WHERE player_id='c6000000-0000-0000-0000-000000000001' AND parent_user_id='a6000000-0000-0000-0000-000000000002';
  SELECT relationship INTO v_stranger_rel FROM public.parent_player_links
   WHERE player_id='c6000000-0000-0000-0000-000000000001' AND parent_user_id='a6000000-0000-0000-0000-000000000005';
  RAISE NOTICE 'T6 primary transfer -> parents=% mum=% stranger=%  %',
    v_parents, v_mum_rel, v_stranger_rel,
    CASE WHEN v_parents=1 AND v_mum_rel='parent' AND v_stranger_rel='guardian' THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ============================================================
-- T3 — now the previous primary CAN be removed (a replacement primary exists).
-- T9 / T10 — audit rows and notifications.
-- ============================================================
DO $$
DECLARE v_gone boolean; v_audit int; v_notif int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  PERFORM public.admin_remove_guardian('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000005','evicting wrong claimer');
  SELECT NOT EXISTS (SELECT 1 FROM public.parent_player_links
    WHERE player_id='c6000000-0000-0000-0000-000000000001' AND parent_user_id='a6000000-0000-0000-0000-000000000005') INTO v_gone;
  RAISE NOTICE 'T3 super-admin removed the wrong primary -> %', CASE WHEN v_gone THEN 'PASS' ELSE 'FAIL' END;

  SELECT count(*) INTO v_audit FROM public.admin_audit_log
   WHERE action IN ('admin_set_primary_guardian','admin_remove_guardian')
     AND target_id='c6000000-0000-0000-0000-000000000001'
     AND actor_user_id='a6000000-0000-0000-0000-000000000003';
  RAISE NOTICE 'T9 audit rows for the two recovery actions -> % (%)', v_audit, CASE WHEN v_audit=2 THEN 'PASS' ELSE 'FAIL' END;

  SELECT count(*) INTO v_notif FROM public.notifications
   WHERE target_player_id='c6000000-0000-0000-0000-000000000001'
     AND type IN ('guardian_primary_changed','guardian_removed');
  RAISE NOTICE 'T10 guardian notifications produced -> % (%)', v_notif, CASE WHEN v_notif>0 THEN 'PASS' ELSE 'FAIL' END;

  -- invariant: one guardian left, and she is the primary
  RAISE NOTICE 'T8b final state -> guardians=% primaries=% (%)',
    (SELECT count(*) FROM public.parent_player_links WHERE player_id='c6000000-0000-0000-0000-000000000001'),
    (SELECT count(*) FROM public.parent_player_links WHERE player_id='c6000000-0000-0000-0000-000000000001' AND relationship='parent'),
    CASE WHEN (SELECT count(*) FROM public.parent_player_links WHERE player_id='c6000000-0000-0000-0000-000000000001' AND relationship='parent')=1 THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ============================================================
-- T16 / T17 — legitimate redemptions still work after steps 4 and 5.
-- ============================================================
DO $$
DECLARE v_pid uuid; v_team uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  v_pid := public.claim_or_link_guardian('C5BGUARD1');
  RAISE NOTICE 'T16 legitimate guardian-code redemption -> %', CASE WHEN v_pid='c6000000-0000-0000-0000-000000000001' THEN 'PASS' ELSE 'FAIL' END;
  v_team := public.redeem_coach_code('C5BCOACH01');
  RAISE NOTICE 'T17 legitimate coach-code redemption   -> %', CASE WHEN v_team='b6000000-0000-0000-0000-000000000001' THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ============================================================
-- T15 — uniform external failure: unknown vs expired vs revoked are indistinguishable.
-- ============================================================
DO $$
DECLARE v_unknown text; v_expired text; v_roster_unknown text; v_roster_expired text; v_coach_unknown text; v_coach_expired text;
BEGIN
  -- expired fixtures
  UPDATE public.teams SET join_code_expires_at = now() - interval '1 day' WHERE id='b6000000-0000-0000-0000-000000000001';
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000004','role','authenticated')::text, true);

  v_unknown        := coalesce((public.resolve_any_code('ZZZZZZZZ')->>'type'),'null');
  v_expired        := coalesce((public.resolve_any_code('C5BTEAM1')->>'type'),'null');
  v_roster_unknown := coalesce(public.preview_roster_by_code('ZZZZZZZZ')::text,'null');
  v_roster_expired := coalesce(public.preview_roster_by_code('C5BTEAM1')::text,'null');

  UPDATE public.teams SET coach_code_expires_at = now() - interval '1 day' WHERE id='b6000000-0000-0000-0000-000000000001';
  v_coach_unknown  := coalesce(public.redeem_coach_code('ZZZZZZZZZZ')::text,'null');
  v_coach_expired  := coalesce(public.redeem_coach_code('C5BCOACH01')::text,'null');

  RAISE NOTICE 'T15 resolve_any_code    unknown=% expired=%  -> %', v_unknown, v_expired, CASE WHEN v_unknown=v_expired THEN 'PASS uniform' ELSE 'FAIL distinguishable' END;
  RAISE NOTICE 'T15 preview_roster      unknown=% expired=%  -> %', v_roster_unknown, v_roster_expired, CASE WHEN v_roster_unknown=v_roster_expired THEN 'PASS uniform' ELSE 'FAIL distinguishable' END;
  RAISE NOTICE 'T15 redeem_coach_code   unknown=% expired=%  -> %', v_coach_unknown, v_coach_expired, CASE WHEN v_coach_unknown=v_coach_expired THEN 'PASS uniform' ELSE 'FAIL distinguishable' END;

  -- restore
  UPDATE public.teams SET join_code_expires_at = now() + interval '30 days',
                          coach_code_expires_at = now() + interval '30 days'
   WHERE id='b6000000-0000-0000-0000-000000000001';
END $$;

-- ============================================================
-- T14 — no code material anywhere in code_attempts.
-- `authenticated` has NO privileges on this table at all, so the privileged checks
-- RESET ROLE first. NOTE the leak probe deliberately does not search for 'GUARD':
-- the surface name 'claim_or_link_guardian' contains it, which would false-positive.
-- ============================================================
RESET ROLE;
DO $$
DECLARE v_cols text; v_leak int;
BEGIN
  SELECT string_agg(column_name,', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema='public' AND table_name='code_attempts';
  RAISE NOTICE 'T14 code_attempts columns = [%]', v_cols;
  RAISE NOTICE 'T14 no code/hash column present -> %',
    CASE WHEN v_cols = 'id, actor_user_id, surface, succeeded, attempted_at'
         THEN 'PASS (who / which surface / outcome only)' ELSE 'REVIEW: '||v_cols END;
  -- the actual fixture code values, none of which may appear anywhere in the table
  SELECT count(*) INTO v_leak FROM public.code_attempts
   WHERE surface IN ('C5BTEAM1','C5BCOACH01','C5BGUARD1','ZZZZZZZZ','ZZZZZZZZZZ')
      OR surface LIKE '%C5B%' OR surface LIKE '%ZZZ%';
  RAISE NOTICE 'T14 attempted code values present -> % (%)', v_leak, CASE WHEN v_leak=0 THEN 'PASS none stored' ELSE 'FAIL leak' END;
  RAISE NOTICE 'T14 surfaces recorded = %', (SELECT string_agg(DISTINCT surface, ', ' ORDER BY surface) FROM public.code_attempts);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  BEGIN PERFORM count(*) FROM public.code_attempts;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  RAISE NOTICE 'T14b client role can read code_attempts -> %', CASE WHEN v_blocked THEN 'PASS blocked entirely' ELSE 'FAIL readable' END;
END $$;

-- ============================================================
-- T18 / T19 / T20 — secure generator, legacy codes, no permanent codes.
-- Run BEFORE the throttling tests: T13 deliberately poisons the global window.
-- ============================================================
RESET ROLE;
DO $$
DECLARE v_c1 text; v_c2 text; v_src text;
BEGIN
  v_c1 := public.gen_join_code(6);
  v_c2 := public.gen_join_code(8);
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='gen_join_code';
  RAISE NOTICE 'T18 gen_join_code(6)=% (len %)  gen_join_code(8)=% (len %)', v_c1, length(v_c1), v_c2, length(v_c2);
  RAISE NOTICE 'T18 minimum length 8 enforced -> %', CASE WHEN length(v_c1)>=8 AND length(v_c2)>=8 THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE 'T18 CSPRNG (gen_random_bytes), no random() -> %',
    CASE WHEN v_src ILIKE '%gen_random_bytes%' AND v_src NOT ILIKE '%random()%' THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE 'T18 ambiguity-free alphabet (no I/L/O/0/1) -> %',
    CASE WHEN v_c1 !~ '[ILO01]' AND v_c2 !~ '[ILO01]' THEN 'PASS' ELSE 'FAIL' END;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  RAISE NOTICE 'T19 legacy 8-char team code still resolves   -> %',
    CASE WHEN (public.resolve_any_code('C5BTEAM1')->>'type')='team'  THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE 'T19b legacy 10-char coach code still resolves -> %',
    CASE WHEN (public.resolve_any_code('C5BCOACH01')->>'type')='coach' THEN 'PASS' ELSE 'FAIL' END;
END $$;

RESET ROLE;
DO $$
DECLARE v_pass_team boolean := false; v_pass_guard boolean := false;
BEGIN
  BEGIN UPDATE public.teams SET join_code_expires_at = NULL WHERE id='b6000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN v_pass_team := true; END;
  RAISE NOTICE 'T20 NULL expiry on a live TEAM code -> %', CASE WHEN v_pass_team THEN 'PASS rejected by CHECK' ELSE 'FAIL permanent code possible' END;
  BEGIN UPDATE public.player_guardian_codes SET expires_at = NULL WHERE player_id='c6000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN v_pass_guard := true; END;
  RAISE NOTICE 'T20b NULL expiry on a live GUARDIAN code -> %', CASE WHEN v_pass_guard THEN 'PASS rejected by CHECK' ELSE 'FAIL permanent code possible' END;
  RAISE NOTICE 'T20c new guardian-code rows get a default expiry -> %',
    CASE WHEN (SELECT column_default FROM information_schema.columns
                WHERE table_schema='public' AND table_name='player_guardian_codes' AND column_name='expires_at') IS NOT NULL
         THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ============================================================
-- T12 / T11 — per-user limiter. Uses a FRESH user with no prior failures, because
-- earlier cases (T15) legitimately recorded failures against the other fixtures.
-- ============================================================
RESET ROLE;
INSERT INTO auth.users (id, email) VALUES ('a6000000-0000-0000-0000-000000000006','c5b-fresh@example.test');
INSERT INTO public.code_attempts (actor_user_id, surface, succeeded, attempted_at)
SELECT 'a6000000-0000-0000-0000-000000000006','resolve_any_code',false, now() - (g||' seconds')::interval
  FROM generate_series(1,9) g;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_ok boolean := false; v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000006','role','authenticated')::text, true);
  BEGIN PERFORM public.resolve_any_code('C5BTEAM1'); v_ok := true; EXCEPTION WHEN OTHERS THEN v_ok := false; END;
  RAISE NOTICE 'T12 legitimate use at 9 prior failures -> %', CASE WHEN v_ok THEN 'PASS still works' ELSE 'FAIL locked out too early' END;
END $$;

RESET ROLE;
INSERT INTO public.code_attempts (actor_user_id, surface, succeeded, attempted_at)
SELECT 'a6000000-0000-0000-0000-000000000006','resolve_any_code',false, now() - (g||' seconds')::interval
  FROM generate_series(10,13) g;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_tripped boolean := false; v_other_ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000006','role','authenticated')::text, true);
  BEGIN PERFORM public.resolve_any_code('C5BTEAM1'); EXCEPTION WHEN OTHERS THEN v_tripped := true; END;
  RAISE NOTICE 'T11 per-user limiter past 10 failures -> %', CASE WHEN v_tripped THEN 'PASS throttled' ELSE 'FAIL not throttled' END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  BEGIN PERFORM public.resolve_any_code('C5BTEAM1'); v_other_ok := true; EXCEPTION WHEN OTHERS THEN v_other_ok := false; END;
  RAISE NOTICE 'T11b a DIFFERENT user at that moment -> %', CASE WHEN v_other_ok THEN 'PASS unaffected (per-user, not global)' ELSE 'FAIL collateral' END;
END $$;

-- ============================================================
-- T13 — global circuit breaker. RUN LAST: it intentionally fills the 60s window.
-- 300 failures across 300 DIFFERENT user ids = account rotation.
-- ============================================================
RESET ROLE;
INSERT INTO public.code_attempts (actor_user_id, surface, succeeded, attempted_at)
SELECT gen_random_uuid(), 'resolve_any_code', false, now() - ((g % 50)||' seconds')::interval
  FROM generate_series(1,300) g;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_fresh_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a6000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  BEGIN PERFORM public.resolve_any_code('C5BTEAM1'); EXCEPTION WHEN OTHERS THEN v_fresh_blocked := true; END;
  RAISE NOTICE 'T13 global breaker vs account rotation -> %',
    CASE WHEN v_fresh_blocked THEN 'PASS engaged for a zero-failure account' ELSE 'FAIL rotation bypasses' END;
END $$;
RESET ROLE;
DO $$ BEGIN
  RAISE NOTICE 'T13b global failures in the 60s window = %',
    (SELECT count(*) FROM public.code_attempts WHERE NOT succeeded AND attempted_at > now() - interval '60 seconds');
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
