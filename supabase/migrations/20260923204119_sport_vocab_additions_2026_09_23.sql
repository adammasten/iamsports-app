-- Approved global sport-vocabulary additions (Adam, 2026-09-23). ADDITIVE-FIRST.
-- APPLIED LIVE 2026-09-23 as migration 20260923204119_sport_vocab_additions_2026_09_23.
--
-- Inserts only + three display-name relabels that PRESERVE the existing tag ids.
-- No tag is deleted, no category changes, no clip_tags touched, no id changes.
-- All target categories already exist in the shared sport definition
-- (lib/core/tag-categories.ts) and are already rendered by My Tags, both taggers
-- and Export, so these flow through with ZERO code changes.
--
-- HELD, deliberately NOT included:
--   '1-pt conversion' and 'Twins' -- 5v5-only vocabulary; held until teams.format
--     exists, otherwise they surface for every Flag Football team including 7v7.
--   'No Run Zone' -- field-position context, same class as down/distance. Belongs
--     with the football situation fields (clip_football), not the board; held until
--     those fields are actually captured and exportable. Do not add it as a board
--     tag: that would store one concept in two models.

-- 1. SOCCER -- general foul drawn (distinct from the box-only 'Penalty won').
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity)
values ('Foul Won / Foul Drawn', 'offense', 'global', null, 'Soccer', 19, 'positive');

-- 2. LACROSSE -- Draw Control sits with Face-off win/loss, its structural twin, so
--    the pair moves together whenever the taxonomy round reclassifies them.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity)
values ('Draw Control', 'plays', 'global', null, 'Lacrosse', 14, 'positive');

-- 3. LACROSSE -- Penalty Drawn is the inverse of the committed foul (puts us
--    man-up), so it is an offensive player action, mirroring Soccer's 'Penalty won'.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity)
values ('Penalty Drawn', 'offense', 'global', null, 'Lacrosse', 16, 'positive');

-- 4. BASEBALL / SOFTBALL -- batting outcomes that reach base without a hit.
--    Fielder's Choice and Reached on Error are neutral: reaching base, but not earned.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Fielder''s Choice', 'offense', 'global', null, 'Baseball', 18, 'neutral'),
  ('Reached on Error',  'offense', 'global', null, 'Baseball', 19, 'neutral'),
  ('Sac Fly',           'offense', 'global', null, 'Baseball', 20, 'positive'),
  ('Fielder''s Choice', 'offense', 'global', null, 'Softball', 19, 'neutral'),
  ('Reached on Error',  'offense', 'global', null, 'Softball', 20, 'neutral'),
  ('Sac Fly',           'offense', 'global', null, 'Softball', 21, 'positive');

-- 5. RELABELS -- display name only, BY ID, so historical clip_tags stay valid.
--    'Sacrifice' becomes 'Sac Bunt' now that 'Sac Fly' exists alongside it;
--    'Penalty / foul' becomes 'Penalty Committed' now that 'Penalty Drawn' exists.
--    All three rows were referenced by ZERO clip_tags at apply time (verified), and
--    no code matches these names as strings (verified by grep), so this is cosmetic.
update tags set name = 'Penalty Committed' where id = '928126b4-15ce-421c-b850-c259836274f0';
update tags set name = 'Sac Bunt'          where id = '28efe623-bf24-415a-8a22-151abdd2c4dd';
update tags set name = 'Sac Bunt'          where id = '3a030e4d-5ed7-4626-8bd3-7e0900f87530';

-- Post-apply verification (2026-09-23): tags 545 -> 554 (+9 exactly); all three
-- relabelled ids unchanged; held tags absent; old names absent; export baseline
-- re-ran byte-identical on all 7 groups incl. the must-stay-empty control.
