-- ============================================================
-- test_d05_d075_cross_org_and_primary.sql
--   D0.5 — kid_team_audience cross-organisation access matrix
--   D0.75 — is_primary_guardian / admin_set_primary_guardian / shares_read agreement
--
-- Fixtures model Lars's real multi-team shape synthetically: ONE child with open spells on
-- TWO unrelated teams, each with its own coach. No real player, team or guardian row is
-- read or touched.
--
-- SAFE: BEGIN ... ROLLBACK. Privileged connection required (auth.users fixtures + SET ROLE).
-- ============================================================
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('d5000000-0000-0000-0000-00000000000a','d5-coachA@example.test'),
  ('d5000000-0000-0000-0000-00000000000b','d5-coachB@example.test'),
  ('d5000000-0000-0000-0000-0000000000c1','d5-guardian@example.test'),
  ('d5000000-0000-0000-0000-0000000000c2','d5-guardian2@example.test'),
  ('d5000000-0000-0000-0000-0000000000d1','d5-unrelated@example.test'),
  ('d5000000-0000-0000-0000-0000000000e1','d5-superadmin@example.test');
INSERT INTO public.super_admins (user_id) VALUES ('d5000000-0000-0000-0000-0000000000e1');
-- a trigger on auth.users auto-creates user_profiles, so upsert the display names
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('d5000000-0000-0000-0000-00000000000a','Coach Alpha'),
  ('d5000000-0000-0000-0000-00000000000b','Coach Bravo')
ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name;

-- TWO UNRELATED ORGANISATIONS
INSERT INTO public.teams (id, name, sport, created_by_user_id) VALUES
  ('d5000000-1111-0000-0000-00000000000a','Org A Hawks','Basketball','d5000000-0000-0000-0000-00000000000a'),
  ('d5000000-1111-0000-0000-00000000000b','Org B Rovers','Flag Football','d5000000-0000-0000-0000-00000000000b');
INSERT INTO public.team_memberships (team_id, user_id, role, status) VALUES
  ('d5000000-1111-0000-0000-00000000000a','d5000000-0000-0000-0000-00000000000a','head_coach'::membership_role,'confirmed'::membership_status),
  ('d5000000-1111-0000-0000-00000000000b','d5000000-0000-0000-0000-00000000000b','head_coach'::membership_role,'confirmed'::membership_status),
  ('d5000000-1111-0000-0000-00000000000a','d5000000-0000-0000-0000-0000000000c1','parent'::membership_role,'confirmed'::membership_status);

-- ONE CHILD on BOTH teams. players.team_id deliberately points at Org A only, to prove the
-- fix no longer relies on that legacy column.
INSERT INTO public.players (id, name, team_id) VALUES
  ('d5000000-2222-0000-0000-000000000001','D5 Multi Team Kid','d5000000-1111-0000-0000-00000000000a');
INSERT INTO public.player_teams (player_id, team_id) VALUES
  ('d5000000-2222-0000-0000-000000000001','d5000000-1111-0000-0000-00000000000a'),
  ('d5000000-2222-0000-0000-000000000001','d5000000-1111-0000-0000-00000000000b');
-- D0.75 made is_primary_guardian() read relationship='parent'. Slice D2 SUPERSEDED that,
-- moving authority to can_manage_guardians, and its backfill grants the capability to exactly
-- the existing 'parent' rows. This fixture therefore sets both signals, matching the state
-- real production data is in after D2. The transfer assertions below are unchanged and still
-- prove the authority signal follows admin_set_primary_guardian.
INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship, can_manage_guardians) VALUES
  ('d5000000-0000-0000-0000-0000000000c1','d5000000-2222-0000-0000-000000000001','parent',true),
  ('d5000000-0000-0000-0000-0000000000c2','d5000000-2222-0000-0000-000000000001','guardian',false);

-- a share targeted at the child, for the D0.75 shares_read test
INSERT INTO public.videos (id, team_id, uploaded_by_user_id, url, label)
VALUES ('d5000000-3333-0000-0000-000000000001','d5000000-1111-0000-0000-00000000000a',
        'd5000000-0000-0000-0000-00000000000a','d5/test-object.mp4','D5 Clip');
INSERT INTO public.shares (id, content_type, content_id, team_id, audience, target_player_id, shared_by_user_id, visible)
VALUES ('d5000000-4444-0000-0000-000000000001','video'::share_content,'d5000000-3333-0000-0000-000000000001',
        'd5000000-1111-0000-0000-00000000000a','player'::share_audience,
        'd5000000-2222-0000-0000-000000000001','d5000000-0000-0000-0000-00000000000a', true);
-- A SECOND player-audience share that is already ON THE WALL (guardian-approved).
-- shares_read grants a player-audience row to any linked parent when on_wall = true,
-- and gates it on is_primary_guardian() only while it is still an unapproved inbox item.
-- Both states must be exercised: the transfer should move INBOX authority and must NOT
-- revoke a non-primary guardian's access to content already approved onto the wall.
INSERT INTO public.videos (id, team_id, uploaded_by_user_id, url, label)
VALUES ('d5000000-3333-0000-0000-000000000002','d5000000-1111-0000-0000-00000000000a',
        'd5000000-0000-0000-0000-00000000000a','d5/test-object-2.mp4','D5 Clip 2');
INSERT INTO public.shares (id, content_type, content_id, team_id, audience, target_player_id, shared_by_user_id, visible, on_wall)
VALUES ('d5000000-4444-0000-0000-000000000002','video'::share_content,'d5000000-3333-0000-0000-000000000002',
        'd5000000-1111-0000-0000-00000000000a','player'::share_audience,
        'd5000000-2222-0000-0000-000000000001','d5000000-0000-0000-0000-00000000000a', true, true);

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== D0.5 / D0.75 SUITE (synthetic, will ROLLBACK) ==='; END $$;

-- ============================================================
-- D0.5 ACCESS MATRIX
-- ============================================================
DO $$
DECLARE
  r record; v_json jsonb; v_err text; v_teams text; v_coaches text; v_n int;
  c_kid uuid := 'd5000000-2222-0000-0000-000000000001';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('coach A (Org A only)',   'd5000000-0000-0000-0000-00000000000a'::uuid, 'A only'),
      ('coach B (Org B only)',   'd5000000-0000-0000-0000-00000000000b'::uuid, 'B only'),
      ('linked guardian',        'd5000000-0000-0000-0000-0000000000c1'::uuid, 'A and B'),
      ('second guardian',        'd5000000-0000-0000-0000-0000000000c2'::uuid, 'A and B'),
      ('unrelated authenticated','d5000000-0000-0000-0000-0000000000d1'::uuid, 'refused'),
      ('super admin',            'd5000000-0000-0000-0000-0000000000e1'::uuid, 'A and B')) AS t(who, uid, expect)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.uid::text,'role','authenticated')::text, true);
    IF auth.uid() IS DISTINCT FROM r.uid THEN RAISE EXCEPTION 'CONTROL FAILED: impersonation'; END IF;
    IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'CONTROL FAILED: role'; END IF;

    v_json := null; v_err := null;
    BEGIN
      v_json := public.kid_team_audience(c_kid);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;

    IF v_err IS NOT NULL THEN
      RAISE NOTICE 'D0.5 % | expect % -> REFUSED (%)', rpad(r.who,24), rpad(r.expect,8), left(v_err,30);
    ELSE
      SELECT count(*), coalesce(string_agg(e->>'team_name', '+' ORDER BY e->>'team_name'),'(none)')
        INTO v_n, v_teams FROM jsonb_array_elements(v_json) e;
      -- every coach name visible anywhere in the payload, including nested arrays
      SELECT coalesce(string_agg(DISTINCT cc->>'name', ',' ORDER BY cc->>'name'),'(none)')
        INTO v_coaches
        FROM jsonb_array_elements(v_json) e, jsonb_array_elements(e->'coaches') cc;
      RAISE NOTICE 'D0.5 % | expect % -> % team(s): % | coaches visible: %',
        rpad(r.who,24), rpad(r.expect,8), v_n, rpad(v_teams,26), v_coaches;
    END IF;
  END LOOP;
END $$;

-- explicit leak assertions
DO $$
DECLARE v jsonb; v_leak_team boolean; v_leak_coach boolean;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  v := public.kid_team_audience('d5000000-2222-0000-0000-000000000001');
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e->>'team_name' = 'Org B Rovers') INTO v_leak_team;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e, jsonb_array_elements(e->'coaches') c
                  WHERE c->>'name' = 'Coach Bravo') INTO v_leak_coach;
  RAISE NOTICE 'D0.5 LEAK: coach A can see Org B team row  -> %', CASE WHEN v_leak_team  THEN 'FAIL LEAK' ELSE 'PASS hidden' END;
  RAISE NOTICE 'D0.5 LEAK: coach A can see Org B coach name  -> %', CASE WHEN v_leak_coach THEN 'FAIL LEAK' ELSE 'PASS hidden' END;
  RAISE NOTICE 'D0.5 legacy players.team_id points at Org A, yet coach B still sees B: see matrix row above';
END $$;

-- anon
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE v_refused boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"anon"}', true);
  BEGIN PERFORM public.kid_team_audience('d5000000-2222-0000-0000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_refused := true; END;
  RAISE NOTICE 'D0.5 anon -> %', CASE WHEN v_refused THEN 'PASS refused' ELSE 'FAIL allowed' END;
END $$;

-- ============================================================
-- D0.75 PRIMARY TRANSFER + shares_read AGREEMENT
-- ============================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  c_kid uuid := 'd5000000-2222-0000-0000-000000000001';
  g1 uuid := 'd5000000-0000-0000-0000-0000000000c1';  -- starts as 'parent'
  g2 uuid := 'd5000000-0000-0000-0000-0000000000c2';  -- starts as 'guardian'
  v_g1 boolean; v_g2 boolean; v_share_g1 int; v_share_g2 int; v_parents int;
  v_wall_g1 int; v_wall_g2 int;
BEGIN
  -- BEFORE
  PERFORM set_config('request.jwt.claims', json_build_object('sub',g1::text,'role','authenticated')::text, true);
  v_g1 := public.is_primary_guardian(c_kid);
  SELECT count(*) INTO v_share_g1 FROM public.shares WHERE id='d5000000-4444-0000-0000-000000000001';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',g2::text,'role','authenticated')::text, true);
  v_g2 := public.is_primary_guardian(c_kid);
  SELECT count(*) INTO v_share_g2 FROM public.shares WHERE id='d5000000-4444-0000-0000-000000000001';
  RAISE NOTICE 'D0.75 BEFORE: g1 primary=% (share rows visible=%) | g2 primary=% (share rows visible=%)',
    v_g1, v_share_g1, v_g2, v_share_g2;
  RAISE NOTICE 'D0.75 BEFORE expectation -> % (g1 holds the management capability)',
    CASE WHEN v_g1 AND NOT v_g2 THEN 'PASS' ELSE 'FAIL' END;

  -- TRANSFER, via the C.5 recovery RPC, as super admin
  PERFORM set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
  PERFORM public.admin_set_primary_guardian(c_kid, g2, 'D0.75 test transfer');

  -- AFTER
  PERFORM set_config('request.jwt.claims', json_build_object('sub',g1::text,'role','authenticated')::text, true);
  v_g1 := public.is_primary_guardian(c_kid);
  SELECT count(*) INTO v_share_g1 FROM public.shares WHERE id='d5000000-4444-0000-0000-000000000001';
  SELECT count(*) INTO v_wall_g1 FROM public.shares WHERE id='d5000000-4444-0000-0000-000000000002';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',g2::text,'role','authenticated')::text, true);
  v_g2 := public.is_primary_guardian(c_kid);
  SELECT count(*) INTO v_share_g2 FROM public.shares WHERE id='d5000000-4444-0000-0000-000000000001';
  SELECT count(*) INTO v_wall_g2 FROM public.shares WHERE id='d5000000-4444-0000-0000-000000000002';
  SELECT count(*) INTO v_parents FROM public.parent_player_links
   WHERE player_id=c_kid AND relationship='parent';

  RAISE NOTICE 'D0.75 AFTER : g1 primary=% (share rows visible=%) | g2 primary=% (share rows visible=%)',
    v_g1, v_share_g1, v_g2, v_share_g2;
  RAISE NOTICE 'D0.75 old primary LOST authority        -> %', CASE WHEN NOT v_g1 THEN 'PASS' ELSE 'FAIL still primary' END;
  RAISE NOTICE 'D0.75 new primary GAINED authority      -> %', CASE WHEN v_g2 THEN 'PASS' ELSE 'FAIL not primary' END;
  RAISE NOTICE 'D0.75 is_primary_guardian FOLLOWS the transfer -> %', CASE WHEN v_g2 AND NOT v_g1 THEN 'PASS (would have FAILED under earliest-created_at)' ELSE 'FAIL' END;
  RAISE NOTICE 'D0.75 exactly one primary remains       -> % (count=%)', CASE WHEN v_parents=1 THEN 'PASS' ELSE 'FAIL' END, v_parents;
  -- INBOX item (on_wall = false): authority is the primary's alone, and it MOVES.
  RAISE NOTICE 'D0.75 unapproved INBOX share follows the primary (old=%, new=%) -> %',
    v_share_g1, v_share_g2,
    CASE WHEN v_share_g1=0 AND v_share_g2=1 THEN 'PASS' ELSE 'FAIL' END;
  -- WALL item (on_wall = true): approved content stays readable by BOTH linked guardians.
  -- A primary transfer must never retroactively strip a parent of approved wall content.
  RAISE NOTICE 'D0.75 approved WALL share still visible to BOTH guardians after transfer (old=%, new=%) -> %',
    v_wall_g1, v_wall_g2,
    CASE WHEN v_wall_g1=1 AND v_wall_g2=1 THEN 'PASS access not lost' ELSE 'FAIL access lost' END;
END $$;

-- ordinary coach cannot manipulate primary state
DO $$
DECLARE v_blocked boolean := false; v_blocked2 boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  BEGIN PERFORM public.admin_set_primary_guardian('d5000000-2222-0000-0000-000000000001','d5000000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN OTHERS THEN v_blocked := true; END;
  BEGIN UPDATE public.parent_player_links SET relationship='parent'
          WHERE player_id='d5000000-2222-0000-0000-000000000001'
            AND parent_user_id='d5000000-0000-0000-0000-0000000000c1';
        IF NOT FOUND THEN v_blocked2 := true; END IF;
  EXCEPTION WHEN OTHERS THEN v_blocked2 := true; END;
  RAISE NOTICE 'D0.75 coach cannot call admin_set_primary_guardian -> %', CASE WHEN v_blocked THEN 'PASS blocked' ELSE 'FAIL' END;
  RAISE NOTICE 'D0.75 coach cannot UPDATE relationship directly    -> %', CASE WHEN v_blocked2 THEN 'PASS blocked (C.5 F14)' ELSE 'FAIL' END;
END $$;

-- C.5 recovery still functional after the redefinition
DO $$
DECLARE v_removed boolean;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
  PERFORM public.admin_remove_guardian('d5000000-2222-0000-0000-000000000001','d5000000-0000-0000-0000-0000000000c1','D0.75 test');
  SELECT NOT EXISTS (SELECT 1 FROM public.parent_player_links
    WHERE player_id='d5000000-2222-0000-0000-000000000001'
      AND parent_user_id='d5000000-0000-0000-0000-0000000000c1') INTO v_removed;
  RAISE NOTICE 'D0.75 C.5 admin_remove_guardian still works (non-primary removal) -> %',
    CASE WHEN v_removed THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE 'D0.75 remaining primaries after removal -> %',
    (SELECT count(*) FROM public.parent_player_links
      WHERE player_id='d5000000-2222-0000-0000-000000000001' AND relationship='parent');
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
