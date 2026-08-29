-- Applied live 2026-08-28 via Supabase MCP (apply_migration).
--
-- The tagging screen (app/tagging-overlay.tsx) already contained a game-period
-- selector: it loads category='period' tags into `periodTags` and, on save,
-- stamps the active period's tag_id onto the clip (clip_tags, bundle_number 0).
-- But the tags.category CHECK constraint only allowed
-- offense/defense/plays/players/special/opponent — NOT 'period' — so no period
-- tag could ever exist and the feature was dormant.
--
-- This migration:
--   1) adds 'period' to the allowed categories (additive; no existing row violates), and
--   2) seeds the 6 basketball periods as GLOBAL tags (team_id NULL, scope 'global')
--      so the selector renders and saves for every team. The tagging UI decides
--      which periods to show per sport (basketball → Q1..Q4, 1H, 2H).

alter table public.tags drop constraint tags_category_check;
alter table public.tags add constraint tags_category_check
  check (category = any (array['offense','defense','plays','players','special','opponent','period']));

insert into tags (team_id, name, category, scope, sort_order)
select null, v.name, 'period', 'global', v.ord
from (values ('Q1',0),('Q2',1),('Q3',2),('Q4',3),('1H',4),('2H',5)) as v(name, ord)
where not exists (
  select 1 from tags t where t.category='period' and t.scope='global' and t.name = v.name
);
