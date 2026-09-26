-- ============================================================================
-- test_d1_reconciliation_preservation.sql
--
-- Proves reconcile_players LOSES NOTHING. Builds two synthetic children with rows in EVERY
-- dependent reference discovered by the programmatic FK/reference inventory, including
-- deliberate COLLISION cases on both sides so the conflict rules are exercised rather than
-- just the happy path, then checks plan v2 §9.3's verification gates.
--
-- Fixture (plan v2 §9.2):
--   KEEP = the family's child            DUP = the coach's duplicate record
--   parent_player_links   | adult A           | adult A (collides) + adult B (moves)
--   player_teams          | Team S open       | Team S open, EARLIER joined_on (union) + Team T (moves)
--   tags + clip_tags      | chip on S, 3 clips| chip on S (3 clips, 1 identical) + chip on T (2 clips)
--   game_lineups          | 2 games           | 2 games, 1 shared (PK collision)
--   game_stat_lines       | 1                 | 1 same game+side (UQ collision)
--   event_attendance      | 1                 | 1 same event (UQ collision)
--   team_player_permissions| 1                | 1 same permission (PK collision)
--   player_guardian_seats | live seat for A   | live seat for A (collides) + live seat for B (moves)
--   followers             | pending for F     | approved for F (collision, status wins) + one for G
--   videos / shares / snack signups / notifications (both columns) | plain repoints
--   identity fields       | NO photo, NO grad | photo + grad_class  -> must be CARRIED (§8.6)
--   prior tombstone       | -                 | an older retired row already pointing at DUP
--
-- SAFE: everything inside BEGIN ... ROLLBACK. Synthetic ids only. Run as a privileged
-- connection (auth.users fixtures + SET ROLE).
-- ============================================================================
BEGIN;

-- ---------------- actors ----------------
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-0000-0000-00000000000a','d1-adultA@example.test'),
  ('d1000000-0000-0000-0000-00000000000b','d1-adultB@example.test'),
  ('d1000000-0000-0000-0000-00000000000c','d1-coach@example.test'),
  ('d1000000-0000-0000-0000-00000000000f','d1-followerF@example.test'),
  ('d1000000-0000-0000-0000-00000000000e','d1-followerG@example.test');

INSERT INTO public.teams (id,name,sport,created_by_user_id,join_code,join_code_expires_at) VALUES
  ('d1000000-1111-0000-0000-000000000051','Team S','Basketball','d1000000-0000-0000-0000-00000000000c','D1TEAMS1', now()+interval '30 days'),
  ('d1000000-1111-0000-0000-000000000052','Team T','Basketball','d1000000-0000-0000-0000-00000000000c','D1TEAMT1', now()+interval '30 days');

INSERT INTO public.team_memberships (team_id,user_id,role,status) VALUES
  ('d1000000-1111-0000-0000-000000000051','d1000000-0000-0000-0000-00000000000c','coach','confirmed'),
  ('d1000000-1111-0000-0000-000000000052','d1000000-0000-0000-0000-00000000000c','coach','confirmed');

-- ---------------- the two children ----------------
INSERT INTO public.players (id,name,team_id,identity_state,photo_path,grad_class) VALUES
  ('d1000000-2222-0000-0000-000000000001','KEEP Child','d1000000-1111-0000-0000-000000000051','verified',NULL,NULL),
  ('d1000000-2222-0000-0000-00000000000d','DUP Child','d1000000-1111-0000-0000-000000000051','provisional','photos/dup.jpg','2031'),
  -- an OLDER retired row already tombstoned into DUP: proves no chain is created
  ('d1000000-2222-0000-0000-000000000002','OLD Retired','d1000000-1111-0000-0000-000000000051','provisional',NULL,NULL);

-- guardians: A on both (collision), B on DUP only (must move)
INSERT INTO public.parent_player_links (parent_user_id,player_id,relationship,can_manage_guardians) VALUES
  ('d1000000-0000-0000-0000-00000000000a','d1000000-2222-0000-0000-000000000001','parent',true),
  ('d1000000-0000-0000-0000-00000000000a','d1000000-2222-0000-0000-00000000000d','guardian',false),
  -- Family B MANAGES the duplicate record. Set here, in the privileged fixture, because D2b
  -- makes guardian authority definer-only: no client role can grant can_manage_guardians, so
  -- the test cannot (and must not be able to) do this from inside an authenticated block.
  ('d1000000-0000-0000-0000-00000000000b','d1000000-2222-0000-0000-00000000000d','guardian',true);

-- spells: S collides (union, earlier joined_on wins), T moves
INSERT INTO public.player_teams (player_id,team_id,joined_on,left_on,jersey_number) VALUES
  ('d1000000-2222-0000-0000-000000000001','d1000000-1111-0000-0000-000000000051','2026-03-01',NULL,'10'),
  ('d1000000-2222-0000-0000-00000000000d','d1000000-1111-0000-0000-000000000051','2026-01-15',NULL,'11'),
  ('d1000000-2222-0000-0000-00000000000d','d1000000-1111-0000-0000-000000000052','2026-02-01',NULL,'12');

-- ---------------- film + tags ----------------
INSERT INTO public.videos (id,team_id,uploaded_by_user_id,url,label,player_id) VALUES
  ('d1000000-3333-0000-0000-000000000001','d1000000-1111-0000-0000-000000000051','d1000000-0000-0000-0000-00000000000c','d1/s.mp4','S Game',NULL),
  ('d1000000-3333-0000-0000-000000000002','d1000000-1111-0000-0000-000000000052','d1000000-0000-0000-0000-00000000000c','d1/t.mp4','T Game','d1000000-2222-0000-0000-00000000000d');

INSERT INTO public.clips (id,video_id,start_time,end_time) VALUES
  ('d1000000-4444-0000-0000-000000000001','d1000000-3333-0000-0000-000000000001',1,5),
  ('d1000000-4444-0000-0000-000000000002','d1000000-3333-0000-0000-000000000001',6,10),
  ('d1000000-4444-0000-0000-000000000003','d1000000-3333-0000-0000-000000000001',11,15),
  ('d1000000-4444-0000-0000-000000000004','d1000000-3333-0000-0000-000000000001',16,20),
  ('d1000000-4444-0000-0000-000000000005','d1000000-3333-0000-0000-000000000002',1,5),
  ('d1000000-4444-0000-0000-000000000006','d1000000-3333-0000-0000-000000000002',6,10);

-- chips: the on_player_teams_insert trigger (ensure_player_tag) ALREADY created one chip per
-- (team, player) when the spells above were inserted -- inserting them again violates
-- uq_tags_team_player. So adopt the trigger's rows and give them the ids this test refers to.
UPDATE public.tags SET id='d1000000-5555-0000-0000-000000000001', name='KEEP #10'
 WHERE team_id='d1000000-1111-0000-0000-000000000051' AND player_id='d1000000-2222-0000-0000-000000000001' AND category='players';
UPDATE public.tags SET id='d1000000-5555-0000-0000-00000000000d', name='DUP #11'
 WHERE team_id='d1000000-1111-0000-0000-000000000051' AND player_id='d1000000-2222-0000-0000-00000000000d' AND category='players';
UPDATE public.tags SET id='d1000000-5555-0000-0000-000000000003', name='DUP #12'
 WHERE team_id='d1000000-1111-0000-0000-000000000052' AND player_id='d1000000-2222-0000-0000-00000000000d' AND category='players';
-- fail loudly rather than testing an empty fixture
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tags WHERE id IN ('d1000000-5555-0000-0000-000000000001',
        'd1000000-5555-0000-0000-00000000000d','d1000000-5555-0000-0000-000000000003')) <> 3 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: expected 3 auto-created player chips, got %',
      (SELECT count(*) FROM public.tags WHERE id IN ('d1000000-5555-0000-0000-000000000001',
        'd1000000-5555-0000-0000-00000000000d','d1000000-5555-0000-0000-000000000003'));
  END IF;
END $$;
-- a non-player tag used to build real bundles
INSERT INTO public.tags (id,team_id,name,category,player_id) VALUES
  ('d1000000-5555-0000-0000-0000000000a1','d1000000-1111-0000-0000-000000000051','Made 3','offense',NULL);

-- KEEP's chip: clips 1,2,3 (bundle 1)
INSERT INTO public.clip_tags (clip_id,tag_id,bundle_number,stat_side) VALUES
  ('d1000000-4444-0000-0000-000000000001','d1000000-5555-0000-0000-000000000001',1,'us'),
  ('d1000000-4444-0000-0000-000000000002','d1000000-5555-0000-0000-000000000001',1,'us'),
  ('d1000000-4444-0000-0000-000000000003','d1000000-5555-0000-0000-000000000001',1,'us'),
  -- a real bundle: KEEP + Made 3 on clip 1, bundle 1 (must still match after the fold)
  ('d1000000-4444-0000-0000-000000000001','d1000000-5555-0000-0000-0000000000a1',1,'us');

-- DUP's S chip: clip 1 bundle 1 (IDENTICAL -> must be skipped as duplicate), clips 3(b2), 4
INSERT INTO public.clip_tags (clip_id,tag_id,bundle_number,stat_side) VALUES
  ('d1000000-4444-0000-0000-000000000001','d1000000-5555-0000-0000-00000000000d',1,'us'),
  ('d1000000-4444-0000-0000-000000000003','d1000000-5555-0000-0000-00000000000d',2,'us'),
  ('d1000000-4444-0000-0000-000000000004','d1000000-5555-0000-0000-00000000000d',1,'us');

-- DUP's T chip: clips 5,6
INSERT INTO public.clip_tags (clip_id,tag_id,bundle_number,stat_side) VALUES
  ('d1000000-4444-0000-0000-000000000005','d1000000-5555-0000-0000-000000000003',1,'us'),
  ('d1000000-4444-0000-0000-000000000006','d1000000-5555-0000-0000-000000000003',1,'us');

-- ---------------- games / lineups / stats ----------------
INSERT INTO public.games (id,team_id,title) VALUES
  ('d1000000-6666-0000-0000-000000000001','d1000000-1111-0000-0000-000000000051','G1'),
  ('d1000000-6666-0000-0000-000000000002','d1000000-1111-0000-0000-000000000051','G2'),
  ('d1000000-6666-0000-0000-000000000003','d1000000-1111-0000-0000-000000000051','G3');

-- The on_games_insert trigger (snapshot_game_lineup) already wrote a lineup row for every
-- child with an open spell, so both children are in all three games. Sculpt the fixture by
-- REMOVING rows instead of inserting: G1 = KEEP only, G2 = both (PK collision), G3 = DUP only.
DELETE FROM public.game_lineups
 WHERE (game_id='d1000000-6666-0000-0000-000000000001' AND player_id='d1000000-2222-0000-0000-00000000000d')
    OR (game_id='d1000000-6666-0000-0000-000000000003' AND player_id='d1000000-2222-0000-0000-000000000001');
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.game_lineups
   WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d');
  IF n <> 4 THEN RAISE EXCEPTION 'FIXTURE BROKEN: expected 4 lineup rows, got %', n; END IF;
END $$;

INSERT INTO public.game_stat_lines (game_id,player_id,stat_side,fgm,fga) VALUES
  ('d1000000-6666-0000-0000-000000000001','d1000000-2222-0000-0000-000000000001','own',3,5),
  ('d1000000-6666-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d','own',1,2),  -- collision
  ('d1000000-6666-0000-0000-000000000002','d1000000-2222-0000-0000-00000000000d','own',4,6);  -- moves

-- ---------------- schedule ----------------
INSERT INTO public.events (id,team_id,event_type,local_date) VALUES
  ('d1000000-7777-0000-0000-000000000001','d1000000-1111-0000-0000-000000000051','practice','2026-04-01'),
  ('d1000000-7777-0000-0000-000000000002','d1000000-1111-0000-0000-000000000051','practice','2026-04-08');

INSERT INTO public.event_attendance (event_id,player_id,rsvp_status) VALUES
  ('d1000000-7777-0000-0000-000000000001','d1000000-2222-0000-0000-000000000001','going'),
  ('d1000000-7777-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d','out'),   -- collision
  ('d1000000-7777-0000-0000-000000000002','d1000000-2222-0000-0000-00000000000d','going');  -- moves

INSERT INTO public.event_snack_signups (event_id,team_id,claimed_by_user_id,player_id) VALUES
  ('d1000000-7777-0000-0000-000000000001','d1000000-1111-0000-0000-000000000051','d1000000-0000-0000-0000-00000000000b','d1000000-2222-0000-0000-00000000000d');

-- ---------------- shares / notifications ----------------
INSERT INTO public.shares (id,content_type,content_id,team_id,audience,target_player_id,shared_by_user_id,visible) VALUES
  ('d1000000-8888-0000-0000-000000000001','video','d1000000-3333-0000-0000-000000000001','d1000000-1111-0000-0000-000000000051','player','d1000000-2222-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000c',true),
  ('d1000000-8888-0000-0000-000000000002','video','d1000000-3333-0000-0000-000000000002','d1000000-1111-0000-0000-000000000052','player','d1000000-2222-0000-0000-00000000000d','d1000000-0000-0000-0000-00000000000c',true);

-- notifications: BOTH the FK column and the polymorphic entity_id (the inventory find)
INSERT INTO public.notifications (id,recipient_user_id,type,target_player_id,entity_type,entity_id) VALUES
  ('d1000000-9999-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000a','x','d1000000-2222-0000-0000-000000000001','player','d1000000-2222-0000-0000-000000000001'),
  ('d1000000-9999-0000-0000-000000000002','d1000000-0000-0000-0000-00000000000a','x','d1000000-2222-0000-0000-00000000000d','player','d1000000-2222-0000-0000-00000000000d'),
  ('d1000000-9999-0000-0000-000000000003','d1000000-0000-0000-0000-00000000000b','x','d1000000-2222-0000-0000-00000000000d','player','d1000000-2222-0000-0000-00000000000d');

-- ---------------- seats / codes / permissions / followers ----------------
INSERT INTO public.player_guardian_seats (player_id,granted_to_user_id,source) VALUES
  ('d1000000-2222-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000a','purchase'),
  ('d1000000-2222-0000-0000-00000000000d','d1000000-0000-0000-0000-00000000000a','purchase'),  -- collision
  ('d1000000-2222-0000-0000-00000000000d','d1000000-0000-0000-0000-00000000000b','purchase');  -- moves (PAID)

INSERT INTO public.player_guardian_codes (player_id,code) VALUES
  ('d1000000-2222-0000-0000-000000000001','D1KEEPCD'),
  ('d1000000-2222-0000-0000-00000000000d','D1DUPCD1');

INSERT INTO public.team_player_permissions (team_id,player_id,permission,allowed) VALUES
  ('d1000000-1111-0000-0000-000000000051','d1000000-2222-0000-0000-000000000001','post_wall',true),
  ('d1000000-1111-0000-0000-000000000051','d1000000-2222-0000-0000-00000000000d','post_wall',false),  -- collision
  ('d1000000-1111-0000-0000-000000000051','d1000000-2222-0000-0000-00000000000d','upload_video',true); -- moves

INSERT INTO public.followers (follower_user_id,scope,team_id,player_id,status) VALUES
  ('d1000000-0000-0000-0000-00000000000f','player','d1000000-1111-0000-0000-000000000051','d1000000-2222-0000-0000-000000000001','pending'),
  ('d1000000-0000-0000-0000-00000000000f','player','d1000000-1111-0000-0000-000000000051','d1000000-2222-0000-0000-00000000000d','approved'), -- collision, status wins
  ('d1000000-0000-0000-0000-00000000000e','player','d1000000-1111-0000-0000-000000000051','d1000000-2222-0000-0000-00000000000d','pending'); -- moves

-- prior tombstone pointing at DUP (chain-collapse test)
UPDATE public.players SET merged_into_id='d1000000-2222-0000-0000-00000000000d', merged_at=now()
 WHERE id='d1000000-2222-0000-0000-000000000002';

-- lineage pointer at DUP
UPDATE public.players SET player_lineage_id='d1000000-2222-0000-0000-00000000000d'
 WHERE id='d1000000-2222-0000-0000-00000000000d';

-- ============================================================
-- BEFORE SNAPSHOT
-- ============================================================
CREATE TEMP TABLE before_counts AS
SELECT 'parent_player_links' t, count(*) n FROM parent_player_links WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'player_teams', count(*) FROM player_teams WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'clip_tags', count(*) FROM clip_tags ct JOIN tags t ON t.id=ct.tag_id WHERE t.player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'tags', count(*) FROM tags WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'game_lineups', count(*) FROM game_lineups WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'game_stat_lines', count(*) FROM game_stat_lines WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'event_attendance', count(*) FROM event_attendance WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'event_snack_signups', count(*) FROM event_snack_signups WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'videos', count(*) FROM videos WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'shares', count(*) FROM shares WHERE target_player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'notifications', count(*) FROM notifications WHERE target_player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'notifications_entity', count(*) FROM notifications WHERE entity_type='player' AND entity_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'player_guardian_seats_live', count(*) FROM player_guardian_seats WHERE revoked_at IS NULL AND player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'team_player_permissions', count(*) FROM team_player_permissions WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d')
UNION ALL SELECT 'followers', count(*) FROM followers WHERE player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d');

-- Which (clip, bundle) pairs is this child tagged in, before? Gate 4's real test.
CREATE TEMP TABLE before_bundles AS
SELECT DISTINCT ct.clip_id, ct.bundle_number, ct.stat_side
  FROM clip_tags ct JOIN tags t ON t.id=ct.tag_id
 WHERE t.player_id IN ('d1000000-2222-0000-0000-000000000001','d1000000-2222-0000-0000-00000000000d');

DO $$ BEGIN RAISE NOTICE '=== D1 RECONCILIATION PRESERVATION (synthetic, will ROLLBACK) ==='; END $$;

-- ============================================================
-- DRY RUN FIRST (D5 tooling): must report and change NOTHING
-- ============================================================
SET LOCAL ROLE authenticated;
DO $$
DECLARE v jsonb; v_rows_before int; v_rows_after int;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SELECT count(*) INTO v_rows_before FROM clip_tags;
  v := public.reconcile_players(
        p_keep => 'd1000000-2222-0000-0000-000000000001',
        p_retire => 'd1000000-2222-0000-0000-00000000000d',
        p_dry_run => true);
  SELECT count(*) INTO v_rows_after FROM clip_tags;
  RAISE NOTICE 'DRY RUN status=% authority=%', v->>'status', v->>'authority';
  RAISE NOTICE 'DRY RUN would_move   = %', v->'would_move';
  RAISE NOTICE 'DRY RUN would_skip   = %', v->'would_skip_as_duplicate';
  RAISE NOTICE 'DRY RUN would_carry  = %', v->'would_carry_identity_fields';
  RAISE NOTICE 'DRY RUN conflicts    = %', v->'conflicts';
  RAISE NOTICE 'GATE dry run changed nothing -> %',
    CASE WHEN v_rows_before = v_rows_after
          AND (SELECT merged_into_id FROM players WHERE id='d1000000-2222-0000-0000-00000000000d') IS NULL
         THEN 'PASS' ELSE 'FAIL it wrote something' END;
END $$;

-- ============================================================
-- SECURITY GATE FIRST — the guardian sets DIFFER (adult B is on the duplicate only), so a
-- direct merge on adult A's word alone must be REFUSED even though A holds both children.
-- Combining would silently hand adult B access to A's child.
-- ============================================================
DO $$
DECLARE v_state text; v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  BEGIN
    PERFORM public.reconcile_players(
      p_keep => 'd1000000-2222-0000-0000-000000000001',
      p_retire => 'd1000000-2222-0000-0000-00000000000d',
      p_acknowledge_conflicts => true);
    v_state := 'APPLIED';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := left(SQLERRM, 70);
  END;
  RAISE NOTICE 'GATE0 direct merge with DIFFERING guardian sets -> % -> %',
    coalesce(v_msg, v_state),
    CASE WHEN v_state = '42501' THEN 'PASS refused, needs both families'
         ELSE 'FAIL a family was merged on one party''s word' END;
END $$;

-- ============================================================
-- THE REAL RECONCILIATION — via the dual-confirmation path (authority case 5):
-- adult A requests, adult B (the other guardian) confirms, then A applies it.
-- ============================================================
DO $$
DECLARE v jsonb; v_req uuid;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  v_req := public.request_player_merge(
             'd1000000-2222-0000-0000-00000000000d',
             'd1000000-2222-0000-0000-000000000001',
             'Same child, two records');
  RAISE NOTICE 'request opened = %', (v_req IS NOT NULL);

  -- B already holds management authority on the duplicate (see the fixture), which is what
  -- makes their confirmation the other family's signature.
  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
  PERFORM public.confirm_player_merge(v_req);
  RAISE NOTICE 'confirmed by the other guardian -> %',
    (SELECT status FROM player_merge_requests WHERE id = v_req);

  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  v := public.reconcile_players(
        p_keep => 'd1000000-2222-0000-0000-000000000001',
        p_retire => 'd1000000-2222-0000-0000-00000000000d',
        p_request_id => 'd1000000-aaaa-0000-0000-000000000001',
        p_merge_request_id => v_req,
        p_acknowledge_conflicts => true);
  RAISE NOTICE 'APPLIED status=% authority=%', v->>'status', v->>'authority';
  RAISE NOTICE 'moved   = %', v->'moved';
  RAISE NOTICE 'skipped = %', v->'skipped_as_duplicate';
  RAISE NOTICE 'carried = %', v->'carried_identity_fields';
  RAISE NOTICE 'request marked applied -> %',
    (SELECT status FROM player_merge_requests WHERE id = v_req);
END $$;

-- ============================================================
-- GATES
-- ============================================================
RESET ROLE;
DO $$
DECLARE
  k uuid := 'd1000000-2222-0000-0000-000000000001';
  d uuid := 'd1000000-2222-0000-0000-00000000000d';
  r record; v_bad int; v_txt text; n int; n2 int;
BEGIN
  -- GATE 1 — no unexplained losses, table by table
  FOR r IN
    SELECT b.t, b.n AS before_n,
      CASE b.t
        WHEN 'parent_player_links' THEN (SELECT count(*) FROM parent_player_links WHERE player_id=k)
        WHEN 'player_teams' THEN (SELECT count(*) FROM player_teams WHERE player_id=k)
        WHEN 'clip_tags' THEN (SELECT count(*) FROM clip_tags ct JOIN tags t ON t.id=ct.tag_id WHERE t.player_id=k)
        WHEN 'tags' THEN (SELECT count(*) FROM tags WHERE player_id=k)
        WHEN 'game_lineups' THEN (SELECT count(*) FROM game_lineups WHERE player_id=k)
        WHEN 'game_stat_lines' THEN (SELECT count(*) FROM game_stat_lines WHERE player_id=k)
        WHEN 'event_attendance' THEN (SELECT count(*) FROM event_attendance WHERE player_id=k)
        WHEN 'event_snack_signups' THEN (SELECT count(*) FROM event_snack_signups WHERE player_id=k)
        WHEN 'videos' THEN (SELECT count(*) FROM videos WHERE player_id=k)
        WHEN 'shares' THEN (SELECT count(*) FROM shares WHERE target_player_id=k)
        WHEN 'notifications' THEN (SELECT count(*) FROM notifications WHERE target_player_id=k)
        WHEN 'notifications_entity' THEN (SELECT count(*) FROM notifications WHERE entity_type='player' AND entity_id=k)
        WHEN 'player_guardian_seats_live' THEN (SELECT count(*) FROM player_guardian_seats WHERE revoked_at IS NULL AND player_id=k)
        WHEN 'team_player_permissions' THEN (SELECT count(*) FROM team_player_permissions WHERE player_id=k)
        WHEN 'followers' THEN (SELECT count(*) FROM followers WHERE player_id=k)
      END AS after_n
    FROM before_counts b ORDER BY b.t
  LOOP
    -- THE REAL ASSERTION: before(both sides) must equal after(keeper) + the collisions the
    -- audit record explicitly counted as duplicates. Any other shortfall is a silent loss.
    DECLARE
      v_skipped int := coalesce((
        SELECT (pr.skipped_as_duplicate->>(
                  CASE r.t WHEN 'notifications_entity' THEN 'notifications'
                           WHEN 'player_guardian_seats_live' THEN 'player_guardian_seats_revoked_as_duplicate'
                           WHEN 'tags' THEN 'tags_folded'
                           ELSE r.t END))::int
          FROM player_reconciliations pr WHERE pr.retired_player_id = d), 0);
      v_ok boolean;
    BEGIN
      -- notifications GROWS: reconcile_players notifies the surviving family. Assert no loss.
      v_ok := CASE WHEN r.t LIKE 'notifications%' THEN r.after_n >= r.before_n - v_skipped
                   ELSE r.after_n + v_skipped = r.before_n END;
      RAISE NOTICE 'GATE1 %  before(both)=%  after(keeper)=%  counted_dupes=%  -> %',
        rpad(r.t,27), r.before_n, r.after_n, v_skipped,
        CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL UNEXPLAINED LOSS' END;
    END;
  END LOOP;

  -- GATE 2 — nothing anywhere still references the retired child
  SELECT (SELECT count(*) FROM parent_player_links WHERE player_id=d)
       + (SELECT count(*) FROM player_teams WHERE player_id=d)
       + (SELECT count(*) FROM tags WHERE player_id=d)
       + (SELECT count(*) FROM game_lineups WHERE player_id=d)
       + (SELECT count(*) FROM game_stat_lines WHERE player_id=d)
       + (SELECT count(*) FROM event_attendance WHERE player_id=d)
       + (SELECT count(*) FROM event_snack_signups WHERE player_id=d)
       + (SELECT count(*) FROM videos WHERE player_id=d)
       + (SELECT count(*) FROM shares WHERE target_player_id=d)
       + (SELECT count(*) FROM notifications WHERE target_player_id=d)
       + (SELECT count(*) FROM notifications WHERE entity_type='player' AND entity_id=d)
       + (SELECT count(*) FROM player_guardian_seats WHERE revoked_at IS NULL AND player_id=d)
       + (SELECT count(*) FROM team_player_permissions WHERE player_id=d)
       + (SELECT count(*) FROM followers WHERE player_id=d)
       + (SELECT count(*) FROM player_guardian_codes WHERE player_id=d)
    INTO v_bad;
  RAISE NOTICE 'GATE2 live rows still pointing at the RETIRED child = % -> %', v_bad,
    CASE WHEN v_bad=0 THEN 'PASS' ELSE 'FAIL' END;

  -- GATE 3 — tombstoned, not deleted; resolves; state is 'retired'
  SELECT merged_into_id::text || ' / ' || identity_state INTO v_txt FROM players WHERE id=d;
  RAISE NOTICE 'GATE3 retired row still exists: merged_into/state = % -> %', v_txt,
    CASE WHEN v_txt = k::text || ' / retired' THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE 'GATE3 resolve_player_id(stale DUP id) = % -> %',
    public.resolve_player_id(d),
    CASE WHEN public.resolve_player_id(d)=k THEN 'PASS stale id resolves' ELSE 'FAIL' END;
  RAISE NOTICE 'GATE3 NO CHAIN: older tombstone now points at keeper -> %',
    CASE WHEN (SELECT merged_into_id FROM players WHERE id='d1000000-2222-0000-0000-000000000002')=k
         THEN 'PASS' ELSE 'FAIL chain left behind' END;

  -- GATE 4 — every (clip,bundle) the child was tagged in is STILL tagged: the tag-bundle
  -- invariant export depends on.
  SELECT count(*) INTO v_bad FROM before_bundles b
   WHERE NOT EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id=ct.tag_id
                      WHERE t.player_id=k AND ct.clip_id=b.clip_id
                        AND ct.bundle_number=b.bundle_number AND ct.stat_side=b.stat_side);
  RAISE NOTICE 'GATE4 (clip,bundle,side) pairs lost = % of % -> %', v_bad,
    (SELECT count(*) FROM before_bundles), CASE WHEN v_bad=0 THEN 'PASS' ELSE 'FAIL' END;
  -- and the real bundle still ANDs: KEEP + "Made 3" on clip 1 bundle 1
  RAISE NOTICE 'GATE4 group "child + Made 3" still matches clip 1 -> %',
    CASE WHEN EXISTS (
      SELECT 1 FROM clip_tags a JOIN tags ta ON ta.id=a.tag_id
               JOIN clip_tags b2 ON b2.clip_id=a.clip_id AND b2.bundle_number=a.bundle_number
               JOIN tags tb ON tb.id=b2.tag_id
       WHERE a.clip_id='d1000000-4444-0000-0000-000000000001'
         AND ta.player_id=k AND tb.name='Made 3')
    THEN 'PASS' ELSE 'FAIL bundle broken' END;

  -- GATE 5 — guardians: A kept (was on both), B MOVED (only on the loser)
  RAISE NOTICE 'GATE5 adult A still guardian=% | adult B PRESERVED=% -> %',
    EXISTS (SELECT 1 FROM parent_player_links WHERE player_id=k AND parent_user_id='d1000000-0000-0000-0000-00000000000a'),
    EXISTS (SELECT 1 FROM parent_player_links WHERE player_id=k AND parent_user_id='d1000000-0000-0000-0000-00000000000b'),
    CASE WHEN EXISTS (SELECT 1 FROM parent_player_links WHERE player_id=k AND parent_user_id='d1000000-0000-0000-0000-00000000000b')
         THEN 'PASS no guardian dropped' ELSE 'FAIL a guardian was silently dropped' END;

  -- GATE 6 — spell union on Team S (earliest joined_on), Team T moved
  SELECT joined_on::text INTO v_txt FROM player_teams WHERE player_id=k AND team_id='d1000000-1111-0000-0000-000000000051' AND left_on IS NULL;
  SELECT count(*) INTO n FROM player_teams WHERE player_id=k AND left_on IS NULL;
  RAISE NOTICE 'GATE6 Team S joined_on=% (expect 2026-01-15, the earlier) | open spells=% (expect 2) -> %',
    v_txt, n, CASE WHEN v_txt='2026-01-15' AND n=2 THEN 'PASS' ELSE 'FAIL' END;

  -- GATE 7 — one lineup row per game, nothing lost
  SELECT count(*), count(DISTINCT game_id) INTO n, n2 FROM game_lineups WHERE player_id=k;
  RAISE NOTICE 'GATE7 lineups rows=% distinct games=% (expect 3/3) -> %', n, n2,
    CASE WHEN n=3 AND n=n2 THEN 'PASS' ELSE 'FAIL' END;

  -- GATE 8 — PAID seat for adult B survived; duplicate seat revoked not deleted
  SELECT count(*) INTO n FROM player_guardian_seats WHERE player_id=k AND granted_to_user_id='d1000000-0000-0000-0000-00000000000b' AND revoked_at IS NULL;
  SELECT count(*) INTO n2 FROM player_guardian_seats WHERE revoked_at IS NOT NULL;
  RAISE NOTICE 'GATE8 adult B live seat on keeper=% | duplicate seats revoked(not deleted)=% -> %', n, n2,
    CASE WHEN n=1 AND n2>=1 THEN 'PASS paid seat preserved' ELSE 'FAIL' END;

  -- GATE 9 — follower collision kept the more advanced status
  SELECT status::text INTO v_txt FROM followers WHERE player_id=k AND follower_user_id='d1000000-0000-0000-0000-00000000000f';
  SELECT count(*) INTO n FROM followers WHERE player_id=k;
  RAISE NOTICE 'GATE9 follower F status=% (expect approved) | followers on keeper=% (expect 2) -> %',
    v_txt, n, CASE WHEN v_txt='approved' AND n=2 THEN 'PASS' ELSE 'FAIL' END;

  -- GATE 10 — identity fields carried (§8.6): keeper had neither photo nor grad class
  SELECT coalesce(photo_path,'NULL')||' / '||coalesce(grad_class,'NULL') INTO v_txt FROM players WHERE id=k;
  RAISE NOTICE 'GATE10 keeper photo/grad = % -> %', v_txt,
    CASE WHEN v_txt='photos/dup.jpg / 2031' THEN 'PASS carried from retired row' ELSE 'FAIL abandoned' END;

  -- GATE 11 — idempotency: same request id is a no-op
  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SELECT count(*) INTO n FROM player_reconciliations;
  DECLARE v jsonb; BEGIN
    v := public.reconcile_players(k, d, 'd1000000-aaaa-0000-0000-000000000001'::uuid);
    SELECT count(*) INTO n2 FROM player_reconciliations;
    RAISE NOTICE 'GATE11 replay same request_id -> status=% audit rows %->% -> %',
      v->>'status', n, n2, CASE WHEN v->>'status'='already_applied' AND n=n2 THEN 'PASS' ELSE 'FAIL' END;
  END;

  -- GATE 12 — durable audit record
  SELECT authority||' moved='||(moved->>'clip_tags')||' carried='||array_to_string(carried_identity_fields,'+')
    INTO v_txt FROM player_reconciliations WHERE retired_player_id=d;
  RAISE NOTICE 'GATE12 audit row: % -> %', v_txt, CASE WHEN v_txt IS NOT NULL THEN 'PASS' ELSE 'FAIL' END;

  -- GATE 13 — the retired child is invisible to a coach and a guardian, visible to support
  PERFORM set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM players WHERE id=d;
  RESET ROLE;
  RAISE NOTICE 'GATE13 coach can see the retired row = % -> %', n,
    CASE WHEN n=0 THEN 'PASS tombstone hidden' ELSE 'FAIL tombstone visible' END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END — rolling back ==='; END $$;
ROLLBACK;
