-- migration_period_tags.sql
--
-- Game periods (halves / quarters) as global tags in a new 'period' category.
-- The tagger renders them as a STICKY, mutually-exclusive strip in the top bar:
-- pick one and it stays lit, auto-stamping every saved clip with that period
-- until you switch. Option A labeling — numbers cover both formats: halves use
-- 1st/2nd, quarters use 1st–4th, OT for overtime. No per-game config needed.
--
-- Period tags are clip-level (bundle_number 0) like any clip-wide tag. They are
-- NOT shown in the offense/defense/plays/players columns (the tagger routes
-- category='period' to the strip), and carry no stat_primitive — they only
-- label WHEN a play happened, which powers filters like "2nd-half turnovers".
--
-- Idempotent: re-running replaces the global period set cleanly.

alter table tags drop constraint if exists tags_category_check;
alter table tags add constraint tags_category_check
  check (category = any (array[
    'offense','defense','plays','players','special','opponent','period'
  ]));

delete from tags where category = 'period' and scope = 'global';

insert into tags (name, category, scope, team_id, sort_order) values
  ('1st', 'period', 'global', null, 0),
  ('2nd', 'period', 'global', null, 1),
  ('3rd', 'period', 'global', null, 2),
  ('4th', 'period', 'global', null, 3),
  ('OT',  'period', 'global', null, 4);

notify pgrst, 'reload schema';
