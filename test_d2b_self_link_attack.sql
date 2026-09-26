-- ============================================================================
-- test_d2b_self_link_attack.sql — STANDING REGRESSION FOR THE CRITICAL D2b FINDING
--
-- This is the exact attack chain found by the Slice D adversarial audit, kept as its own file
-- so it can be re-run on demand and after every future change to parent_player_links.
--
-- THE PERMANENT INVARIANT (Adam, 2026-09-26):
--   A client must NEVER regain direct INSERT/UPDATE/DELETE on parent_player_links on the basis
--   of `parent_user_id = auth.uid()`. Guardian-link mutation stays in the definer RPCs.
--
-- WHAT IT PROVES, in order:
--   STEP 1  a total stranger cannot self-link as guardian to an arbitrary child
--   STEP 2  a LINKED but non-managing guardian cannot self-grant can_manage_guardians
--   STEP 3  they cannot evict the real family
--   STEP 4  the policies are still the locked-down shape (not just the trigger doing the work)
--   STEP 5  the LEGITIMATE paths still work — the lockdown must not break real families
--
-- SAFE: BEGIN ... ROLLBACK, synthetic fixtures only.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (id,email) VALUES
  ('d2b00000-0000-0000-0000-000000000001','d2b-realparent@example.test'),
  ('d2b00000-0000-0000-0000-000000000002','d2b-attacker@example.test'),
  ('d2b00000-0000-0000-0000-000000000003','d2b-colinked@example.test'),
  ('d2b00000-0000-0000-0000-000000000004','d2b-coach@example.test');

INSERT INTO public.teams (id,name,sport,created_by_user_id,join_code,join_code_expires_at)
VALUES ('d2b00000-1111-0000-0000-000000000001','D2b Team','Basketball',
        'd2b00000-0000-0000-0000-000000000004','D2BTEAM1', now()+interval '30 days');
INSERT INTO public.team_memberships (team_id,user_id,role,status)
VALUES ('d2b00000-1111-0000-0000-000000000001','d2b00000-0000-0000-0000-000000000004','head_coach','confirmed');

INSERT INTO public.players (id,name,team_id,identity_state)
VALUES ('d2b00000-2222-0000-0000-000000000001','Victim Child','d2b00000-1111-0000-0000-000000000001','verified'),
       ('d2b00000-2222-0000-0000-000000000002','Fresh Placeholder','d2b00000-1111-0000-0000-000000000001','provisional');
INSERT INTO public.player_teams (player_id,team_id,joined_on) VALUES
  ('d2b00000-2222-0000-0000-000000000001','d2b00000-1111-0000-0000-000000000001','2026-01-01'),
  ('d2b00000-2222-0000-0000-000000000002','d2b00000-1111-0000-0000-000000000001','2026-01-01');

-- the real family, and a second guardian who does NOT manage
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians) VALUES
  ('d2b00000-0000-0000-0000-000000000001','d2b00000-2222-0000-0000-000000000001','parent',true),
  ('d2b00000-0000-0000-0000-000000000003','d2b00000-2222-0000-0000-000000000001','guardian',false);
INSERT INTO public.player_guardian_codes (player_id,code)
VALUES ('d2b00000-2222-0000-0000-000000000002','D2BFRESH');

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== D2b SELF-LINK ATTACK REGRESSION (synthetic, will ROLLBACK) ==='; END $$;

DO $$
DECLARE
  real_parent uuid := 'd2b00000-0000-0000-0000-000000000001';
  attacker    uuid := 'd2b00000-0000-0000-0000-000000000002';
  colinked    uuid := 'd2b00000-0000-0000-0000-000000000003';
  victim      uuid := 'd2b00000-2222-0000-0000-000000000001';
  fresh       uuid := 'd2b00000-2222-0000-0000-000000000002';
  st text; n int;
BEGIN
  -- STEP 1 — the original hole: self-link to ANY child, no code, via a direct write
  PERFORM set_config('request.jwt.claims', json_build_object('sub',attacker::text,'role','authenticated')::text, true);
  st := null;
  BEGIN
    INSERT INTO parent_player_links (parent_user_id, player_id, relationship)
    VALUES (attacker, victim, 'parent');
    st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'D2b-1 stranger self-links to any child   -> %',
    CASE WHEN st='blocked' THEN 'PASS blocked' ELSE 'FAIL CRITICAL — reopened' END;
  RAISE NOTICE 'D2b-2 ...and is_linked_parent stays FALSE -> % (%)',
    CASE WHEN NOT public.is_linked_parent(victim) THEN 'PASS' ELSE 'FAIL family-level access gained' END,
    public.is_linked_parent(victim);

  -- STEP 2 — a LINKED non-manager self-grants authority
  PERFORM set_config('request.jwt.claims', json_build_object('sub',colinked::text,'role','authenticated')::text, true);
  st := null;
  BEGIN
    UPDATE parent_player_links SET can_manage_guardians = true
     WHERE player_id = victim AND parent_user_id = colinked;
    st := CASE WHEN FOUND THEN 'ALLOWED' ELSE 'no rows' END;
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'D2b-3 linked non-manager self-grants     -> % (is_primary_guardian=%)',
    CASE WHEN st IN ('blocked','no rows') THEN 'PASS' ELSE 'FAIL AUTHORITY MODEL DEFEATED' END,
    public.is_primary_guardian(victim);

  -- and via the descriptive mirror, which is just as good an escalation if it is writable
  st := null;
  BEGIN
    UPDATE parent_player_links SET relationship = 'parent'
     WHERE player_id = victim AND parent_user_id = colinked;
    st := CASE WHEN FOUND THEN 'ALLOWED' ELSE 'no rows' END;
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'D2b-4 linked non-manager rewrites mirror -> %',
    CASE WHEN st IN ('blocked','no rows') THEN 'PASS' ELSE 'FAIL' END;

  -- STEP 3 — evict the real family by a direct DELETE (bypassing remove_guardian's guards)
  st := null;
  BEGIN
    DELETE FROM parent_player_links WHERE player_id = victim AND parent_user_id = real_parent;
    st := CASE WHEN FOUND THEN 'ALLOWED' ELSE 'no rows' END;
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  -- Count as the REAL PARENT, not as the attacker: parent_player_links_read only shows an adult
  -- their OWN rows, so counting while still impersonating the attacker returns 0 because the row
  -- is INVISIBLE to them, not because it was deleted. That false negative is exactly what the
  -- first run of this file reported, and it would have looked like a critical regression.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',real_parent::text,'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM parent_player_links WHERE player_id=victim AND parent_user_id=real_parent;
  RAISE NOTICE 'D2b-5 direct DELETE of the real parent   -> % (attempt=%, real parent rows remaining=%)',
    CASE WHEN st IN ('blocked','no rows') AND n=1 THEN 'PASS' ELSE 'FAIL REAL FAMILY EVICTED' END, st, n;

  -- STEP 5 — the legitimate paths must still work
  PERFORM set_config('request.jwt.claims', json_build_object('sub',attacker::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.claim_or_link_guardian('D2BFRESH'); st := 'ok';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,50); END;
  RAISE NOTICE 'D2b-6 legitimate code claim still works  -> % (linked=%)', st,
    public.is_linked_parent(fresh);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',real_parent::text,'role','authenticated')::text, true);
  RAISE NOTICE 'D2b-7 real family keeps link+authority   -> % / %',
    public.is_linked_parent(victim), public.is_primary_guardian(victim);
  st := null;
  BEGIN PERFORM public.set_logistics_alerts(victim, false); st := 'ok';
  EXCEPTION WHEN OTHERS THEN st := 'ERROR: '||left(SQLERRM,50); END;
  RAISE NOTICE 'D2b-8 family preference RPC still works  -> %', st;
END $$;

-- STEP 4 — the POLICIES themselves, not just the trigger
RESET ROLE;
DO $$
DECLARE r record; v_bad int := 0;
BEGIN
  FOR r IN SELECT policyname, cmd, coalesce(qual, with_check) AS expr
             FROM pg_policies
            WHERE schemaname='public' AND tablename='parent_player_links'
              AND cmd IN ('INSERT','UPDATE','DELETE')
  LOOP
    IF r.expr ILIKE '%parent_user_id%auth.uid%' THEN
      v_bad := v_bad + 1;
      RAISE NOTICE 'D2b-9 !! % (%) still has a parent_user_id = auth.uid() write branch: %',
        r.policyname, r.cmd, left(r.expr,80);
    END IF;
  END LOOP;
  RAISE NOTICE 'D2b-9 write policies with a self-link branch = % -> %', v_bad,
    CASE WHEN v_bad=0 THEN 'PASS invariant holds' ELSE 'FAIL INVARIANT VIOLATED' END;
  RAISE NOTICE 'D2b-10 authority-guard trigger present    -> %',
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                       WHERE tgrelid='public.parent_player_links'::regclass
                         AND tgname='trg_guard_guardian_link_authority' AND NOT tgisinternal)
         THEN 'PASS' ELSE 'FAIL belt-and-braces missing' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
