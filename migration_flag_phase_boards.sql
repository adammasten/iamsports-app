-- Flag Football → per-phase tag boards (OFF / DEF / SP each show their OWN columns).
-- SCOPE: Flag Football ONLY (sport='Flag Football'). Tackle Football + 7-on-7 UNTOUCHED.
--
-- ⚠️ HELD — do NOT apply until build 55 (phase-board taggers, web+native) is on
--    Adam's phone. Order: taggers → push web → build 55 → confirm on device → THEN this.
--
-- New categories: off_formation, off_play, off_result, def_scheme, def_opp_play,
--   def_our_play, def_result, st_play, st_result. Existing categories kept in the
--   constraint so other sports (formation/play/defense/result) still validate.
-- Tag IDs are preserved on every recategorize. Approved mutations: D Touchdown→TD allowed
--   (rename), Contain + TD allowed promoted to global. No clip_tags reference the deleted
--   Good Play dupes (verified). Safety re-homed to def_result. team customs stay team.
--
-- SAFETY: whole thing runs in one transaction; every INSERT is guarded (idempotent —
--   safe to re-run); a full ROLLBACK block is at the bottom (commented). The one thing
--   rollback CANNOT undo is the destructive delete of the 3 team "Good Play" dupes.

begin;

-- 0) Allow the new categories.
alter table public.tags drop constraint if exists tags_category_check;
alter table public.tags add constraint tags_category_check
  check (category = any (array[
    'offense','defense','plays','players','special','opponent','period','possession',
    'special_teams','formation','play','result',
    'off_formation','off_play','off_result',
    'def_scheme','def_opp_play','def_our_play','def_result',
    'st_play','st_result'
  ]));

-- ============================ OFFENSE ============================
-- off_formation ← all Flag Football formation tags
update public.tags set category='off_formation'
 where sport='Flag Football' and category='formation';

-- off_play ← offense play calls (non-special-teams plays)
update public.tags set category='off_play'
 where sport='Flag Football' and category='play'
   and name in ('Slant','Out','Post','Corner','Go / Fly','Hitch / Curl','Wheel',
     'Crosser / Drag','Screen','Run / Rush','QB scramble','Handoff','Reverse / Trick',
     'Play action','Rollout','Jet Sweep','RPO','Run Left','Run Right','Run Inside',
     'Run Outside','Sweep / Toss','Option / Read');
-- team customs → off_play. These STAY team-scoped (recategorized only; scope/team_id
-- untouched) per Adam — Reverse, Cross, X1, X2, x3.
update public.tags set category='off_play'
 where team_id='ea52c5b6-ff03-4a47-b278-33cb4f4972c4'
   and ((category='offense' and name='Reverse')
     or (category='plays' and name in ('Cross','X1','X2','x3')));

-- off_result ← offense outcomes
update public.tags set category='off_result'
 where sport='Flag Football' and category='result'
   and name in ('Touchdown','Passing TD','Rushing TD','Completion','Deep completion',
     'Big gain (20+)','First down','2-pt conversion','Drop','Incompletion','INT thrown','Fumble');
-- NEW: Penalty in off_result (each phase flags its own) — guarded
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select 'Penalty','off_result',30,'global','Flag Football','negative'
where not exists (
  select 1 from public.tags t
  where t.category='off_result' and t.sport='Flag Football' and t.name='Penalty'
);

-- ============================ DEFENSE ============================
-- def_scheme ← our coverage/scheme. The 7 global schemes recategorize in place.
update public.tags set category='def_scheme'
 where sport='Flag Football' and category='defense'
   and name in ('Man','Zone','Blitz','Cover 2','Cover 3','Combo','Safe');
-- Contain (team-scoped) → def_scheme AND promoted to global (id preserved) per Adam.
update public.tags set category='def_scheme', scope='global', team_id=null
 where id='31c1c256-f85b-411b-94f2-cdc02f771887';

-- def_opp_play ("Their Play") ← NEW separate opponent-play tags (never shared with offense) — guarded
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'def_opp_play', v.so, 'global', 'Flag Football', 'neutral'
from (values
  ('Pass',1),('Deep pass',2),('Screen',3),('Run Left',4),('Run Right',5),
  ('Run Inside',6),('Run Outside',7),('Sweep',8),('Reverse / Trick',9),
  ('QB scramble',10),('Play action',11),('Option',12)
) as v(name, so)
where not exists (
  select 1 from public.tags t
  where t.category='def_opp_play' and t.sport='Flag Football' and t.name=v.name
);

-- def_our_play ("Our Play") ← our defensive actions (moved from result)
update public.tags set category='def_our_play'
 where sport='Flag Football' and category='result'
   and name in ('Flag pull','Missed flag pull','Sack','TFL (behind LOS)','Pass breakup',
     'Interception','Forced fumble','Fumble recovery','QB pressure','Stop / turnover on downs');

-- def_result ← NEW defensive outcomes — guarded
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'def_result', v.so, 'global', 'Flag Football', v.pol
from (values
  ('Completion',1,'negative'),('Incompletion',2,'positive'),('First down allowed',3,'negative'),
  ('No gain',4,'positive'),('Loss',5,'positive'),('Turnover',6,'positive'),('Penalty',7,'negative')
) as v(name, so, pol)
where not exists (
  select 1 from public.tags t
  where t.category='def_result' and t.sport='Flag Football' and t.name=v.name
);
-- reuse the otherwise-homeless existing Safety
update public.tags set category='def_result', sort_order=8
 where sport='Flag Football' and category='result' and name='Safety';
-- team "D Touchdown" → rename "TD allowed", move to def_result, promote to global
-- (Adam-approved rename + promotion; id preserved).
update public.tags set name='TD allowed', category='def_result', sort_order=9,
       scope='global', team_id=null
 where id='79066c1a-2803-4b87-814d-300ea37f690f';

-- ========================= SPECIAL TEAMS =========================
-- st_play ← kicking-game plays
update public.tags set category='st_play'
 where sport='Flag Football' and category='play'
   and name in ('Kickoff','Punt','Field Goal','PAT','Kick Return','Punt Return','Onside','Fake');

-- st_result ← kicking-game outcomes (Penalty already lives here)
update public.tags set category='st_result'
 where sport='Flag Football' and category='result'
   and name in ('Return TD','Block','Good','Miss','Muff','Downed','Tackle','Penalty');

-- ===================== GOOD PLAY (clip-level toggle) =====================
-- Merge the 3 team "Good Play" tags into ONE global 'special' toggle (like ★/POE),
-- shown on every phase and every sport. Zero clip_tags reference the three (verified),
-- so delete all three and seed one global tag (guarded).
delete from public.tags
 where id in ('af6b7118-06a2-4d3f-b83b-0872f90863d5',
              '3b995efd-a1d7-4fba-9bb4-a3bb7709beac',
              '250730de-e7ed-4b74-8398-5ed3b8ca5fa3');
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select 'Good Play','special',2,'global',null,'positive'
where not exists (
  select 1 from public.tags t
  where t.category='special' and t.scope='global' and t.name='Good Play'
);

-- Down/distance/drive (Adam decision 3-A) needs NO schema change — clip_football
-- already has odk/down/distance/drive_id; the taggers just resume writing them.

commit;

notify pgrst, 'reload schema';


-- ============================================================================
-- ROLLBACK — reverses every change above. Uncomment and run to undo.
-- ⚠️ CANNOT restore the 3 deleted team "Good Play" dupes (destructive delete);
--    it only removes the merged global "Good Play". Everything else is reversible
--    because tag IDs were preserved.
-- ============================================================================
/*
begin;

-- 1) delete the NEW inserts
delete from public.tags where category='def_opp_play' and sport='Flag Football';
delete from public.tags where category='def_result' and sport='Flag Football'
   and name in ('Completion','Incompletion','First down allowed','No gain','Loss','Turnover','Penalty');
delete from public.tags where category='off_result' and sport='Flag Football' and name='Penalty';
delete from public.tags where category='special' and scope='global' and name='Good Play';

-- 2) reverse the recategorizations (IDs preserved, so these land back where they were)
update public.tags set category='formation'
 where sport='Flag Football' and category='off_formation';
update public.tags set category='play'
 where sport='Flag Football' and category='off_play' and team_id is null;
update public.tags set category='offense'
 where id='51b61d76-65fc-4b1d-8107-82327b13a43d';                    -- Reverse (team)
update public.tags set category='plays'
 where team_id='ea52c5b6-ff03-4a47-b278-33cb4f4972c4'
   and category='off_play' and name in ('Cross','X1','X2','x3');     -- team customs
update public.tags set category='result'
 where sport='Flag Football' and category='off_result';
update public.tags set category='defense'
 where sport='Flag Football' and category='def_scheme'
   and name in ('Man','Zone','Blitz','Cover 2','Cover 3','Combo','Safe');
update public.tags set category='defense', scope='team',
       team_id='ea52c5b6-ff03-4a47-b278-33cb4f4972c4', sort_order=12
 where id='31c1c256-f85b-411b-94f2-cdc02f771887';                    -- Contain back to team
update public.tags set category='result'
 where sport='Flag Football' and category='def_our_play';
update public.tags set category='result', sort_order=10
 where sport='Flag Football' and category='def_result' and name='Safety';
update public.tags set name='D Touchdown', category='defense', scope='team',
       team_id='ea52c5b6-ff03-4a47-b278-33cb4f4972c4', sort_order=11
 where id='79066c1a-2803-4b87-814d-300ea37f690f';                    -- TD allowed back
update public.tags set category='play'
 where sport='Flag Football' and category='st_play';
update public.tags set category='result'
 where sport='Flag Football' and category='st_result';

-- 3) (optional) restore the pre-migration CHECK constraint (drop the new categories).
--    Safe to skip — a superset constraint is harmless.
-- alter table public.tags drop constraint if exists tags_category_check;
-- alter table public.tags add constraint tags_category_check
--   check (category = any (array['offense','defense','plays','players','special',
--     'opponent','period','possession','special_teams','formation','play','result']));

commit;

notify pgrst, 'reload schema';
*/
