-- ============================================================================
-- test_d9_family_code_fast_path.sql — THE FAMILY-CODE FAST PATH HARNESS
--
-- Slice D9 makes a CHILD-SPECIFIC family code the thing that confers authority, while the
-- TEAM code stays entry-only. This harness pins the behaviour that makes that safe:
--
--   G1   first adult to redeem a family code on an unmanaged child BECOMES the manager
--   G2   ...and the code they used is ROTATED, so a screenshot of it is dead
--   G3   ...while a later redeemer of the NEW code gets entry only, never a second manager
--   G4   a coach self-claiming is ALLOWED but recorded (detail.self_coach) and announced
--   G5   a coach may READ a family code only while nobody manages the child
--   G6   ...and may regenerate it under exactly the same condition
--   G7   regenerate mints a row for a child that has no code at all (directly-seeded players)
--   G8   claim_roster_spot (the TEAM-code path) is UNCHANGED — entry without authority
--   G9   the 4-guardian cap still bites
--   G10  a child with guardians but NO manager is recoverable by family code, loudly
--   G11  the relationship <-> can_manage_guardians mirror is never broken
--   G12  an adult ALREADY linked without authority is upgraded by the family code, not ignored
--
-- SAFE: BEGIN ... ROLLBACK, synthetic fixtures only. Nothing here touches real data.
-- RUN:  psql "$LOCAL_DB_URL" -f test_d9_family_code_fast_path.sql
--
-- NOTE ON METHOD: RLS-sensitive reads run under SET LOCAL ROLE authenticated, and the
-- final state verification runs AFTER RESET ROLE. Checking final state while impersonating
-- gives RLS-filtered false negatives — that trap has produced wrong "PASS" lines before.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (id,email) VALUES
  ('d9000000-0000-0000-0000-000000000001','d9-parent1@example.test'),
  ('d9000000-0000-0000-0000-000000000002','d9-parent2@example.test'),
  ('d9000000-0000-0000-0000-000000000003','d9-coach1@example.test'),
  ('d9000000-0000-0000-0000-000000000004','d9-coach2@example.test'),
  ('d9000000-0000-0000-0000-000000000005','d9-mom@example.test'),
  ('d9000000-0000-0000-0000-000000000006','d9-g1@example.test'),
  ('d9000000-0000-0000-0000-000000000007','d9-g2@example.test'),
  ('d9000000-0000-0000-0000-000000000008','d9-g3@example.test'),
  ('d9000000-0000-0000-0000-000000000009','d9-g4@example.test'),
  ('d9000000-0000-0000-0000-00000000000a','d9-fifth@example.test'),
  ('d9000000-0000-0000-0000-00000000000b','d9-stuckmom@example.test');

INSERT INTO public.teams (id,name,sport,created_by_user_id,join_code,join_code_expires_at)
VALUES ('d9000000-1111-0000-0000-000000000001','D9 Team','Basketball',
        'd9000000-0000-0000-0000-000000000003','D9TEAM01', now()+interval '30 days');

-- TWO coaches: the self-claim announcement must reach the OTHER one.
INSERT INTO public.team_memberships (team_id,user_id,role,status) VALUES
  ('d9000000-1111-0000-0000-000000000001','d9000000-0000-0000-0000-000000000003','head_coach','confirmed'),
  ('d9000000-1111-0000-0000-000000000001','d9000000-0000-0000-0000-000000000004','coach','confirmed');

-- Six roster children, all on the team, all provisional.
INSERT INTO public.players (id,name,identity_state) VALUES
  ('d9000000-2222-0000-0000-00000000000a','Fast Path Kid','provisional'),
  ('d9000000-2222-0000-0000-00000000000b','Coach Kid','provisional'),
  ('d9000000-2222-0000-0000-00000000000c','Recovery Kid','provisional'),
  ('d9000000-2222-0000-0000-00000000000d','Codeless Kid','provisional'),
  ('d9000000-2222-0000-0000-00000000000e','Roster Spot Kid','provisional'),
  ('d9000000-2222-0000-0000-00000000000f','Coach Read Kid','provisional'),
  ('d9000000-2222-0000-0000-000000000010','Full Kid','provisional'),
  ('d9000000-2222-0000-0000-000000000011','Stuck Mom Kid','provisional');

INSERT INTO public.player_teams (player_id,team_id,joined_on)
SELECT id,'d9000000-1111-0000-0000-000000000001','2026-01-05'
  FROM public.players WHERE id::text LIKE 'd9000000-2222-%';

-- Family codes. "Codeless Kid" deliberately has NO row — that is the directly-seeded case
-- (the six real Demo Warriors 14U children), and G7 proves no backfill is needed.
INSERT INTO public.player_guardian_codes (player_id,code) VALUES
  ('d9000000-2222-0000-0000-00000000000a','D9CODEAA'),
  ('d9000000-2222-0000-0000-00000000000b','D9CODEBB'),
  ('d9000000-2222-0000-0000-00000000000c','D9CODECC'),
  ('d9000000-2222-0000-0000-00000000000e','D9CODEEE'),
  ('d9000000-2222-0000-0000-00000000000f','D9CODEGG'),
  ('d9000000-2222-0000-0000-000000000010','D9CODEFF'),
  ('d9000000-2222-0000-0000-000000000011','D9CODEHH');

-- Recovery Kid: a guardian exists (claimed by team code, never confirmed) but NOBODY manages.
-- This is the state the no-manager rule is designed to rescue without a coach tap.
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians)
VALUES ('d9000000-0000-0000-0000-000000000005','d9000000-2222-0000-0000-00000000000c','guardian',false);

-- Stuck Mom Kid: the commonest stuck case. The real mum claimed with the TEAM code, so she is
-- linked with no authority, and no coach ever confirmed her. G12 proves that when the coach
-- finally sends her the family code, presenting it upgrades HER existing link rather than
-- telling her nothing happened.
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians)
VALUES ('d9000000-0000-0000-0000-00000000000b','d9000000-2222-0000-0000-000000000011','guardian',false);

-- Full Kid: at the 4-guardian cap.
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians)
SELECT u,'d9000000-2222-0000-0000-000000000010','guardian',false
  FROM unnest(ARRAY['d9000000-0000-0000-0000-000000000006'::uuid,
                    'd9000000-0000-0000-0000-000000000007',
                    'd9000000-0000-0000-0000-000000000008',
                    'd9000000-0000-0000-0000-000000000009']) u;

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== D9 FAMILY-CODE FAST PATH (synthetic, will ROLLBACK) ==='; END $$;

-- ---------------------------------------------------------------------------
-- G1/G2/G3 — first redeemer becomes manager; code rotates; later redeemer does not
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  parent1 uuid := 'd9000000-0000-0000-0000-000000000001';
  parent2 uuid := 'd9000000-0000-0000-0000-000000000002';
  kid     uuid := 'd9000000-2222-0000-0000-00000000000a';
  st text; msg text; v_code_before text; v_code_after text; v_new text;
  v_manages boolean; v_basis text; v_rel text; v_state text;
BEGIN
  SELECT code INTO v_code_before FROM player_guardian_codes WHERE player_id = kid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent1::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('D9CODEAA');

  SELECT can_manage_guardians, verification_basis, relationship
    INTO v_manages, v_basis, v_rel
    FROM parent_player_links WHERE player_id = kid AND parent_user_id = parent1;
  SELECT identity_state INTO v_state FROM players WHERE id = kid;

  RAISE NOTICE 'G1  first family-code redeemer -> manages=% basis=% rel=% state=% -> %',
    v_manages, v_basis, v_rel, v_state,
    CASE WHEN v_manages AND v_basis='family_code' AND v_rel='parent' AND v_state='verified'
         THEN 'PASS manager with no coach tap' ELSE 'FAIL' END;

  SELECT code INTO v_code_after FROM player_guardian_codes WHERE player_id = kid;
  RAISE NOTICE 'G2a code rotated on grant -> changed=% -> %', (v_code_after IS DISTINCT FROM v_code_before),
    CASE WHEN v_code_after IS DISTINCT FROM v_code_before THEN 'PASS' ELSE 'FAIL screenshot still live' END;

  -- G2b — the presented code is now DEAD for everyone else.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent2::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.claim_or_link_guardian('D9CODEAA'); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,40); END;
  RAISE NOTICE 'G2b the used code no longer works -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL rotated code still redeemable' END, coalesce('· '||msg,'');

  -- G3 — the NEW code still adds guardians, but confers nothing.
  v_new := v_code_after;
  PERFORM public.claim_or_link_guardian(v_new);
  SELECT can_manage_guardians INTO v_manages
    FROM parent_player_links WHERE player_id = kid AND parent_user_id = parent2;
  RAISE NOTICE 'G3  second redeemer (new code) -> manages=% -> %', v_manages,
    CASE WHEN v_manages IS FALSE THEN 'PASS entry only, one manager per child' ELSE 'FAIL second manager created' END;
END $$;

-- ---------------------------------------------------------------------------
-- G4 (action) — a coach self-claims. Audit + notification assertions are in PHASE B,
-- because admin_audit_log is super-admin-read and notifications are recipient-scoped:
-- asking those questions while impersonating returns nothing and fakes a pass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  coach1 uuid := 'd9000000-0000-0000-0000-000000000003';
  kid    uuid := 'd9000000-2222-0000-0000-00000000000b';
  v_manages boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach1::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('D9CODEBB');

  SELECT can_manage_guardians INTO v_manages
    FROM parent_player_links WHERE player_id = kid AND parent_user_id = coach1;
  RAISE NOTICE 'G4a coach self-claim NOT blocked -> manages=% -> %', v_manages,
    CASE WHEN v_manages THEN 'PASS coach-parents keep working' ELSE 'FAIL blocked (Adam chose loud, not blocking)' END;
END $$;

-- ---------------------------------------------------------------------------
-- G5/G6/G7 — coach read + regenerate, gated on "nobody manages the child"
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  coach1   uuid := 'd9000000-0000-0000-0000-000000000003';
  unclaimed uuid := 'd9000000-2222-0000-0000-00000000000f';  -- Coach Read Kid, nobody manages
  managed   uuid := 'd9000000-2222-0000-0000-00000000000a';  -- Fast Path Kid, now managed
  codeless  uuid := 'd9000000-2222-0000-0000-00000000000d';
  n_unclaimed int; n_managed int; st text; msg text; c text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach1::text,'role','authenticated')::text, true);

  -- G5 — RLS, read under the authenticated role so the policy actually applies.
  SELECT count(*) INTO n_unclaimed FROM player_guardian_codes WHERE player_id = unclaimed;
  SELECT count(*) INTO n_managed   FROM player_guardian_codes WHERE player_id = managed;
  RAISE NOTICE 'G5a coach reads code of UNMANAGED child -> rows=% -> %', n_unclaimed,
    CASE WHEN n_unclaimed=1 THEN 'PASS the share UI can finally render' ELSE 'FAIL still invisible' END;
  RAISE NOTICE 'G5b coach reads code of MANAGED child   -> rows=% -> %', n_managed,
    CASE WHEN n_managed=0 THEN 'PASS access lapsed by itself' ELSE 'FAIL coach holds a claimed family''s credential' END;

  -- G6 — regenerate under the same condition.
  st := null;
  BEGIN c := public.regenerate_guardian_code(unclaimed); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,40); END;
  RAISE NOTICE 'G6a coach regenerates for UNMANAGED kid -> % -> %', st,
    CASE WHEN st='ALLOWED' AND c IS NOT NULL THEN 'PASS "Get invite code" works' ELSE 'FAIL '||coalesce(msg,'') END;

  st := null;
  BEGIN PERFORM public.regenerate_guardian_code(managed); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; END;
  RAISE NOTICE 'G6b coach regenerates for MANAGED kid   -> % -> %', st,
    CASE WHEN st='blocked' THEN 'PASS family''s credential is the family''s' ELSE 'FAIL coach can reset a claimed child''s code' END;

  -- G7 — a child with no code row at all.
  st := null; c := null;
  BEGIN c := public.regenerate_guardian_code(codeless); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,40); END;
  RAISE NOTICE 'G7  mint for a child with NO code row   -> % code=% -> %', st, coalesce(c,'(null)'),
    CASE WHEN st='ALLOWED' AND c IS NOT NULL
           AND EXISTS (SELECT 1 FROM player_guardian_codes WHERE player_id=codeless AND code=c)
         THEN 'PASS no backfill needed' ELSE 'FAIL '||coalesce(msg,'') END;
END $$;

-- ---------------------------------------------------------------------------
-- G8 — the TEAM-code path must be untouched
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  parent1 uuid := 'd9000000-0000-0000-0000-000000000001';
  kid     uuid := 'd9000000-2222-0000-0000-00000000000e';
  v_manages boolean; v_state text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent1::text,'role','authenticated')::text, true);
  PERFORM public.claim_roster_spot('D9TEAM01', kid);

  SELECT can_manage_guardians INTO v_manages
    FROM parent_player_links WHERE player_id=kid AND parent_user_id=parent1;
  SELECT identity_state INTO v_state FROM players WHERE id=kid;
  RAISE NOTICE 'G8a team code still grants NO authority -> manages=% state=% -> %', v_manages, v_state,
    CASE WHEN v_manages IS FALSE THEN 'PASS unchanged' ELSE 'FAIL team code now confers authority' END;
END $$;

-- ---------------------------------------------------------------------------
-- G9 — the 4-guardian cap
-- ---------------------------------------------------------------------------
DO $$
DECLARE fifth uuid := 'd9000000-0000-0000-0000-00000000000a'; st text; msg text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',fifth::text,'role','authenticated')::text, true);
  st := null;
  BEGIN PERFORM public.claim_or_link_guardian('D9CODEFF'); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,45); END;
  RAISE NOTICE 'G9  5th guardian without a seat -> % %',
    CASE WHEN st='blocked' THEN 'PASS cap intact' ELSE 'FAIL cap bypassed by the fast path' END,
    coalesce('· '||msg,'');
END $$;

-- ---------------------------------------------------------------------------
-- G10 (action) — a child with guardians but NO manager is rescued by the family code.
-- All three assertions are in PHASE B: they read the OTHER guardian's link row, a
-- notification addressed to her, and an audit row — none of which parent1 can see.
-- ---------------------------------------------------------------------------
DO $$
DECLARE parent1 uuid := 'd9000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent1::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('D9CODECC');
  RAISE NOTICE 'G10  (action performed — assertions in phase B)';
END $$;

-- ---------------------------------------------------------------------------
-- G12 — the SAME adult, already linked with no authority, presents the family code
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  mom uuid := 'd9000000-0000-0000-0000-00000000000b';
  kid uuid := 'd9000000-2222-0000-0000-000000000011';
  v_manages boolean; v_basis text; v_rel text; v_links int;
  v_code_before text; v_code_after text;
BEGIN
  SELECT code INTO v_code_before FROM player_guardian_codes WHERE player_id = kid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',mom::text,'role','authenticated')::text, true);
  PERFORM public.claim_or_link_guardian('D9CODEHH');

  SELECT can_manage_guardians, verification_basis, relationship
    INTO v_manages, v_basis, v_rel
    FROM parent_player_links WHERE player_id=kid AND parent_user_id=mom;
  SELECT count(*) INTO v_links FROM parent_player_links WHERE player_id=kid;
  SELECT code INTO v_code_after FROM player_guardian_codes WHERE player_id = kid;

  RAISE NOTICE 'G12a already-linked adult presents family code -> manages=% basis=% rel=% -> %',
    v_manages, v_basis, v_rel,
    CASE WHEN v_manages AND v_basis='family_code' AND v_rel='parent'
         THEN 'PASS existing link UPGRADED, not ignored' ELSE 'FAIL she stays stuck' END;
  RAISE NOTICE 'G12b ...without creating a duplicate link -> links=% -> %', v_links,
    CASE WHEN v_links=1 THEN 'PASS' ELSE 'FAIL duplicate guardian row' END;
  RAISE NOTICE 'G12c ...and the code still rotates -> changed=% -> %',
    (v_code_after IS DISTINCT FROM v_code_before),
    CASE WHEN v_code_after IS DISTINCT FROM v_code_before THEN 'PASS' ELSE 'FAIL' END;

END $$;

RESET ROLE;

-- ===========================================================================
-- PHASE B — assertions that require an observer who can SEE.
-- Run as the table owner (RLS bypassed) because:
--   admin_audit_log     read policy = is_super_admin()
--   notifications       read policy = recipient_user_id = auth.uid()
--   parent_player_links read policy = self / super admin / coach-of-child
-- Asking these questions while impersonating a claimant returns zero rows and
-- produces a PASS that proves nothing. Identical assertions, visible observer.
-- ===========================================================================
DO $$
DECLARE
  coach1  uuid := 'd9000000-0000-0000-0000-000000000003';
  coach2  uuid := 'd9000000-0000-0000-0000-000000000004';
  parent1 uuid := 'd9000000-0000-0000-0000-000000000001';
  mom     uuid := 'd9000000-0000-0000-0000-000000000005';
  stuckmom uuid := 'd9000000-0000-0000-0000-00000000000b';
  kid_b   uuid := 'd9000000-2222-0000-0000-00000000000b';  -- coach self-claim
  kid_c   uuid := 'd9000000-2222-0000-0000-00000000000c';  -- recovery
  kid_e   uuid := 'd9000000-2222-0000-0000-00000000000e';  -- team-code path
  kid_h   uuid := 'd9000000-2222-0000-0000-000000000011';  -- self-upgrade
  v_self text; v_n int; v_mgr boolean; v_mom_mgr boolean; v_prior text; v_existing text;
BEGIN
  -- G4b/G4c/G4d
  SELECT detail->>'self_coach' INTO v_self FROM admin_audit_log
   WHERE action='claim_or_link_guardian' AND target_id=kid_b AND actor_user_id=coach1
   ORDER BY id DESC LIMIT 1;
  RAISE NOTICE 'G4b coach self-claim TAGGED self_coach=% -> %', coalesce(v_self,'<missing>'),
    CASE WHEN v_self='true' THEN 'PASS detectable in one query' ELSE 'FAIL silent coach self-appointment' END;

  SELECT count(*) INTO v_n FROM notifications
   WHERE type='guardian_self_claimed_by_coach' AND target_player_id=kid_b AND recipient_user_id=coach2;
  RAISE NOTICE 'G4c ...the OTHER coach is told -> rows=% -> %', v_n,
    CASE WHEN v_n=1 THEN 'PASS loud' ELSE 'FAIL nobody hears it' END;

  SELECT count(*) INTO v_n FROM notifications
   WHERE type='guardian_self_claimed_by_coach' AND target_player_id=kid_b AND recipient_user_id=coach1;
  RAISE NOTICE 'G4d ...and not the claimer themselves -> rows=% -> %', v_n,
    CASE WHEN v_n=0 THEN 'PASS' ELSE 'FAIL self-notified' END;

  -- G8b — the team-code path must still summon a coach
  SELECT count(*) INTO v_n FROM notifications
   WHERE type='guardian_claim_awaiting_confirmation' AND target_player_id=kid_e;
  RAISE NOTICE 'G8b team code still asks a coach to confirm -> rows=% -> %', v_n,
    CASE WHEN v_n >= 1 THEN 'PASS fallback path intact' ELSE 'FAIL confirmation prompt lost' END;

  -- G10a/G10b/G10c
  SELECT can_manage_guardians INTO v_mgr FROM parent_player_links
   WHERE player_id=kid_c AND parent_user_id=parent1;
  SELECT can_manage_guardians INTO v_mom_mgr FROM parent_player_links
   WHERE player_id=kid_c AND parent_user_id=mom;
  RAISE NOTICE 'G10a unconfirmed-claim child rescued -> newcomer manages=% prior guardian manages=% -> %',
    v_mgr, v_mom_mgr,
    CASE WHEN v_mgr AND v_mom_mgr IS FALSE THEN 'PASS no coach tap needed' ELSE 'FAIL' END;

  SELECT count(*) INTO v_n FROM notifications
   WHERE type='guardian_manager_established' AND target_player_id=kid_c AND recipient_user_id=mom;
  RAISE NOTICE 'G10b ...and the existing guardian is TOLD -> rows=% -> %', v_n,
    CASE WHEN v_n=1 THEN 'PASS loud' ELSE 'FAIL silent takeover of a child with a guardian' END;

  SELECT detail->>'prior_guardian_count' INTO v_prior FROM admin_audit_log
   WHERE action='claim_or_link_guardian' AND target_id=kid_c AND actor_user_id=parent1
   ORDER BY id DESC LIMIT 1;
  RAISE NOTICE 'G10c ...and audit records prior_guardian_count=% -> %', coalesce(v_prior,'<missing>'),
    CASE WHEN v_prior='1' THEN 'PASS' ELSE 'FAIL' END;

  -- G12d — a self-upgrade must not notify the person who performed it
  SELECT count(*) INTO v_n FROM notifications
   WHERE type='guardian_manager_established' AND target_player_id=kid_h AND recipient_user_id=stuckmom;
  RAISE NOTICE 'G12d self-upgrade does not notify herself -> rows=% -> %', v_n,
    CASE WHEN v_n=0 THEN 'PASS' ELSE 'FAIL self-notified' END;

  SELECT detail->>'granted_to_existing_link' INTO v_existing FROM admin_audit_log
   WHERE action='claim_or_link_guardian' AND target_id=kid_h AND actor_user_id=stuckmom
   ORDER BY id DESC LIMIT 1;
  RAISE NOTICE 'G12e ...and audit marks granted_to_existing_link=% -> %', coalesce(v_existing,'<missing>'),
    CASE WHEN v_existing='true' THEN 'PASS upgrade is distinguishable from a new link' ELSE 'FAIL' END;
END $$;

-- ---------------------------------------------------------------------------
-- G11 — invariants, verified WITHOUT impersonation so RLS cannot fake a pass
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad int; v_multi int;
BEGIN
  SELECT count(*) INTO v_bad FROM parent_player_links
   WHERE (relationship='parent') <> can_manage_guardians;
  RAISE NOTICE 'G11a relationship <-> capability mirror -> broken rows=% -> %', v_bad,
    CASE WHEN v_bad=0 THEN 'PASS' ELSE 'FAIL mirror drifted' END;

  SELECT count(*) INTO v_multi FROM (
    SELECT player_id FROM parent_player_links WHERE can_manage_guardians
     GROUP BY player_id HAVING count(*) > 1) x;
  RAISE NOTICE 'G11b children with >1 manager via D9  -> %s=% -> %', 'child', v_multi,
    CASE WHEN v_multi=0 THEN 'PASS' ELSE 'FAIL fast path minted a second manager' END;

  RAISE NOTICE 'G11c every D9 grant carries basis=family_code -> %',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM parent_player_links
       WHERE can_manage_guardians AND verification_basis IS NULL
         AND player_id::text LIKE 'd9000000-2222-%')
    THEN 'PASS traceable for rollback' ELSE 'FAIL untraceable grant' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
