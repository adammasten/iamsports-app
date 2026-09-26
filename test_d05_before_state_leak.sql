-- ============================================================
-- test_d05_before_state_leak.sql — BEFORE-STATE EVIDENCE for Slice D0.5.
--
-- A passing "after" test proves nothing on its own. This file restores the PRE-D0.5
-- body of kid_team_audience() (lifted verbatim from 20260904034415_phase1_roster_spells.sql,
-- which is what production runs today) onto the SAME synthetic fixtures used by the
-- after-state suite, and shows that a coach of Org A could enumerate Org B -- the other
-- club the child plays for -- and Org B's coaches by name.
--
-- SAFE: BEGIN ... ROLLBACK. The function replacement is rolled back with everything else,
-- so the local database still holds the D0.5 definition when this finishes.
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
INSERT INTO public.parent_player_links (parent_user_id, player_id, relationship) VALUES
  ('d5000000-0000-0000-0000-0000000000c1','d5000000-2222-0000-0000-000000000001','parent'),
  ('d5000000-0000-0000-0000-0000000000c2','d5000000-2222-0000-0000-000000000001','guardian');

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


-- ---- RESTORE THE PRE-D0.5 DEFINITION (rolled back at the end) ----
create or replace function public.kid_team_audience(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()
          or is_team_coach((select team_id from players where id = p_player_id))) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'team_id', pt.team_id,
               'team_name', coalesce(te.name, 'Team'),
               'member_count', (
                 select count(distinct tm2.user_id)
                 from team_memberships tm2
                 where tm2.team_id = pt.team_id and tm2.status = 'confirmed'
               ),
               'coaches', coalesce((
                 select jsonb_agg(c order by c->>'name')
                 from (
                   select distinct on (tm.user_id)
                          jsonb_build_object(
                            'user_id', tm.user_id,
                            'name', coalesce(up.display_name, 'Coach'),
                            'role', tm.role,
                            'is_you', tm.user_id = uid
                          ) as c
                   from team_memberships tm
                   left join user_profiles up on up.user_id = tm.user_id
                   where tm.team_id = pt.team_id
                     and tm.status = 'confirmed'
                     and tm.role in ('admin','head_coach','coach')
                   order by tm.user_id,
                            case tm.role
                              when 'admin' then 1
                              when 'head_coach' then 2
                              else 3
                            end
                 ) d
               ), '[]'::jsonb)
             )
             order by coalesce(te.name, 'Team')
           )
    from player_teams pt
    left join teams te on te.id = pt.team_id
    where pt.player_id = p_player_id
      and pt.left_on is null
  ), '[]'::jsonb);
end $function$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN RAISE NOTICE '=== D0.5 BEFORE-STATE (pre-fix body, synthetic, will ROLLBACK) ==='; END $$;

DO $$
DECLARE
  c_kid uuid := 'd5000000-2222-0000-0000-000000000001';
  v_json jsonb; v_teams text; v_coaches text; v_n int;
BEGIN
  -- Coach Alpha coaches ONLY Org A. players.team_id points at Org A.
  PERFORM set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  v_json := public.kid_team_audience(c_kid);
  SELECT count(*), string_agg(e->>'team_name', '+' ORDER BY e->>'team_name')
    INTO v_n, v_teams FROM jsonb_array_elements(v_json) e;
  SELECT string_agg(DISTINCT c->>'name', ',') INTO v_coaches
    FROM jsonb_array_elements(v_json) e, jsonb_array_elements(e->'coaches') c;
  RAISE NOTICE 'BEFORE coach A (Org A only) -> % team(s): % | coaches visible: %', v_n, v_teams, v_coaches;
  RAISE NOTICE 'BEFORE LEAK org B team row visible to coach A   -> %',
    CASE WHEN v_teams LIKE '%Org B%' THEN 'LEAK CONFIRMED (this is the bug D0.5 closes)' ELSE 'no leak — REVIEW, fixture wrong' END;
  RAISE NOTICE 'BEFORE LEAK org B coach name visible to coach A -> %',
    CASE WHEN v_coaches LIKE '%Bravo%' THEN 'LEAK CONFIRMED (rival club coach exposed by name)' ELSE 'no leak — REVIEW, fixture wrong' END;

  -- and the gate itself was keyed to the LEGACY players.team_id: coach B, who genuinely
  -- coaches a team this child plays for, was admitted only incidentally.
  PERFORM set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
  BEGIN
    v_json := public.kid_team_audience(c_kid);
    SELECT count(*), string_agg(e->>'team_name','+' ORDER BY e->>'team_name') INTO v_n, v_teams
      FROM jsonb_array_elements(v_json) e;
    RAISE NOTICE 'BEFORE coach B (Org B only, NOT players.team_id) -> % team(s): %', v_n, v_teams;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'BEFORE coach B (Org B only, NOT players.team_id) -> REFUSED (%) — the legacy-team_id gate locked out a legitimate coach', left(SQLERRM,40);
  END;
END $$;

DO $$ BEGIN RAISE NOTICE '=== END BEFORE-STATE — rolling back ==='; END $$;
ROLLBACK;
