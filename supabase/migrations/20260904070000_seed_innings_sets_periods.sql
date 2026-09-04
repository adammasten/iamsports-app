-- Canonical copy: root migration_seed_innings_sets_periods.sql.

-- Seed period tags for innings (baseball/softball) + sets (volleyball) so those
-- sports get a sport-relevant period selector. Period tags are sport=null globals
-- (shared); which ones RENDER per sport is controlled by PERIODS_BY_SPORT in
-- lib/core/periods.ts (baseball/softball -> '1'..'9','EX'; volleyball -> 'S1'..'S5').
-- Idempotent: only inserts names not already present.

insert into public.tags (name, category, sort_order, scope, sport, tag_polarity)
select v.name, 'period', v.so, 'global', null, 'neutral'
from (values
  ('1',10),('2',11),('3',12),('4',13),('5',14),('6',15),('7',16),('8',17),('9',18),('EX',19),
  ('S1',20),('S2',21),('S3',22),('S4',23),('S5',24)
) as v(name, so)
where not exists (
  select 1 from public.tags t
  where t.scope='global' and t.category='period' and t.name = v.name
);
