-- ============================================================================
-- test_d_concurrency_and_build68.sql
--
-- PART 1 — CONCURRENCY / IDEMPOTENCY
--   C1  double claim (same code twice)
--   C2  retry after a dropped response (same request id -> one child)
--   C3  two adults claiming the same provisional child
--   C4  duplicate reconciliation requests (one live request per pair)
--   C5  reversed pair: A->B then B->A must not open a second request
--   C6  repeated reconciliation with the same request id
--   C7  reconciliation is atomic (rollback leaves the database untouched)
--   C8  a stale installed client calling the retired merge_players
--   C9  create_kid_and_join_team retried
--
-- PART 2 — BUILD 68 / CURRENT-WEB COMPATIBILITY
--   Calls every RPC and runs every table SELECT the installed client uses, in the exact
--   shape it uses them, at the DATABASE level -- not through the UI. Adding a parameter or a
--   returned column is safe; changing or removing one is not, and that is what this catches.
--
-- SAFE: BEGIN ... ROLLBACK, synthetic fixtures only.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('dc000000-0000-0000-0000-00000000000a','dc-parent1@example.test'),
  ('dc000000-0000-0000-0000-00000000000b','dc-parent2@example.test'),
  ('dc000000-0000-0000-0000-00000000000c','dc-coach@example.test');

INSERT INTO public.teams (id,name,sport,created_by_user_id,join_code,join_code_expires_at) VALUES
  ('dc000000-1111-0000-0000-000000000001','DC Team','Basketball','dc000000-0000-0000-0000-00000000000c','DCTEAM01', now()+interval '30 days');
INSERT INTO public.team_memberships (team_id,user_id,role,status) VALUES
  ('dc000000-1111-0000-0000-000000000001','dc000000-0000-0000-0000-00000000000c','head_coach','confirmed');

-- a coach-created placeholder with a guardian code, plus a claimed child for the merge tests
INSERT INTO public.players (id,name,team_id,identity_state) VALUES
  ('dc000000-2222-0000-0000-000000000001','DC Placeholder','dc000000-1111-0000-0000-000000000001','provisional'),
  ('dc000000-2222-0000-0000-000000000002','DC Mine','dc000000-1111-0000-0000-000000000001','verified'),
  ('dc000000-2222-0000-0000-000000000003','DC Spare','dc000000-1111-0000-0000-000000000001','provisional');
INSERT INTO public.player_teams (player_id,team_id,joined_on) VALUES
  ('dc000000-2222-0000-0000-000000000001','dc000000-1111-0000-0000-000000000001','2026-01-01'),
  ('dc000000-2222-0000-0000-000000000002','dc000000-1111-0000-0000-000000000001','2026-01-01'),
  ('dc000000-2222-0000-0000-000000000003','dc000000-1111-0000-0000-000000000001','2026-01-01');
INSERT INTO public.player_guardian_codes (player_id,code) VALUES
  ('dc000000-2222-0000-0000-000000000001','DCPROV01');
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians) VALUES
  ('dc000000-0000-0000-0000-00000000000a','dc000000-2222-0000-0000-000000000002','parent',true);

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== PART 1: CONCURRENCY / IDEMPOTENCY ==='; END $$;

DO $$
DECLARE
  p1 uuid := 'dc000000-0000-0000-0000-00000000000a';
  p2 uuid := 'dc000000-0000-0000-0000-00000000000b';
  prov uuid := 'dc000000-2222-0000-0000-000000000001';
  mine uuid := 'dc000000-2222-0000-0000-000000000002';
  spare uuid := 'dc000000-2222-0000-0000-000000000003';
  st text; msg text; n int; a uuid; b uuid; r1 uuid; r2 uuid; v jsonb;
BEGIN
  -- C1 — double claim with the same code
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p1::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('DCPROV01');
  PERFORM public.claim_or_link_guardian('DCPROV01');
  SELECT count(*) INTO n FROM parent_player_links WHERE player_id=prov AND parent_user_id=p1;
  RAISE NOTICE 'C1  same guardian code twice -> link rows=% -> %', n,
    CASE WHEN n=1 THEN 'PASS idempotent' ELSE 'FAIL duplicate link' END;

  -- C3 — a SECOND adult claims the same child: allowed as a co-guardian via the child's own
  -- code (that is the co-guardian flow), but must NOT become a manager either.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p2::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('DCPROV01');
  SELECT count(*) INTO n FROM parent_player_links WHERE player_id=prov AND can_manage_guardians;
  RAISE NOTICE 'C3  two adults claim the same child -> managers=% (expect 0) -> %', n,
    CASE WHEN n=0 THEN 'PASS neither is auto-promoted' ELSE 'FAIL a claimant got authority' END;

  -- C3b — the TEAM-code path refuses a child who already has a family
  st := null;
  BEGIN PERFORM public.claim_roster_spot('DCTEAM01', prov); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,50); END;
  RAISE NOTICE 'C3b team-code claim of a CLAIMED child -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL' END, coalesce('· '||msg,'');

  -- C2 — retry after a dropped response: same request id must return the SAME child
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p1::text,'role','authenticated')::text, true);
  a := public.create_kid('Retry Kid', 'dc000000-9999-0000-0000-000000000001');
  b := public.create_kid('Retry Kid', 'dc000000-9999-0000-0000-000000000001');
  SELECT count(*) INTO n FROM players WHERE created_by_user_id=p1 AND creation_request_id='dc000000-9999-0000-0000-000000000001';
  RAISE NOTICE 'C2  create_kid retried (same request id) -> same child=%, rows=% -> %',
    (a=b), n, CASE WHEN a=b AND n=1 THEN 'PASS' ELSE 'FAIL duplicate child created' END;

  -- C2b — a DIFFERENT request id is a genuinely different child, even with the same name
  b := public.create_kid('Retry Kid', 'dc000000-9999-0000-0000-000000000002');
  RAISE NOTICE 'C2b same name, new request id -> distinct child=% -> %', (a<>b),
    CASE WHEN a<>b THEN 'PASS names never dedupe' ELSE 'FAIL name-based dedupe' END;

  -- C9 — create_kid_and_join_team retried
  v := public.create_kid_and_join_team('Txn Kid','DCTEAM01','dc000000-9999-0000-0000-000000000003');
  DECLARE v2 jsonb; BEGIN
    v2 := public.create_kid_and_join_team('Txn Kid','DCTEAM01','dc000000-9999-0000-0000-000000000003');
    SELECT count(*) INTO n FROM players WHERE created_by_user_id=p1 AND creation_request_id='dc000000-9999-0000-0000-000000000003';
    RAISE NOTICE 'C9  create_kid_and_join_team retried -> same player=%, rows=% -> %',
      (v->>'player_id') = (v2->>'player_id'), n,
      CASE WHEN (v->>'player_id')=(v2->>'player_id') AND n=1 THEN 'PASS' ELSE 'FAIL' END;
  END;

  -- C4 / C5 — one live request per UNORDERED pair, in either direction
  r1 := public.request_player_merge(mine, spare, 'first');
  r2 := public.request_player_merge(mine, spare, 'duplicate');
  RAISE NOTICE 'C4  duplicate request -> same id=% -> %', (r1=r2),
    CASE WHEN r1=r2 THEN 'PASS' ELSE 'FAIL two live requests' END;
  r2 := public.request_player_merge(spare, mine, 'reversed');
  SELECT count(*) INTO n FROM player_merge_requests
   WHERE status IN ('pending','confirmed')
     AND least(source_player_id,target_player_id)=least(mine,spare)
     AND greatest(source_player_id,target_player_id)=greatest(mine,spare);
  RAISE NOTICE 'C5  reversed pair B->A -> same id=%, live rows=% -> %', (r1=r2), n,
    CASE WHEN r1=r2 AND n=1 THEN 'PASS pair is unordered' ELSE 'FAIL A/B and B/A diverged' END;
END $$;

-- C7 — atomicity: a reconciliation rolled back leaves the database bit-identical
DO $$
DECLARE n_before int; n_after int; ct_before int; ct_after int;
BEGIN
  SELECT count(*) INTO n_before FROM parent_player_links;
  SELECT count(*) INTO ct_before FROM player_teams;
  BEGIN
    PERFORM set_config('request.jwt.claims','{"sub":"dc000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);
    -- unauthenticated-for-this-pair caller: must raise, and raise BEFORE writing anything
    PERFORM public.reconcile_players('dc000000-2222-0000-0000-000000000002','dc000000-2222-0000-0000-000000000003');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT count(*) INTO n_after FROM parent_player_links;
  SELECT count(*) INTO ct_after FROM player_teams;
  RAISE NOTICE 'C7  refused reconciliation wrote nothing -> links %->%, spells %->% -> %',
    n_before, n_after, ct_before, ct_after,
    CASE WHEN n_before=n_after AND ct_before=ct_after THEN 'PASS' ELSE 'FAIL partial write' END;
END $$;

-- C6 — repeated reconciliation with the same request id (via the confirmed-request path)
DO $$
DECLARE v1 jsonb; v2 jsonb; n1 int; n2 int; req uuid;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"dc000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SELECT id INTO req FROM player_merge_requests WHERE status='pending' LIMIT 1;
  -- the spare side is unclaimed, so the coach supplies the second signal (case 4)
  PERFORM set_config('request.jwt.claims','{"sub":"dc000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
  PERFORM public.confirm_player_merge(req);
  PERFORM set_config('request.jwt.claims','{"sub":"dc000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SELECT count(*) INTO n1 FROM player_reconciliations;
  v1 := public.reconcile_players('dc000000-2222-0000-0000-000000000002','dc000000-2222-0000-0000-000000000003',
          'dc000000-aaaa-0000-0000-000000000001', false, null, req, true);
  v2 := public.reconcile_players('dc000000-2222-0000-0000-000000000002','dc000000-2222-0000-0000-000000000003',
          'dc000000-aaaa-0000-0000-000000000001', false, null, req, true);
  SELECT count(*) INTO n2 FROM player_reconciliations;
  RAISE NOTICE 'C6  repeated reconcile: % then % | audit rows %->% -> %',
    v1->>'status', v2->>'status', n1, n2,
    CASE WHEN v1->>'status'='applied' AND v2->>'status'='already_applied' AND n2=n1+1
         THEN 'PASS exactly one merge' ELSE 'FAIL' END;
END $$;

-- C8 — a stale installed client reaching the retired merge_players
RESET ROLE;
DO $$
DECLARE v_can boolean; st text;
BEGIN
  v_can := has_function_privilege('authenticated','public.merge_players(uuid,uuid)','EXECUTE');
  BEGIN PERFORM public.merge_players(gen_random_uuid(), gen_random_uuid()); st := 'EXECUTED';
  EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
  RAISE NOTICE 'C8  stale client -> client EXECUTE=%, body says % -> %', v_can, st,
    CASE WHEN NOT v_can AND st='0A000' THEN 'PASS clear retired error, nothing destroyed' ELSE 'FAIL' END;
END $$;

-- ============================================================================
DO $$ BEGIN RAISE NOTICE '=== PART 2: BUILD 68 / CURRENT-WEB COMPATIBILITY ==='; END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  coach uuid := 'dc000000-0000-0000-0000-00000000000c';
  p1    uuid := 'dc000000-0000-0000-0000-00000000000a';
  team  uuid := 'dc000000-1111-0000-0000-000000000001';
  prov  uuid := 'dc000000-2222-0000-0000-000000000001';
  st text; msg text; r record; v jsonb; n int; kid uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);

  -- B68-1 create_roster_placeholder, EXACTLY the 3 named args roster.tsx sends
  st := null;
  BEGIN
    SELECT * INTO r FROM public.create_roster_placeholder(
      p_team_id => team, p_name => 'B68 Player', p_jersey => '21');
    st := CASE WHEN r.player_id IS NOT NULL AND length(r.guardian_code) >= 8 THEN 'ok' ELSE 'bad shape' END;
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,60); END;
  RAISE NOTICE 'B68-1 create_roster_placeholder(3 named args) -> %', st;

  -- B68-2 update_kid_profile, the 4-arg shape (roster rename + jersey)
  st := null;
  BEGIN PERFORM public.update_kid_profile(p_player_id => r.player_id, p_name => 'B68 Renamed');
        st := 'ok';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,60); END;
  RAISE NOTICE 'B68-2 update_kid_profile(p_player_id,p_name) -> % (name now %)', st,
    (SELECT name FROM players WHERE id=r.player_id);
  st := null;
  BEGIN PERFORM public.update_kid_profile(p_player_id => r.player_id, p_jersey => '33'); st := 'ok';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,60); END;
  RAISE NOTICE 'B68-3 update_kid_profile(p_jersey) -> % (team jersey now %)', st,
    (SELECT jersey_number FROM player_teams WHERE player_id=r.player_id AND team_id=team);

  -- B68-4 list_player_guardians: the 5 original columns MUST still exist
  BEGIN
    PERFORM public.claim_or_link_guardian((SELECT code FROM player_guardian_codes WHERE player_id=r.player_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  st := null;
  BEGIN
    PERFORM user_id, display_name, email, relationship, team_role
      FROM public.list_player_guardians(team, r.player_id);
    st := 'ok — all 5 legacy columns present';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,60); END;
  RAISE NOTICE 'B68-4 list_player_guardians legacy columns -> %', st;

  -- B68-5 kid_guardians JSON keys app/kid.tsx reads
  PERFORM set_config('request.jwt.claims', json_build_object('sub',p1::text,'role','authenticated')::text, true);
  v := public.kid_guardians('dc000000-2222-0000-0000-000000000002');
  RAISE NOTICE 'B68-5 kid_guardians keys -> % -> %',
    (SELECT string_agg(k,',' ORDER BY k) FROM jsonb_object_keys(v->0) k),
    CASE WHEN v->0 ? 'user_id' AND v->0 ? 'name' AND v->0 ? 'relationship'
              AND v->0 ? 'is_you' AND v->0 ? 'is_primary' THEN 'PASS shape unchanged' ELSE 'FAIL' END;

  -- B68-6 kid_team_audience shape app/kid.tsx reads
  v := public.kid_team_audience('dc000000-2222-0000-0000-000000000002');
  RAISE NOTICE 'B68-6 kid_team_audience keys -> % -> %',
    coalesce((SELECT string_agg(k,',' ORDER BY k) FROM jsonb_object_keys(v->0) k),'(empty)'),
    CASE WHEN v->0 ? 'team_id' AND v->0 ? 'team_name' AND v->0 ? 'member_count' AND v->0 ? 'coaches'
         THEN 'PASS shape unchanged' ELSE 'FAIL' END;

  -- B68-7 preview_roster_by_code (the join screen's first call)
  v := public.preview_roster_by_code('DCTEAM01');
  RAISE NOTICE 'B68-7 preview_roster_by_code keys -> % -> %',
    (SELECT string_agg(k,',' ORDER BY k) FROM jsonb_object_keys(v) k),
    CASE WHEN v ? 'team_id' AND v ? 'team_name' AND v ? 'players' THEN 'PASS' ELSE 'FAIL' END;

  -- B68-8 create_kid(name) — the 1-arg legacy shape select-team.tsx used to send
  st := null;
  BEGIN kid := public.create_kid(name => 'Legacy Shape Kid'); st := 'ok';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,60); END;
  RAISE NOTICE 'B68-8 create_kid(name) legacy 1-arg -> %', st;

  -- B68-9 join_team_with_code (the "add one of your players" path)
  st := null;
  BEGIN PERFORM public.join_team_with_code('DCTEAM01', kid); st := 'ok';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,60); END;
  RAISE NOTICE 'B68-9 join_team_with_code -> %', st;

  -- B68-10 roster.tsx's DIRECT table reads
  SELECT count(*) INTO n FROM player_teams pt
   WHERE pt.team_id = team AND pt.left_at IS NULL;
  RAISE NOTICE 'B68-10 roster player_teams select -> % rows (must be > 0)', n;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM players p
   WHERE p.id IN (SELECT player_id FROM player_teams WHERE team_id = team AND left_at IS NULL);
  RAISE NOTICE 'B68-11 nested players(id,name) readable by coach -> % rows -> %', n,
    CASE WHEN n > 0 THEN 'PASS roster still renders' ELSE 'FAIL roster would show Unnamed' END;
  SELECT count(*) INTO n FROM parent_player_links ppl
   WHERE ppl.player_id IN (SELECT player_id FROM player_teams WHERE team_id = team AND left_at IS NULL);
  RAISE NOTICE 'B68-12 guardian COUNT select (roster.tsx:101) -> % rows -> %', n,
    CASE WHEN n > 0 THEN 'PASS counts still work' ELSE 'FAIL guardian counts would read 0' END;

  -- B68-13 link-players.tsx reads the legacy columns
  SELECT count(*) INTO n FROM players p
   WHERE p.team_id = team;
  RAISE NOTICE 'B68-13 link-players legacy players.team_id read -> % rows -> %', n,
    CASE WHEN n > 0 THEN 'PASS legacy column still populated' ELSE 'FAIL link screen would be empty' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
