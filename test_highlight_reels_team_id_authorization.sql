-- ============================================================
-- test_highlight_reels_team_id_authorization.sql — write-authorization regression
-- test for public.highlight_reels (team_id association + creator attribution).
--
-- WHAT THIS IS FOR
--   Proves the two gaps closed by
--   20260928200000_highlight_reels_team_id_write_authorization.sql stay closed:
--     GAP 1  team_id could be set/mutated to an UNRELATED team, because the
--            self-created branch of the WITH CHECK OR bypassed team validation.
--     GAP 2  created_by_user_id could be SPOOFED on INSERT, because
--            is_team_member(team_id) alone satisfied the actor gate.
--   It also asserts what must NOT change: may_reel_clip() content authorization,
--   personal (null-team) reels, the parent highlight path, non-coach confirmed
--   members, coaches, super-admins, and the finalizeReel() product write.
--
-- SAFE TO RUN AGAINST LIVE
--   Everything runs inside a single BEGIN ... ROLLBACK. All fixtures are SYNTHETIC
--   (hardcoded UUIDs, incl. throwaway auth.users rows created and rolled back
--   here). Nothing is committed. Cases 15-16 READ live rows (counts only).
--
-- HOW TO RUN
--   Run the whole file as a PRIVILEGED connection (Supabase SQL editor or the
--   Supabase MCP — both connect as 'postgres'). Superuser is needed to (a) insert
--   synthetic auth.users rows for the FK and (b) SET ROLE authenticated so RLS is
--   actually enforced. Results come back as a RESULT SET (final SELECT), which is
--   what the Supabase MCP can actually display — RAISE NOTICE output is not
--   surfaced there.
--
--   EXPECTED: every row outcome = 'PASS'. Any FAIL or INCONCLUSIVE is a
--   regression. Verified green 2026-09-28 immediately after applying the migration.
--
-- RE-RUN THIS after ANY change to:
--   * highlight_reels RLS policies (insert / update / read / delete), OR
--   * may_reel_clip(), is_team_member(), is_team_coach(), is_super_admin(),
--     is_roster_reel_parent(), or set_clip_origin().
--
-- TWO RIGOR RULES — DO NOT WEAKEN
--   1. CONTROL ASSERTION before every case: auth.uid() == injected sub AND
--      current_user == 'authenticated'. A test that silently ran as a privileged
--      RLS-bypassing role would report a FALSE PASS, which is worse than no test.
--   2. A denial scores PASS only on SQLSTATE 42501 (insufficient_privilege). ANY
--      other error (FK, enum, not-null, bad uuid) proves nothing about the policy
--      and is scored INCONCLUSIVE, never PASS.
-- ============================================================

BEGIN;

CREATE TEMP TABLE res(c text, label text, expect text, outcome text, detail text) ON COMMIT DROP;
-- The cases run as 'authenticated', so that role must be able to record results.
GRANT INSERT, SELECT ON res TO authenticated;

-- ------------------------------------------------------------
-- Fixtures. Synthetic UUIDs:
--   a1..  coach of T1           (confirmed 'coach')   — main actor
--   b2..  member of T1          (confirmed 'parent')  — NON-coach member
--   c3..  stranger, no membership anywhere
--   d4..  super admin
--   T1 = 11111111..  actor's own team
--   T2 = 22222222..  UNRELATED team (nobody above is a member)
-- ------------------------------------------------------------
INSERT INTO auth.users (id,email) VALUES
  ('a1111111-1111-1111-1111-111111111111','hr-t-coach@example.test'),
  ('b2222222-2222-2222-2222-222222222222','hr-t-member@example.test'),
  ('c3333333-3333-3333-3333-333333333333','hr-t-stranger@example.test'),
  ('d4444444-4444-4444-4444-444444444444','hr-t-super@example.test');

INSERT INTO public.teams (id,name,sport,created_by_user_id) VALUES
  ('11111111-1111-1111-1111-111111111111','HR T1','Basketball','a1111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222','HR T2 UNRELATED','Basketball','a1111111-1111-1111-1111-111111111111');

-- b2 is a 'parent': a confirmed member who is NOT a coach. Case 10 depends on this
-- actor, which is what stops a future "fix" over-tightening the invariant to
-- coach-only (the product dropdown offers every membership role).
INSERT INTO public.team_memberships (team_id,user_id,role,status) VALUES
  ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','coach','confirmed'),
  ('11111111-1111-1111-1111-111111111111','b2222222-2222-2222-2222-222222222222','parent','confirmed');

INSERT INTO public.super_admins (user_id) VALUES ('d4444444-4444-4444-4444-444444444444');

INSERT INTO public.games (id,team_id,title) VALUES
  ('e1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','G1'),
  ('e2222222-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','G2');
INSERT INTO public.videos (id,game_id,team_id,uploaded_by_user_id,url,label) VALUES
  ('e1111111-0000-0000-0000-000000000002','e1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','t1.mp4','V1'),
  ('e2222222-0000-0000-0000-000000000002','e2222222-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','c3333333-3333-3333-3333-333333333333','t2.mp4','V2');
INSERT INTO public.videos (id,team_id,uploaded_by_user_id,url,label) VALUES
  ('c3333333-0000-0000-0000-000000000002',NULL,'c3333333-3333-3333-3333-333333333333','pers.mp4','VP');

-- ============================================================
-- FIXTURE TRAP — READ BEFORE EDITING ANY CLIP BELOW.
-- The trigger trg_set_clip_origin (public.set_clip_origin) OVERWRITES clips.origin
-- on insert: 'team' only when the INSERTING role is a coach of the clip's team (or
-- can_tag_video), else 'personal'. These fixtures insert as the privileged
-- 'postgres' role, which is neither — so EVERY clip here lands origin='personal'
-- regardless of the column default ('team').
--
-- Consequence: a clip meant to be UNREACHABLE by an actor must not have that actor
-- as created_by_user_id, or may_reel_clip's "my own personal clip is unrestricted
-- for me" branch fires and the clip becomes legitimately reelable. That mistake
-- turns case 12 into a FALSE FAIL. Foreign clips below are foreign on BOTH axes:
-- other team AND other author.
-- ============================================================
-- T1 clip: authored by the actor -> legitimately reelable by a1.
INSERT INTO public.clips (id,video_id,team_id,created_by_user_id,start_time,end_time) VALUES
  ('e1111111-0000-0000-0000-000000000003','e1111111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',0,5);
-- T2 clip: FOREIGN team AND foreign author -> must be unreachable by a1.
INSERT INTO public.clips (id,video_id,team_id,created_by_user_id,start_time,end_time) VALUES
  ('e2222222-0000-0000-0000-000000000003','e2222222-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','c3333333-3333-3333-3333-333333333333',0,5);
-- Stranger's own personal clip: reelable by the stranger (case 11), not by others.
INSERT INTO public.clips (id,video_id,team_id,created_by_user_id,start_time,end_time) VALUES
  ('c3333333-0000-0000-0000-000000000003','c3333333-0000-0000-0000-000000000002',NULL,'c3333333-3333-3333-3333-333333333333',0,5);

-- Pre-existing reel owned by the T1 coach, used by the UPDATE cases.
INSERT INTO public.highlight_reels (id,team_id,created_by_user_id,name,source_clip_ids,status) VALUES
  ('f1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','existing',ARRAY['e1111111-0000-0000-0000-000000000003']::uuid[],'ready');

-- Fixture sanity: record the clip gate's actual inputs, so a future failure can be
-- told apart from a fixture drift (this is the row that caught the trap above).
INSERT INTO res
SELECT 'F','fixture sanity: clip origins (trigger-assigned)','INFO','PASS',
  format('T1clip origin=%s (author=actor) | T2clip origin=%s (author=stranger)',
    (SELECT origin FROM clips WHERE id='e1111111-0000-0000-0000-000000000003'),
    (SELECT origin FROM clips WHERE id='e2222222-0000-0000-0000-000000000003'));

-- Drop out of superuser so RLS is enforced for every case below.
SET LOCAL ROLE authenticated;

-- ---------- INSERT CASES (1,2,3,4,9,10,11,12,13) ----------
DO $$
DECLARE r record; o text; d text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('1','a1111111-1111-1111-1111-111111111111'::uuid,NULL::uuid,'a1111111-1111-1111-1111-111111111111'::uuid,'e1111111-0000-0000-0000-000000000003'::uuid,true,'personal reel INSERT, team_id NULL'),
    ('2','a1111111-1111-1111-1111-111111111111'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'a1111111-1111-1111-1111-111111111111'::uuid,'e1111111-0000-0000-0000-000000000003'::uuid,true,'own-team reel INSERT'),
    ('3','a1111111-1111-1111-1111-111111111111'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,'a1111111-1111-1111-1111-111111111111'::uuid,'e1111111-0000-0000-0000-000000000003'::uuid,false,'GAP1 unrelated team_id INSERT'),
    ('4','a1111111-1111-1111-1111-111111111111'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'b2222222-2222-2222-2222-222222222222'::uuid,'e1111111-0000-0000-0000-000000000003'::uuid,false,'GAP2 spoofed created_by_user_id INSERT'),
    ('9','a1111111-1111-1111-1111-111111111111'::uuid,NULL::uuid,'a1111111-1111-1111-1111-111111111111'::uuid,'c3333333-0000-0000-0000-000000000003'::uuid,false,'unauthorized clip (other user personal) stays DENIED'),
    ('10','b2222222-2222-2222-2222-222222222222'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'b2222222-2222-2222-2222-222222222222'::uuid,'c3333333-0000-0000-0000-000000000003'::uuid,false,'non-coach member: clip gate still applies'),
    ('11','c3333333-3333-3333-3333-333333333333'::uuid,NULL::uuid,'c3333333-3333-3333-3333-333333333333'::uuid,'c3333333-0000-0000-0000-000000000003'::uuid,true,'parent/personal null-team with OWN clip ALLOWED'),
    ('12','a1111111-1111-1111-1111-111111111111'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'a1111111-1111-1111-1111-111111111111'::uuid,'e2222222-0000-0000-0000-000000000003'::uuid,false,'coach may NOT reel a FOREIGN team+author clip'),
    ('13','d4444444-4444-4444-4444-444444444444'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,'d4444444-4444-4444-4444-444444444444'::uuid,'e2222222-0000-0000-0000-000000000003'::uuid,true,'super-admin exempt')
  ) t(c,actor,team_id,creator,clip,expect,label) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub',r.actor::text,'role','authenticated')::text, true);

    -- ===== CONTROL ASSERTION (do NOT weaken) =====
    IF auth.uid() IS DISTINCT FROM r.actor OR current_user <> 'authenticated' THEN
      RAISE EXCEPTION 'CONTROL FAILED case % (uid=% role=%) — impersonation not in effect, aborting to avoid a false pass.', r.c, auth.uid(), current_user;
    END IF;

    BEGIN
      INSERT INTO public.highlight_reels (team_id,created_by_user_id,name,source_clip_ids,status)
      VALUES (r.team_id,r.creator,'hrcase'||r.c,ARRAY[r.clip]::uuid[],'rendering');
      o := CASE WHEN r.expect THEN 'PASS' ELSE 'FAIL' END;
      d := CASE WHEN r.expect THEN 'allowed as expected' ELSE 'ALLOWED but must be denied' END;
    EXCEPTION
      WHEN insufficient_privilege THEN
        o := CASE WHEN r.expect THEN 'FAIL' ELSE 'PASS' END;
        d := CASE WHEN r.expect THEN 'denied 42501 but should be allowed' ELSE 'denied by RLS (42501)' END;
      WHEN OTHERS THEN
        o := 'INCONCLUSIVE'; d := format('non-RLS %s: %s — proves nothing about the policy', SQLSTATE, SQLERRM);
    END;
    INSERT INTO res VALUES (r.c, r.label, CASE WHEN r.expect THEN 'ALLOW' ELSE 'DENY' END, o, d);
  END LOOP;
END $$;

-- ---------- UPDATE CASES (5,6,7) ----------
-- Note both failure modes are distinguished: a WITH CHECK violation raises 42501,
-- while a USING mismatch silently affects 0 rows. Neither may be read as success.
DO $$
DECLARE r record; o text; d text; reel uuid := 'f1111111-0000-0000-0000-000000000001';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('5','a1111111-1111-1111-1111-111111111111'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,false,'GAP1 UPDATE team_id -> UNRELATED team'),
    ('6','a1111111-1111-1111-1111-111111111111'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,true,'UPDATE team_id -> own team'),
    ('7','a1111111-1111-1111-1111-111111111111'::uuid,NULL::uuid,true,'UPDATE team_id -> NULL')
  ) t(c,actor,newteam,expect,label) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub',r.actor::text,'role','authenticated')::text, true);

    -- ===== CONTROL ASSERTION (do NOT weaken) =====
    IF auth.uid() IS DISTINCT FROM r.actor OR current_user <> 'authenticated' THEN
      RAISE EXCEPTION 'CONTROL FAILED case % — aborting to avoid a false pass.', r.c;
    END IF;

    BEGIN
      UPDATE public.highlight_reels SET team_id = r.newteam WHERE id = reel;
      IF NOT FOUND THEN o := CASE WHEN r.expect THEN 'FAIL' ELSE 'PASS' END; d := 'ROW_COUNT=0 blocked by USING';
      ELSIF r.expect THEN o := 'PASS'; d := 'allowed as expected';
      ELSE o := 'FAIL'; d := 'ALLOWED but must be denied'; END IF;
      UPDATE public.highlight_reels SET team_id='11111111-1111-1111-1111-111111111111' WHERE id=reel;  -- restore
    EXCEPTION
      WHEN insufficient_privilege THEN
        o := CASE WHEN r.expect THEN 'FAIL' ELSE 'PASS' END;
        d := CASE WHEN r.expect THEN 'denied 42501 but should be allowed' ELSE 'denied by RLS (42501)' END;
      WHEN OTHERS THEN
        o := 'INCONCLUSIVE'; d := format('non-RLS %s: %s', SQLSTATE, SQLERRM);
    END;
    INSERT INTO res VALUES (r.c, r.label, CASE WHEN r.expect THEN 'ALLOW' ELSE 'DENY' END, o, d);
  END LOOP;
END $$;

-- ---------- CASE 14 — finalizeReel() product write ----------
-- status + storage_path only, team_id untouched. WITH CHECK still re-evaluates
-- team_id, so this is the case most at risk from the new conjunct.
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a1111111-1111-1111-1111-111111111111','role','authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM 'a1111111-1111-1111-1111-111111111111'::uuid OR current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'CONTROL FAILED case 14 — aborting.';
  END IF;
  UPDATE public.highlight_reels SET storage_path='reels/x.mp4', status='ready'
   WHERE id='f1111111-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v = ROW_COUNT;
  INSERT INTO res VALUES ('14','finalizeReel-shape UPDATE (status/storage_path, team_id untouched)','ALLOW',
    CASE WHEN v=1 THEN 'PASS' ELSE 'FAIL' END, format('rows=%s', v));
END $$;

-- ---------- CASES 15 & 16 — LIVE production compatibility (read-only) ----------
RESET ROLE;
DO $$
DECLARE tot int; viol int;
BEGIN
  SELECT count(*) INTO tot FROM public.highlight_reels
    WHERE name NOT LIKE 'hrcase%' AND name <> 'existing';
  -- The NEW invariant, evaluated per live row from the CREATOR's standpoint.
  SELECT count(*) INTO viol FROM public.highlight_reels r
   WHERE r.team_id IS NOT NULL AND r.name NOT LIKE 'hrcase%' AND r.name <> 'existing'
     AND NOT EXISTS (SELECT 1 FROM public.team_memberships tm WHERE tm.team_id=r.team_id
       AND tm.user_id=r.created_by_user_id AND tm.status='confirmed' AND tm.left_on IS NULL);
  INSERT INTO res VALUES ('15','live production reels still present','INFO','PASS', format('%s rows', tot));
  INSERT INTO res VALUES ('16','live team-attached reels violating NEW invariant','DENY',
    CASE WHEN viol=0 THEN 'PASS' ELSE 'FAIL' END, format('%s violating', viol));
END $$;

-- EXPECTED: every outcome = 'PASS'.
SELECT c, expect, outcome, label, detail
  FROM res ORDER BY (CASE WHEN c='F' THEN 0 ELSE c::int END);

ROLLBACK;
