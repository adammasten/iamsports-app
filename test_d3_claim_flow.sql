-- ============================================================================
-- test_d3_claim_flow.sql — THE CLAIM-FLOW HARNESS (the first-claimer inversion fix)
--
-- Covers the path the reworked app/join-team.tsx drives, end to end at the database level:
--
--   F1  my_claimable_children() offers the parent's existing children, with no name filtering
--   F2  "This is my existing player" CONSOLIDATES instead of creating a second identity
--   F3  ...and the coach's roster history (clips/tags/lineups/spells) lands on the family's child
--   F4  ...and is idempotent on the request id (a double-tap cannot merge twice)
--   F5  "No, new to me" links WITHOUT conferring authority, and prompts a coach confirmation
--   F6  the coach confirmation grants the CLAIMANT authority and the coach nothing
--   F7  a parent cannot pass someone else's child as "their existing player"
--   F8  a parent cannot use a valid code to absorb a roster spot that ALREADY has a family
--   F9  the whole flow never leaves two records for one human
--
-- SAFE: BEGIN ... ROLLBACK, synthetic fixtures only.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (id,email) VALUES
  ('d3000000-0000-0000-0000-000000000001','d3-parent@example.test'),
  ('d3000000-0000-0000-0000-000000000002','d3-otherparent@example.test'),
  ('d3000000-0000-0000-0000-000000000003','d3-coach@example.test');

INSERT INTO public.teams (id,name,sport,created_by_user_id,join_code,join_code_expires_at)
VALUES ('d3000000-1111-0000-0000-000000000001','D3 Team','Basketball',
        'd3000000-0000-0000-0000-000000000003','D3TEAM01', now()+interval '30 days');
INSERT INTO public.team_memberships (team_id,user_id,role,status)
VALUES ('d3000000-1111-0000-0000-000000000001','d3000000-0000-0000-0000-000000000003','head_coach','confirmed');

-- The family's existing child (created by them, on no team yet)
INSERT INTO public.players (id,name,identity_state,created_by_user_id)
VALUES ('d3000000-2222-0000-0000-000000000001','Lars Mine','verified','d3000000-0000-0000-0000-000000000001');
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians)
VALUES ('d3000000-0000-0000-0000-000000000001','d3000000-2222-0000-0000-000000000001','parent',true);

-- The coach's roster entry for the SAME human, carrying real history
INSERT INTO public.players (id,name,team_id,identity_state,photo_path)
VALUES ('d3000000-2222-0000-0000-000000000002','Lars','d3000000-1111-0000-0000-000000000001','provisional','photos/coach-lars.jpg');
INSERT INTO public.player_teams (player_id,team_id,joined_on,jersey_number)
VALUES ('d3000000-2222-0000-0000-000000000002','d3000000-1111-0000-0000-000000000001','2026-01-05','7');

-- A DIFFERENT family's child on the same roster (for F8)
INSERT INTO public.players (id,name,team_id,identity_state)
VALUES ('d3000000-2222-0000-0000-000000000003','Someone Else','d3000000-1111-0000-0000-000000000001','verified');
INSERT INTO public.player_teams (player_id,team_id,joined_on)
VALUES ('d3000000-2222-0000-0000-000000000003','d3000000-1111-0000-0000-000000000001','2026-01-05');
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians)
VALUES ('d3000000-0000-0000-0000-000000000002','d3000000-2222-0000-0000-000000000003','parent',true);

-- A third, untouched placeholder for the "new to me" path (F5/F6)
INSERT INTO public.players (id,name,team_id,identity_state)
VALUES ('d3000000-2222-0000-0000-000000000004','Fresh Kid','d3000000-1111-0000-0000-000000000001','provisional');
INSERT INTO public.player_teams (player_id,team_id,joined_on)
VALUES ('d3000000-2222-0000-0000-000000000004','d3000000-1111-0000-0000-000000000001','2026-01-05');

-- give the coach's Lars entry real film history
INSERT INTO public.videos (id,team_id,uploaded_by_user_id,url,label)
VALUES ('d3000000-3333-0000-0000-000000000001','d3000000-1111-0000-0000-000000000001','d3000000-0000-0000-0000-000000000003','d3/g.mp4','Game');
INSERT INTO public.clips (id,video_id,start_time,end_time) VALUES
  ('d3000000-4444-0000-0000-000000000001','d3000000-3333-0000-0000-000000000001',1,5),
  ('d3000000-4444-0000-0000-000000000002','d3000000-3333-0000-0000-000000000001',6,10);
-- ensure_player_tag already made the chip when the spell was inserted; tag those clips to it
INSERT INTO public.clip_tags (clip_id, tag_id, bundle_number, stat_side)
SELECT c.id, t.id, 1, 'us'
  FROM public.clips c, public.tags t
 WHERE c.id IN ('d3000000-4444-0000-0000-000000000001','d3000000-4444-0000-0000-000000000002')
   AND t.player_id = 'd3000000-2222-0000-0000-000000000002' AND t.category='players';

-- BEFORE snapshot, taken PRIVILEGED. Measuring raw tables from inside an impersonated block
-- is RLS-filtered: the parent is not a team member, so tags/clip_tags would read 0 and a
-- perfectly good fixture would look empty. Actions run as the user; verification does not.
CREATE TEMP TABLE d3_before AS
SELECT (SELECT count(*) FROM clip_tags ct JOIN tags t ON t.id=ct.tag_id
         WHERE t.player_id IN ('d3000000-2222-0000-0000-000000000001','d3000000-2222-0000-0000-000000000002')) AS clip_tags_both,
       (SELECT count(*) FROM tags WHERE player_id='d3000000-2222-0000-0000-000000000002') AS roster_chips;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM d3_before;
  RAISE NOTICE 'FIXTURE roster chips=% tagged clip_tags(both)=% -> %', r.roster_chips, r.clip_tags_both,
    CASE WHEN r.roster_chips=1 AND r.clip_tags_both=2 THEN 'ok' ELSE 'FIXTURE BROKEN' END;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== D3 CLAIM FLOW (synthetic, will ROLLBACK) ==='; END $$;

DO $$
DECLARE
  parent uuid := 'd3000000-0000-0000-0000-000000000001';
  coach  uuid := 'd3000000-0000-0000-0000-000000000003';
  mine   uuid := 'd3000000-2222-0000-0000-000000000001';
  roster uuid := 'd3000000-2222-0000-0000-000000000002';
  theirs uuid := 'd3000000-2222-0000-0000-000000000003';
  fresh  uuid := 'd3000000-2222-0000-0000-000000000004';
  st text; msg text; n int; v jsonb; v2 jsonb; clips_before int; clips_after int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent::text,'role','authenticated')::text, true);

  -- F1 — existing children offered, no name filtering
  SELECT count(*) INTO n FROM public.my_claimable_children();
  RAISE NOTICE 'F1  my_claimable_children -> % child(ren) -> %', n,
    CASE WHEN n=1 THEN 'PASS offered before any roster spot' ELSE 'FAIL' END;


  -- F7 — cannot pass another family's child as "mine"
  st := null;
  BEGIN PERFORM public.claim_existing_child_for_roster_spot('D3TEAM01', roster, theirs, null); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,45); END;
  RAISE NOTICE 'F7  passing someone else''s child as mine -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL' END, coalesce('· '||msg,'');

  -- F8 — cannot absorb a roster spot that already has a family
  st := null;
  BEGIN PERFORM public.claim_existing_child_for_roster_spot('D3TEAM01', theirs, mine, null); st := 'ALLOWED';
  EXCEPTION WHEN OTHERS THEN st := 'blocked'; msg := left(SQLERRM,45); END;
  RAISE NOTICE 'F8  absorbing an ALREADY-CLAIMED spot   -> % %',
    CASE WHEN st='blocked' THEN 'PASS' ELSE 'FAIL another family''s child absorbed' END,
    coalesce('· '||msg,'');

  -- F2/F3/F4 — "this IS my existing player"
  v := public.claim_existing_child_for_roster_spot('D3TEAM01', roster, mine,
        'd3000000-9999-0000-0000-000000000001');
  RAISE NOTICE 'F2  existing-child claim -> status=% -> %', v->>'status',
    CASE WHEN v->>'status'='reconciled' THEN 'PASS consolidated, no duplicate created' ELSE 'FAIL' END;

  RAISE NOTICE 'F3d a stale link to the old roster id still resolves -> %',
    CASE WHEN public.resolve_player_id(roster)=mine THEN 'PASS' ELSE 'FAIL' END;

  -- F4 — double tap / retry with the SAME request id. This must be a clean no-op: after a
  -- successful consolidation the roster spot's spell has MOVED, so an ordering bug here shows
  -- up as "That player is not on this team" on a retry that actually succeeded.
  v2 := public.claim_existing_child_for_roster_spot('D3TEAM01', roster, mine,
         'd3000000-9999-0000-0000-000000000001');
  RAISE NOTICE 'F4  retry with same request id -> status=% -> %', v2->>'status',
    CASE WHEN v2->>'status' IN ('already_linked','already_applied','reconciled') THEN 'PASS no error on retry' ELSE 'FAIL' END;

  -- F5 — "no, new to me": linked, but NOT the manager
  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent::text,'role','authenticated')::text, true);
  PERFORM public.claim_roster_spot('D3TEAM01', fresh);
  RAISE NOTICE 'F5  new-to-me claim -> linked=% manages=% state=% -> %',
    public.is_linked_parent(fresh), public.is_primary_guardian(fresh),
    (SELECT identity_state FROM players WHERE id=fresh),
    CASE WHEN public.is_linked_parent(fresh) AND NOT public.is_primary_guardian(fresh)
         THEN 'PASS entry without authority' ELSE 'FAIL' END;

  -- F6 — the coach confirms: claimant gains authority, coach gains nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub',coach::text,'role','authenticated')::text, true);
  PERFORM public.coach_confirm_guardian_claim(fresh, parent);
  RAISE NOTICE 'F6  after coach confirmation -> coach manages=%, state=%',
    public.is_primary_guardian(fresh), (SELECT identity_state FROM players WHERE id=fresh);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',parent::text,'role','authenticated')::text, true);
  RAISE NOTICE 'F6b claimant now manages=% -> %', public.is_primary_guardian(fresh),
    CASE WHEN public.is_primary_guardian(fresh) THEN 'PASS authority granted to the family' ELSE 'FAIL' END;
END $$;

-- ===== PRIVILEGED VERIFICATION (raw table state, not RLS-filtered) =====
RESET ROLE;
DO $$
DECLARE
  parent uuid := 'd3000000-0000-0000-0000-000000000001';
  coach  uuid := 'd3000000-0000-0000-0000-000000000003';
  mine   uuid := 'd3000000-2222-0000-0000-000000000001';
  roster uuid := 'd3000000-2222-0000-0000-000000000002';
  fresh  uuid := 'd3000000-2222-0000-0000-000000000004';
  b record; n int; clips_after int;
BEGIN
  SELECT * INTO b FROM d3_before;

  SELECT count(*) INTO clips_after FROM clip_tags ct JOIN tags t ON t.id=ct.tag_id WHERE t.player_id=mine;
  RAISE NOTICE 'F3  coach film history moved: tagged clip_tags %->% on the family''s child -> %',
    b.clip_tags_both, clips_after,
    CASE WHEN clips_after = b.clip_tags_both THEN 'PASS nothing lost' ELSE 'FAIL' END;

  RAISE NOTICE 'F3b spell+jersey carried -> open spells=% jersey=% photo=% -> %',
    (SELECT count(*) FROM player_teams WHERE player_id=mine AND left_on IS NULL),
    (SELECT jersey_number FROM player_teams WHERE player_id=mine AND left_on IS NULL),
    (SELECT photo_path FROM players WHERE id=mine),
    CASE WHEN (SELECT count(*) FROM player_teams WHERE player_id=mine AND left_on IS NULL)=1
              AND (SELECT photo_path FROM players WHERE id=mine)='photos/coach-lars.jpg'
         THEN 'PASS' ELSE 'FAIL' END;

  RAISE NOTICE 'F3c coach''s record TOMBSTONED not deleted -> exists=% merged_into=% state=% -> %',
    EXISTS (SELECT 1 FROM players WHERE id=roster),
    (SELECT merged_into_id FROM players WHERE id=roster),
    (SELECT identity_state FROM players WHERE id=roster),
    CASE WHEN (SELECT merged_into_id FROM players WHERE id=roster)=mine
              AND (SELECT identity_state FROM players WHERE id=roster)='retired'
         THEN 'PASS' ELSE 'FAIL' END;

  SELECT count(*) INTO n FROM player_reconciliations WHERE retired_player_id=roster;
  RAISE NOTICE 'F4b reconciliation happened EXACTLY once -> % row(s) -> %', n,
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL merged twice' END;

  SELECT count(*) INTO n FROM players p
   WHERE p.merged_into_id IS NULL
     AND EXISTS (SELECT 1 FROM parent_player_links l WHERE l.player_id=p.id AND l.parent_user_id=parent);
  RAISE NOTICE 'F9  live records for this family -> % -> %', n,
    CASE WHEN n=2 THEN 'PASS one per human (Lars + Fresh Kid), no duplicate' ELSE 'FAIL' END;


  SELECT count(*) INTO n FROM notifications
   WHERE type='guardian_claim_awaiting_confirmation' AND target_player_id=fresh
     AND recipient_user_id=coach;
  RAISE NOTICE 'F5b the COACH was prompted to confirm -> % notification(s) -> %', n,
    CASE WHEN n>=1 THEN 'PASS' ELSE 'FAIL nobody was asked' END;

  RAISE NOTICE 'F6d claimant holds the capability, coach does not -> claimant=% coach=%',
    (SELECT can_manage_guardians FROM parent_player_links WHERE player_id=fresh AND parent_user_id=parent),
    COALESCE((SELECT can_manage_guardians FROM parent_player_links WHERE player_id=fresh AND parent_user_id=coach), false);
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
