-- ============================================================================
-- test_d_identity_security.sql — ADVERSARIAL AUDIT OF SLICE D
--
-- Written as if someone else built this and I am trying to break it. Every check is an
-- ATTACK, and PASS means the attack failed.
--
-- Attack list (Adam's brief):
--   A1  coach becomes guardian manager
--   A2  coach confirms HIMSELF as a child's manager
--   A3  wrong first claimant gains permanent authority
--   A4  guardian removes legitimate family without authority
--   A5  coach reconciles two children (different families)
--   A6  coach forges the "same child" assertion via link_players
--   A7  guardian reconciles children without the required confirmation
--   A8  same-name children are auto-suggested / auto-merged
--   A9  a leaked code grants excessive authority
--   A10 cross-org team + coach enumeration
--   A11 stale (retired) player id bypasses authorization
--   A12 retired player id still exposes the child on a roster
--   A13 super-admin recovery leaves inconsistent authority
--   A14 RLS still relies on legacy players.team_id
--   A15 direct table writes bypass the RPC restrictions (PostgREST path)
--   A16 a coach edits a CLAIMED child's identity
--   A17 dry run used to probe children the caller has no standing on
--   A18 merge request confirmed by the person who raised it
--   A19 removing the last manager strands a family
--
-- SAFE: BEGIN ... ROLLBACK, synthetic fixtures only.
-- NOTE: privilege-revoked functions are asserted with has_function_privilege(), never by
-- calling them -- calling one crashes the local stack (supautils function-privilege hint bug).
-- ============================================================================
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('d5100000-0000-0000-0000-00000000000a','ds-familyA@example.test'),
  ('d5100000-0000-0000-0000-00000000000b','ds-familyB@example.test'),
  ('d5100000-0000-0000-0000-00000000000c','ds-coach@example.test'),
  ('d5100000-0000-0000-0000-00000000000d','ds-coach2@example.test'),
  ('d5100000-0000-0000-0000-00000000000e','ds-stranger@example.test'),
  ('d5100000-0000-0000-0000-00000000000f','ds-superadmin@example.test'),
  -- a genuinely UNRELATED user: 'stranger' is a fixture guardian of Child A, so it has real
  -- standing and is the wrong actor for the information-leak probe.
  ('d5100000-0000-0000-0000-000000000099','ds-outsider@example.test');
INSERT INTO public.super_admins (user_id) VALUES ('d5100000-0000-0000-0000-00000000000f');

-- Two unrelated organisations
INSERT INTO public.teams (id,name,sport,created_by_user_id,join_code,join_code_expires_at) VALUES
  ('d5100000-1111-0000-0000-00000000000a','Org A','Basketball','d5100000-0000-0000-0000-00000000000c','DSORGA01', now()+interval '30 days'),
  ('d5100000-1111-0000-0000-00000000000b','Org B','Basketball','d5100000-0000-0000-0000-00000000000d','DSORGB01', now()+interval '30 days');
INSERT INTO public.team_memberships (team_id,user_id,role,status) VALUES
  ('d5100000-1111-0000-0000-00000000000a','d5100000-0000-0000-0000-00000000000c','head_coach','confirmed'),
  ('d5100000-1111-0000-0000-00000000000b','d5100000-0000-0000-0000-00000000000d','head_coach','confirmed');

-- Children:
--   FAM_A  — family A's child, verified, A manages
--   FAM_B  — family B's child, verified, B manages
--   PROV   — a coach-created placeholder on Org A, nobody has claimed it
--   SAME1/SAME2 — two DIFFERENT children who share a name (the Jackson case)
INSERT INTO public.players (id,name,team_id,identity_state) VALUES
  ('d5100000-2222-0000-0000-00000000000a','Child A','d5100000-1111-0000-0000-00000000000a','verified'),
  ('d5100000-2222-0000-0000-00000000000b','Child B','d5100000-1111-0000-0000-00000000000b','verified'),
  ('d5100000-2222-0000-0000-00000000000c','Prov Kid','d5100000-1111-0000-0000-00000000000a','provisional'),
  ('d5100000-2222-0000-0000-000000000011','Jackson','d5100000-1111-0000-0000-00000000000a','provisional'),
  ('d5100000-2222-0000-0000-000000000012','Jackson','d5100000-1111-0000-0000-00000000000a','verified'),
  -- a second untouched placeholder: A6b needs a pair that is still genuinely UNCLAIMED after
  -- the earlier attacks claim 'Prov Kid'
  ('d5100000-2222-0000-0000-000000000013','Spare Slot','d5100000-1111-0000-0000-00000000000a','provisional');

INSERT INTO public.player_teams (player_id,team_id,joined_on) VALUES
  ('d5100000-2222-0000-0000-00000000000a','d5100000-1111-0000-0000-00000000000a','2026-01-01'),
  ('d5100000-2222-0000-0000-00000000000b','d5100000-1111-0000-0000-00000000000b','2026-01-01'),
  ('d5100000-2222-0000-0000-00000000000c','d5100000-1111-0000-0000-00000000000a','2026-01-01'),
  ('d5100000-2222-0000-0000-000000000011','d5100000-1111-0000-0000-00000000000a','2026-01-01'),
  ('d5100000-2222-0000-0000-000000000012','d5100000-1111-0000-0000-00000000000a','2026-01-01'),
  ('d5100000-2222-0000-0000-000000000013','d5100000-1111-0000-0000-00000000000a','2026-01-01');

INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians) VALUES
  ('d5100000-0000-0000-0000-00000000000a','d5100000-2222-0000-0000-00000000000a','parent',true),
  ('d5100000-0000-0000-0000-00000000000b','d5100000-2222-0000-0000-00000000000b','parent',true),
  ('d5100000-0000-0000-0000-00000000000b','d5100000-2222-0000-0000-000000000012','parent',true);

INSERT INTO public.player_guardian_codes (player_id,code) VALUES
  ('d5100000-2222-0000-0000-00000000000c','DSPROVCD');

-- Privileged fixture rows. These CANNOT be created from inside the authenticated DO blocks:
-- parent_player_links_insert requires parent_user_id = auth.uid() (C.5's F14 closure), so no
-- client role can create a link for somebody else -- which is itself the correct behaviour.
--   * a second, NON-MANAGING guardian on Child A (for A4 / A13 / A19)
--   * the Org A coach also coaching Org B (the worst case for A5/A6)
--   * Child A also playing for Org B (the multi-team child, for A10)
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians)
VALUES ('d5100000-0000-0000-0000-00000000000e','d5100000-2222-0000-0000-00000000000a','guardian',false);
INSERT INTO public.team_memberships (team_id,user_id,role,status)
VALUES ('d5100000-1111-0000-0000-00000000000b','d5100000-0000-0000-0000-00000000000c','coach','confirmed');
INSERT INTO public.player_teams (player_id,team_id,joined_on)
VALUES ('d5100000-2222-0000-0000-00000000000a','d5100000-1111-0000-0000-00000000000b','2026-02-01');

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== SLICE D ADVERSARIAL SECURITY AUDIT (synthetic, will ROLLBACK) ==='; END $$;

DO $$
DECLARE
  coach   uuid := 'd5100000-0000-0000-0000-00000000000c';
  coach2  uuid := 'd5100000-0000-0000-0000-00000000000d';
  famA    uuid := 'd5100000-0000-0000-0000-00000000000a';
  famB    uuid := 'd5100000-0000-0000-0000-00000000000b';
  stranger uuid := 'd5100000-0000-0000-0000-00000000000e';
  sa      uuid := 'd5100000-0000-0000-0000-00000000000f';
  kidA    uuid := 'd5100000-2222-0000-0000-00000000000a';
  kidB    uuid := 'd5100000-2222-0000-0000-00000000000b';
  prov    uuid := 'd5100000-2222-0000-0000-00000000000c';
  same1   uuid := 'd5100000-2222-0000-0000-000000000011';
  same2   uuid := 'd5100000-2222-0000-0000-000000000012';
  spare   uuid := 'd5100000-2222-0000-0000-000000000013';
  outsider uuid := 'd5100000-0000-0000-0000-000000000099';
  st text; msg text; n int; v jsonb;

BEGIN
  -- helper: act as a user
  -- (inline set_config calls below; no helper function to avoid granting anything)

  -- ============ A1 — a coach grants HIMSELF guardian management ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.grant_guardian_management(prov, coach); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,60); END;
  RAISE NOTICE 'A1  coach grants himself management    -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL' END, coalesce('· '||msg,'');

  -- ============ A2 — a coach CONFIRMS himself as the manager ============
  st := null;
  BEGIN PERFORM public.coach_confirm_guardian_claim(prov, coach); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,60); END;
  RAISE NOTICE 'A2  coach confirms HIMSELF             -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL' END, coalesce('· '||msg,'');

  -- ============ A3 — first claimant of a provisional child gains authority? ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',stranger::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('DSPROVCD');
  SELECT count(*) INTO n FROM parent_player_links WHERE player_id=prov AND parent_user_id=stranger AND can_manage_guardians;
  RAISE NOTICE 'A3  first claimant is NOT auto-manager -> % (manager rows=%, state=%)',
    CASE WHEN n=0 THEN 'PASS claim != authority' ELSE 'FAIL first-claimer owns the child' END,
    n, (SELECT identity_state FROM players WHERE id=prov);

  -- ============ A9 — and with that (leaked) code, can they act on the child? ============
  st := null;
  BEGIN PERFORM public.remove_guardian(prov, stranger); st := 'self-removal allowed (fine)';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A9a leaked-code claimant may leave      -> % (self-removal must always work)',
    CASE WHEN st like 'self%' THEN 'PASS' ELSE 'REVIEW' END;
  -- re-link for the remaining tests
  PERFORM public.claim_or_link_guardian('DSPROVCD');
  st := null;
  BEGIN PERFORM public.update_player_identity(p_player_id => prov, p_name => 'HIJACKED'); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  -- NOTE: a claimant IS a linked guardian, so identity editing is allowed by design once
  -- they are family. The security boundary is guardian MANAGEMENT, not the name field.
  RAISE NOTICE 'A9b leaked-code claimant edits name     -> % (by design: they are now a linked guardian)',
    CASE WHEN st='ALLOWED' THEN 'allowed (documented)' ELSE 'blocked' END;
  UPDATE players SET name='Prov Kid' WHERE id=prov;

  -- ============ A4 — a guardian removes another family's guardian ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',stranger::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.remove_guardian(kidA, famA); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,50); END;
  RAISE NOTICE 'A4  non-guardian removes real family   -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL' END, coalesce('· '||msg,'');

  -- ============ A19 — can a manager strand the family by removing the last manager? ======
  PERFORM set_config('request.jwt.claims', json_build_object('sub',famA::text,'role','authenticated')::text, true);
  -- (the second, non-managing guardian is already in the fixture)
  st := null;
  BEGIN PERFORM public.remove_guardian(kidA, famA); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,60); END;
  RAISE NOTICE 'A19 last manager leaves w/ guardians   -> % %',
    CASE WHEN st='blocked' THEN 'PASS family cannot be stranded' ELSE 'FAIL' END, coalesce('· '||msg,'');

  -- ============ A5 — a coach reconciles two children from DIFFERENT families ============
  -- (coach already coaches BOTH orgs via the fixture: the worst case)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.reconcile_players(kidA, kidB, null, false, null, null, true); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,60); END;
  RAISE NOTICE 'A5  coach merges two families'' kids    -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL A CHILD WAS ABSORBED' END, coalesce('· '||msg,'');
  RAISE NOTICE 'A5b reconcile_authority for that coach  -> % -> %',
    coalesce(public.reconcile_authority(kidA, kidB), 'NULL'),
    CASE WHEN public.reconcile_authority(kidA,kidB) IS NULL THEN 'PASS' ELSE 'FAIL' END;

  -- ============ A6 — a coach forges the "same child" assertion ============
  st := null;
  BEGIN PERFORM public.link_players(kidA, kidB); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,60); END;
  RAISE NOTICE 'A6  coach forges lineage assertion     -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL forged the strongest non-guardian signal' END,
    coalesce('· '||msg,'');
  -- but a coach MAY link two unclaimed placeholders on his own team (authority case 1)
  st := null;
  BEGIN PERFORM public.link_players(same1, spare); st := 'allowed';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,40); END;
  RAISE NOTICE 'A6b coach links two UNCLAIMED spots    -> % (case 1 is meant to work) %',
    CASE WHEN st='allowed' THEN 'PASS' ELSE 'unexpectedly blocked' END, coalesce('· '||msg,'');

  -- ============ A7 — guardian merges without the other family's confirmation ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',famB::text,'role','authenticated')::text, true);
  st := null;
  -- famB holds BOTH kidB and same2, and same1 is unclaimed -> tries to absorb same1
  BEGIN PERFORM public.reconcile_players(same2, same1, null, false, null, null, true); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,60); END;
  RAISE NOTICE 'A7  guardian absorbs an unclaimed kid  -> % %',
    CASE WHEN st='blocked' THEN 'PASS needs a coach signature (case 4)' ELSE 'FAIL' END,
    coalesce('· '||msg,'');

  -- ============ A8 — are two same-name children ever suggested? ============
  SELECT count(*) INTO n FROM public.list_identity_conflicts()
   WHERE (player_a=same1 AND player_b=same2) OR (player_a=same2 AND player_b=same1);
  RAISE NOTICE 'A8  same-name pair surfaced as dupes   -> % (rows=%)',
    CASE WHEN n=0 THEN 'PASS names are never identity' ELSE 'FAIL name matching is back' END, n;
  -- the retired suggester has its own coach gate, so ask as the coach of that team
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM public.suggest_duplicate_players('d5100000-1111-0000-0000-00000000000a');
  RAISE NOTICE 'A8b suggest_duplicate_players rows     -> % -> %', n,
    CASE WHEN n=0 THEN 'PASS still retired' ELSE 'FAIL name matching is back' END;

  -- ============ A10 — cross-org enumeration ============
  -- (Child A already has a spell on Org B via the fixture: the multi-team child)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach2::text,'role','authenticated')::text, true);
  v := public.kid_team_audience(kidA);
  SELECT count(*) INTO n FROM jsonb_array_elements(v) e WHERE e->>'team_name'='Org A';
  RAISE NOTICE 'A10 Org B coach sees Org A team row    -> % (rows=%)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL cross-org leak' END, n;
  SELECT count(*) INTO n FROM jsonb_array_elements(v) e, jsonb_array_elements(e->'coaches') c
   WHERE c->>'name' LIKE '%' ;
  RAISE NOTICE 'A10b coach names visible to Org B coach = % (only their own team''s)', n;

  -- ============ A16 — a coach edits a CLAIMED child's identity ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.update_player_identity(p_player_id => kidA, p_name => 'COACH RENAMED'); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,55); END;
  RAISE NOTICE 'A16 coach renames a CLAIMED child      -> % %',
    CASE WHEN st='blocked' THEN 'PASS identity is family-owned' ELSE 'FAIL' END, coalesce('· '||msg,'');
  -- ...but may still name an UNCLAIMED placeholder (how every roster starts)
  st := null;
  BEGIN PERFORM public.update_player_identity(p_player_id => same1, p_name => 'Jackson S'); st := 'allowed';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A16b coach names an UNCLAIMED spot     -> % (carve-out must work)',
    CASE WHEN st='allowed' THEN 'PASS' ELSE 'FAIL roster building broken' END;

  -- ============ A15 — direct table writes (the PostgREST path) ============
  st := null;
  BEGIN
    INSERT INTO parent_player_links (parent_user_id, player_id, relationship, can_manage_guardians)
    VALUES (coach, kidA, 'parent', true);
    st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A15a coach self-links to a child direct -> % (D2b: definer-only writes)',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL any user could become a guardian' END;
  st := null;
  BEGIN UPDATE parent_player_links SET can_manage_guardians = true
         WHERE player_id=prov AND parent_user_id=coach;
        st := CASE WHEN FOUND THEN 'ALLOWED' ELSE 'no rows' END;
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A15b coach self-grants capability direct-> %',
    CASE WHEN st IN ('blocked','no rows') THEN 'PASS' ELSE 'FAIL' END;
  -- A15b only proved "no rows" because the coach holds no link on that child. The REAL
  -- escalation is a LINKED but non-managing guardian self-granting authority, which is what
  -- D2b closes. 'stranger' is a linked, non-managing guardian of Child A.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',stranger::text,'role','authenticated')::text, true);
  st := null;
  BEGIN UPDATE parent_player_links SET can_manage_guardians = true
         WHERE player_id=kidA AND parent_user_id=stranger;
        st := CASE WHEN FOUND THEN 'ALLOWED' ELSE 'no rows' END;
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A15b2 LINKED non-manager self-grants     -> % (is_primary_guardian=%)',
    CASE WHEN st IN ('blocked','no rows') THEN 'PASS' ELSE 'FAIL AUTHORITY MODEL DEFEATED' END,
    public.is_primary_guardian(kidA);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  st := null;
  BEGIN INSERT INTO players (name, team_id) VALUES ('Direct Insert','d5100000-1111-0000-0000-00000000000a');
        st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A15c coach direct-inserts a player     -> %',
    CASE WHEN st='blocked' THEN 'PASS definer RPCs only' ELSE 'FAIL' END;
  st := null;
  BEGIN UPDATE players SET merged_into_id = kidB, merged_at = now() WHERE id = same1;
        st := CASE WHEN FOUND THEN 'ALLOWED' ELSE 'no rows' END;
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A15d coach forges a tombstone directly -> %',
    CASE WHEN st IN ('blocked','no rows') THEN 'PASS' ELSE 'FAIL could retire any child' END;

  -- ============ A17 — dry run used to probe unrelated children ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',outsider::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.reconcile_players(kidA, kidB, null, true); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'A17 stranger dry-runs someone''s kids   -> %',
    CASE WHEN st='blocked' THEN 'PASS standing required' ELSE 'FAIL information leak' END;

  -- ============ A18 — the requester confirms their own request ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',famA::text,'role','authenticated')::text, true);
  DECLARE v_req uuid; BEGIN
    v_req := public.request_player_merge(kidA, kidB, 'attempt');
    st := null;
    BEGIN PERFORM public.confirm_player_merge(v_req); st := 'ALLOWED';
    EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,50); END;
    RAISE NOTICE 'A18 requester confirms own request     -> % %',
      CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL self-signed merge' END, coalesce('· '||msg,'');
  END;

  -- ============ A13 — super-admin recovery leaves consistent authority ============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',sa::text,'role','authenticated')::text, true);
  PERFORM public.admin_set_primary_guardian(kidA, stranger, 'audit test');
  SELECT count(*) INTO n FROM parent_player_links WHERE player_id=kidA AND can_manage_guardians;
  RAISE NOTICE 'A13 after recovery: managers=% and relationship agrees=% -> %',
    n,
    (SELECT bool_and((relationship='parent') = can_manage_guardians)
       FROM parent_player_links WHERE player_id=kidA),
    CASE WHEN n=1 AND (SELECT bool_and((relationship='parent') = can_manage_guardians)
                         FROM parent_player_links WHERE player_id=kidA)
         THEN 'PASS one coherent authority' ELSE 'FAIL divergence' END;

  -- ============ A11/A12 — retired ids ============
  -- retire same1 into same2 as super admin
  PERFORM public.reconcile_players(same2, same1, null, false, null, null, true);
  RAISE NOTICE 'A11 resolve_player_id(retired) = canonical -> %',
    CASE WHEN public.resolve_player_id(same1) = same2 THEN 'PASS' ELSE 'FAIL' END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM players WHERE id = same1;
  RAISE NOTICE 'A12 coach still sees the retired row  -> % (rows=%)',
    CASE WHEN n=0 THEN 'PASS hidden from rosters' ELSE 'FAIL ghost on the roster' END, n;
  SELECT count(*) INTO n FROM player_teams WHERE player_id = same1 AND left_on IS NULL;
  RAISE NOTICE 'A12b retired child still on a roster spell -> % (rows=%)',
    CASE WHEN n=0 THEN 'PASS spells moved' ELSE 'FAIL' END, n;
END $$;

-- ============ A14 — RLS/function dependence on legacy players.team_id ============
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.audit_legacy_player_column_dependence();
  RAISE NOTICE 'A14 objects still authorising via legacy players.team_id = % -> %', n,
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END;
END $$;

-- ============ merge_players stays closed (asserted, never called) ============
DO $$
DECLARE v_can boolean;
BEGIN
  v_can := has_function_privilege('authenticated','public.merge_players(uuid,uuid)','EXECUTE');
  RAISE NOTICE 'D0  merge_players executable by client -> % -> %', v_can,
    CASE WHEN NOT v_can THEN 'PASS still closed' ELSE 'FAIL reopened' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
