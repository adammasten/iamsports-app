-- SLICE E (Adam, 2026-09-24): 11v11 Football launch taxonomy.
-- APPLIED LIVE as Supabase migration 20260925032952_football_11v11_taxonomy
-- (the live version stamp is the server's UTC clock; the repo filename keeps this
-- workstream's local ordering, same as the Slice D file).
--
-- Football is greenfield: 0 teams, 0 videos, 0 clips, and 0 clip_tags rows referencing
-- any Football tag (re-verified immediately before applying). There is no historical
-- Football data to preserve, so nothing here can regress.
--
-- The 16 existing special_teams rows are RECATEGORISED BY ID across st_play /
-- st_result / st_player_action -- reused, never duplicated, never deleted.
--
-- The statements below are the exact SQL as applied.

-- == 1. Three new category keys =============================================
alter table tags drop constraint if exists tags_category_check;
alter table tags add constraint tags_category_check check (category = any (array[
  'offense','defense','plays','players','special','opponent','period','possession',
  'special_teams','formation','play','result',
  'off_formation','off_play','off_result','off_opp_look','off_player_action',
  'def_scheme','def_opp_play','def_our_play','def_result','def_opp_formation',
  'st_play','st_result','st_player_action'
]::text[]));

-- == 2. Reclassify the 16 existing Football SP rows BY ID ===================
-- st_play (play types). Kick Return / Punt Return move here and therefore become
-- NEUTRAL: they describe the kind of play, not a good outcome.
update tags set category = 'st_play', sort_order = 0 where id = 'a58b65d5-a425-4fb1-96ad-f15864b14729'; -- Kickoff
update tags set category = 'st_play', sort_order = 1 where id = '9ae8b840-f2e2-4e31-9c4f-4d3b32275c02'; -- Punt
update tags set category = 'st_play', sort_order = 2 where id = 'e489785f-c225-4a3c-9b27-fba211ed8c50'; -- Field Goal
update tags set category = 'st_play', sort_order = 3 where id = 'ed142f4c-89c3-4243-b4ba-c20f980ccaf5'; -- PAT
update tags set category = 'st_play', sort_order = 4, tag_polarity = 'neutral' where id = '32b9c07f-77bb-40cd-9d4f-b07efa9cfb79'; -- Kick Return (was positive)
update tags set category = 'st_play', sort_order = 5, tag_polarity = 'neutral' where id = 'a4c9463f-2a4c-4d5f-9264-7b87ccaa45b1'; -- Punt Return (was positive)
update tags set category = 'st_play', sort_order = 6 where id = '4654d8ac-48a9-48d6-809f-757e8ff35494'; -- Onside
update tags set category = 'st_play', sort_order = 7 where id = 'c8b42847-d7ed-4937-a609-c7c5e8497b5e'; -- Fake

-- st_result (play outcomes). Existing polarities are deliberate and preserved.
update tags set category = 'st_result', sort_order = 0 where id = 'eca4183b-076e-4ea8-90ff-7934fe99dcf1'; -- Good     (positive)
update tags set category = 'st_result', sort_order = 1 where id = 'a0ee40d1-25b5-4b1a-abe3-a917ced3116c'; -- Miss     (negative)
update tags set category = 'st_result', sort_order = 2 where id = 'da316cc3-0dc6-481c-80ae-2db39b78b466'; -- Muff     (negative)
update tags set category = 'st_result', sort_order = 3 where id = 'ccf15545-20af-4bab-ad2a-48ede8b9aa34'; -- Downed   (neutral)
update tags set category = 'st_result', sort_order = 4 where id = '3ffbf81b-7618-40a7-8fec-d752acbc6be8'; -- Block    (positive)
update tags set category = 'st_result', sort_order = 5 where id = 'ad239f9d-dcf7-4e9d-9866-4c8f22da4ca3'; -- Penalty  (negative)

-- st_player_action (what a specific player did). Both stay positive.
update tags set category = 'st_player_action', sort_order = 0 where id = '7c0a9611-8553-4f34-896e-c8d1ff95f1f7'; -- Return TD
update tags set category = 'st_player_action', sort_order = 1 where id = '2a73d629-0d02-4b1d-b219-6807af65219f'; -- Tackle

-- == 3. OFFENSE vocabulary =================================================
-- Context (formation / opponent look / play call) is NEUTRAL throughout, so no
-- play-context tag can qualify a child for a parent highlight.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Shotgun','off_formation','global',null,'Football',0,'neutral'),
  ('Pistol','off_formation','global',null,'Football',1,'neutral'),
  ('Under Center','off_formation','global',null,'Football',2,'neutral'),
  ('Trips','off_formation','global',null,'Football',3,'neutral'),
  ('Twins','off_formation','global',null,'Football',4,'neutral'),
  ('Bunch','off_formation','global',null,'Football',5,'neutral'),
  ('Empty','off_formation','global',null,'Football',6,'neutral'),
  ('Ace / 2x2','off_formation','global',null,'Football',7,'neutral'),
  ('I-Form','off_formation','global',null,'Football',8,'neutral'),
  ('Singleback','off_formation','global',null,'Football',9,'neutral'),
  ('Wing / Tight','off_formation','global',null,'Football',10,'neutral'),
  ('Motion','off_formation','global',null,'Football',11,'neutral'),

  ('4-3','off_opp_look','global',null,'Football',0,'neutral'),
  ('3-4','off_opp_look','global',null,'Football',1,'neutral'),
  ('4-2-5','off_opp_look','global',null,'Football',2,'neutral'),
  ('3-3-5','off_opp_look','global',null,'Football',3,'neutral'),
  ('Nickel','off_opp_look','global',null,'Football',4,'neutral'),
  ('Dime','off_opp_look','global',null,'Football',5,'neutral'),
  ('Even','off_opp_look','global',null,'Football',6,'neutral'),
  ('Odd','off_opp_look','global',null,'Football',7,'neutral'),
  ('Bear','off_opp_look','global',null,'Football',8,'neutral'),
  ('Man','off_opp_look','global',null,'Football',9,'neutral'),
  ('Cover 1','off_opp_look','global',null,'Football',10,'neutral'),
  ('Cover 2','off_opp_look','global',null,'Football',11,'neutral'),
  ('Cover 3','off_opp_look','global',null,'Football',12,'neutral'),
  ('Cover 4','off_opp_look','global',null,'Football',13,'neutral'),
  ('Cover 6','off_opp_look','global',null,'Football',14,'neutral'),
  ('Blitz / Pressure','off_opp_look','global',null,'Football',15,'neutral'),

  ('Inside Zone','off_play','global',null,'Football',0,'neutral'),
  ('Outside Zone','off_play','global',null,'Football',1,'neutral'),
  ('Power','off_play','global',null,'Football',2,'neutral'),
  ('Counter','off_play','global',null,'Football',3,'neutral'),
  ('Duo','off_play','global',null,'Football',4,'neutral'),
  ('Trap','off_play','global',null,'Football',5,'neutral'),
  ('Sweep / Toss','off_play','global',null,'Football',6,'neutral'),
  ('Draw','off_play','global',null,'Football',7,'neutral'),
  ('Option / Read','off_play','global',null,'Football',8,'neutral'),
  ('RPO','off_play','global',null,'Football',9,'neutral'),
  ('Play Action','off_play','global',null,'Football',10,'neutral'),
  ('Slant','off_play','global',null,'Football',11,'neutral'),
  ('Mesh','off_play','global',null,'Football',12,'neutral'),
  ('Flood','off_play','global',null,'Football',13,'neutral'),
  ('Smash','off_play','global',null,'Football',14,'neutral'),
  ('Four Verticals','off_play','global',null,'Football',15,'neutral'),
  ('Screen','off_play','global',null,'Football',16,'neutral'),
  ('Boot / Rollout','off_play','global',null,'Football',17,'neutral'),
  ('Deep Shot','off_play','global',null,'Football',18,'neutral'),

  ('Touchdown','off_result','global',null,'Football',0,'neutral'),
  ('First Down','off_result','global',null,'Football',1,'neutral'),
  ('Completion','off_result','global',null,'Football',2,'neutral'),
  ('Incompletion','off_result','global',null,'Football',3,'neutral'),
  ('Gain','off_result','global',null,'Football',4,'neutral'),
  ('No Gain','off_result','global',null,'Football',5,'neutral'),
  ('Loss','off_result','global',null,'Football',6,'neutral'),
  ('Sack','off_result','global',null,'Football',7,'neutral'),
  ('Interception','off_result','global',null,'Football',8,'neutral'),
  ('Fumble','off_result','global',null,'Football',9,'neutral'),
  ('Penalty','off_result','global',null,'Football',10,'neutral'),

  ('Carry','off_player_action','global',null,'Football',0,'neutral'),
  ('Catch','off_player_action','global',null,'Football',1,'positive'),
  ('Drop','off_player_action','global',null,'Football',2,'negative'),
  ('Pass Complete','off_player_action','global',null,'Football',3,'positive'),
  ('TD Pass','off_player_action','global',null,'Football',4,'positive'),
  ('Rush TD','off_player_action','global',null,'Football',5,'positive'),
  ('Block','off_player_action','global',null,'Football',6,'neutral'),
  ('Pancake','off_player_action','global',null,'Football',7,'positive'),
  ('Broken Tackle','off_player_action','global',null,'Football',8,'positive'),
  ('Missed Block','off_player_action','global',null,'Football',9,'negative');

-- == 4. DEFENSE vocabulary =================================================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Shotgun','def_opp_formation','global',null,'Football',0,'neutral'),
  ('Pistol','def_opp_formation','global',null,'Football',1,'neutral'),
  ('Under Center','def_opp_formation','global',null,'Football',2,'neutral'),
  ('Trips','def_opp_formation','global',null,'Football',3,'neutral'),
  ('Twins','def_opp_formation','global',null,'Football',4,'neutral'),
  ('Bunch','def_opp_formation','global',null,'Football',5,'neutral'),
  ('Empty','def_opp_formation','global',null,'Football',6,'neutral'),
  ('Ace / 2x2','def_opp_formation','global',null,'Football',7,'neutral'),
  ('I-Form','def_opp_formation','global',null,'Football',8,'neutral'),
  ('Singleback','def_opp_formation','global',null,'Football',9,'neutral'),

  ('Man','def_scheme','global',null,'Football',0,'neutral'),
  ('Cover 1','def_scheme','global',null,'Football',1,'neutral'),
  ('Cover 2','def_scheme','global',null,'Football',2,'neutral'),
  ('Cover 3','def_scheme','global',null,'Football',3,'neutral'),
  ('Cover 4','def_scheme','global',null,'Football',4,'neutral'),
  ('Cover 6','def_scheme','global',null,'Football',5,'neutral'),
  ('Quarters','def_scheme','global',null,'Football',6,'neutral'),
  ('Tampa 2','def_scheme','global',null,'Football',7,'neutral'),
  ('Zone Pressure','def_scheme','global',null,'Football',8,'neutral'),
  ('Man Blitz','def_scheme','global',null,'Football',9,'neutral'),
  ('Contain','def_scheme','global',null,'Football',10,'neutral'),
  ('Goal Line','def_scheme','global',null,'Football',11,'neutral'),

  ('Inside Zone','def_opp_play','global',null,'Football',0,'neutral'),
  ('Outside Zone','def_opp_play','global',null,'Football',1,'neutral'),
  ('Power','def_opp_play','global',null,'Football',2,'neutral'),
  ('Counter','def_opp_play','global',null,'Football',3,'neutral'),
  ('Sweep','def_opp_play','global',null,'Football',4,'neutral'),
  ('Screen','def_opp_play','global',null,'Football',5,'neutral'),
  ('RPO','def_opp_play','global',null,'Football',6,'neutral'),
  ('Slant','def_opp_play','global',null,'Football',7,'neutral'),
  ('Mesh','def_opp_play','global',null,'Football',8,'neutral'),
  ('Deep Pass','def_opp_play','global',null,'Football',9,'neutral'),
  ('Play Action','def_opp_play','global',null,'Football',10,'neutral'),
  ('QB Draw / Scramble','def_opp_play','global',null,'Football',11,'neutral'),

  ('Touchdown','def_result','global',null,'Football',0,'neutral'),
  ('First Down','def_result','global',null,'Football',1,'neutral'),
  ('Completion','def_result','global',null,'Football',2,'neutral'),
  ('Incompletion','def_result','global',null,'Football',3,'neutral'),
  ('No Gain','def_result','global',null,'Football',4,'neutral'),
  ('Loss','def_result','global',null,'Football',5,'neutral'),
  ('Turnover','def_result','global',null,'Football',6,'neutral'),
  ('Penalty','def_result','global',null,'Football',7,'neutral'),

  -- def_our_play is PRESERVED as the DEF Player Action key (label change only,
  -- handled in the shared definition -- the key itself is never renamed).
  ('Tackle','def_our_play','global',null,'Football',0,'positive'),
  ('TFL','def_our_play','global',null,'Football',1,'positive'),
  ('Sack','def_our_play','global',null,'Football',2,'positive'),
  ('PBU','def_our_play','global',null,'Football',3,'positive'),
  ('Interception','def_our_play','global',null,'Football',4,'positive'),
  ('Pressure','def_our_play','global',null,'Football',5,'positive'),
  ('QB Hit','def_our_play','global',null,'Football',6,'positive'),
  ('Forced Fumble','def_our_play','global',null,'Football',7,'positive'),
  ('Fumble Recovery','def_our_play','global',null,'Football',8,'positive'),
  ('Missed Tackle','def_our_play','global',null,'Football',9,'negative');

-- == 5. SPECIAL TEAMS player actions still missing ==========================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Kick','st_player_action','global',null,'Football',2,'neutral'),
  ('Punt','st_player_action','global',null,'Football',3,'neutral'),
  ('Return','st_player_action','global',null,'Football',4,'neutral'),
  ('Block','st_player_action','global',null,'Football',5,'positive'),
  ('Snap','st_player_action','global',null,'Football',6,'neutral'),
  ('Hold','st_player_action','global',null,'Football',7,'neutral');

-- General play RESULTS (off_result / def_result) are all NEUTRAL by decision: parent-
-- highlight semantics are not being invented in this slice, and a neutral play result
-- cannot qualify a child for a highlight on its own.
--
-- VERIFIED after apply (2026-09-24): Football rows 16 -> 142 (+126 inserts, 16 rows
-- recategorised in place, 0 deleted, 0 retired); per category off_formation=12
-- off_opp_look=16 off_play=19 off_result=11 off_player_action=10 def_opp_formation=10
-- def_scheme=12 def_opp_play=12 def_result=8 def_our_play=10 st_play=8 st_result=6
-- st_player_action=8; special_teams now holds 0 Football rows; tags 563 -> 689;
-- clip_tags 1535 unchanged and still 0 rows referencing a Football tag; every other
-- sport's row count unchanged.
--
-- ROLLBACK (all by id, nothing destructive): delete the 126 inserted rows, set the 16
-- reclassified rows back to category='special_teams' with their original sort_order,
-- restore Kick Return / Punt Return to positive, and drop off_player_action /
-- def_opp_formation / st_player_action from tags_category_check.
