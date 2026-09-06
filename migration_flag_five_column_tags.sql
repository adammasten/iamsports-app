-- Flag football → 5 GROUPABLE columns (Formation · Play · Defense · Result · Players).
-- Applied live 2026-09-06. Recategorizes existing Flag Football tags (IDs unchanged, so
-- already-tagged clips stay valid) into new categories; the tagger renders these 5 for
-- football sports. Possession (OFF/DEF/SP) stays a separate sticky clip-level stamp.

alter table public.tags drop constraint if exists tags_category_check;
alter table public.tags add constraint tags_category_check
  check (category = any (array['offense','defense','plays','players','special','opponent','period','possession','special_teams','formation','play','result']));

update public.tags set category='formation'
 where scope='global' and sport='Flag Football' and name in ('Trips','Bunch','Empty','Spread','Stack','Motion');
update public.tags set category='defense', name = case name when 'Man coverage' then 'Man' when 'Zone coverage' then 'Zone' else name end
 where scope='global' and sport='Flag Football' and name in ('Man coverage','Zone coverage','Cover 2','Cover 3','Blitz');
update public.tags set category='result'
 where scope='global' and sport='Flag Football' and category='defense'
   and name in ('Flag pull','Sack','TFL (behind LOS)','Pass breakup','Interception','Forced fumble','Fumble recovery','QB pressure','Missed flag pull','Stop / turnover on downs','Safety');
update public.tags set category='result'
 where scope='global' and sport='Flag Football' and category='offense'
   and name in ('Touchdown','Passing TD','Rushing TD','Completion','Deep completion','Big gain (20+)','First down','2-pt conversion','Drop','Incompletion','INT thrown','Fumble');
update public.tags set category='play'
 where scope='global' and sport='Flag Football' and category='offense';

insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'defense', v.so, 'global', 'Flag Football', 'neutral'
from (values ('Combo',20),('Safe',21)) as v(name, so)
where not exists (select 1 from public.tags t where t.scope='global' and t.sport='Flag Football' and t.category='defense' and t.name=v.name);
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'formation', v.so, 'global', 'Flag Football', 'neutral'
from (values ('Deuce',20),('Trey',21)) as v(name, so)
where not exists (select 1 from public.tags t where t.scope='global' and t.sport='Flag Football' and t.category='formation' and t.name=v.name);

-- Fold flag special-teams into the 5 columns (plays → play, outcomes → result).
update public.tags set category='play'
 where scope='global' and sport='Flag Football' and category='special_teams'
   and name in ('Kickoff','Punt','Field Goal','PAT','Kick Return','Punt Return','Onside','Fake');
update public.tags set category='result'
 where scope='global' and sport='Flag Football' and category='special_teams'
   and name in ('Return TD','Block','Good','Miss','Muff','Downed','Tackle','Penalty');
