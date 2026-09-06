-- Possession (offense/defense/special teams) + special-teams tags.
-- HELD — do NOT apply to prod until Adam says "ship it" (paired with the tagger UI).
--
-- tags.category is CHECK-constrained; allow the two new categories first.
alter table public.tags drop constraint if exists tags_category_check;
alter table public.tags add constraint tags_category_check
  check (category = any (array['offense','defense','plays','players','special','opponent','period','possession','special_teams']));

-- Possession is a CLIP-LEVEL stamp (like the game period): a sticky OFF/DEF/SP selector
-- stamps every clip with one of these `possession` tags (bundle_number 0), so EXPORT can
-- tell offense from defense/special-teams. It coexists with grouping — it's a lens/stamp,
-- not a replacement for groupable tags. Shared across every sport (sport=null), like periods.
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'possession', v.so, 'global', null, 'neutral'
from (values ('Offense',1),('Defense',2),('Special Teams',3)) as v(name, so)
where not exists (
  select 1 from public.tags t where t.scope='global' and t.category='possession' and t.name = v.name
);

-- Special-teams groupable tags — shown when the SP possession is active (football only).
insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'special_teams', v.so, 'global', s.sport, v.pol
from (values
  ('Kickoff',1,'neutral'),('Punt',2,'neutral'),('Field Goal',3,'neutral'),('PAT',4,'neutral'),
  ('Kick Return',5,'positive'),('Punt Return',6,'positive'),('Return TD',7,'positive'),
  ('Block',8,'positive'),('Good',9,'positive'),('Miss',10,'negative'),('Muff',11,'negative'),
  ('Downed',12,'neutral'),('Onside',13,'neutral'),('Fake',14,'neutral'),('Tackle',15,'positive'),('Penalty',16,'negative')
) as v(name, so, pol)
cross join (values ('Flag Football'),('Football'),('7-on-7')) as s(sport)
where not exists (
  select 1 from public.tags t where t.scope='global' and t.category='special_teams' and t.sport=s.sport and t.name = v.name
);
