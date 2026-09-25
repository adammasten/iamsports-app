-- SLICE G (Adam, 2026-09-25): standalone 7-on-7 launch taxonomy -- six-column OFF/DEF.
--
-- 7-on-7 stays its OWN SPORT: not Football plus a format, not flag. Pass-only, so there
-- is NO kicking game and NO Special Teams phase -- the 16 special_teams rows retired in
-- Slice D stay retired and no column renders them.
--
-- SAFE BY CONSTRUCTION. 7-on-7 has 0 teams, 0 videos, 0 clips and 0 clip_tags rows
-- referencing any of its tags (re-verified immediately before applying). Every statement
-- is BY ID: no deletions, no id changes, no clip_tags writes, and no constraint change
-- (def_opp_formation / def_opp_play / def_result / off_player_action already pass
-- tags_category_check after Slices E and F).
--
-- DELIBERATELY NOT DONE: 'Undercut / Jump' (a2007804-4842-412f-961d-4f80523748f6) stays
-- NEUTRAL. Adam, 2026-09-25: it is a technique/read, not automatically a successful
-- defensive outcome -- it can lead to either a good or a bad result, so it must not
-- independently authorise parent-highlight eligibility. Do not "fix" this to positive.

-- == 1. OFF player actions: 3 rows move out of off_result, BY ID ==============
-- off_result mixes play FACTS with PLAYER attribution. A drop, a contested catch and a
-- deep completion credit or blame ONE player, which is what the Player Action column is
-- for. Polarity is preserved on all three; the names pick up the approved title case.
update tags set category = 'off_player_action', name = 'Contested Catch', sort_order = 1 where id = '8226c4d9-3f76-4fb0-9e8b-adac671ac7c9'; -- was off_result 'Contested catch', positive
update tags set category = 'off_player_action',                           sort_order = 2 where id = 'e3ad2a44-201a-4be3-844e-3162a4822435'; -- was off_result 'Drop',            negative
update tags set category = 'off_player_action', name = 'Deep Completion', sort_order = 4 where id = '0f77e61f-73f3-4aea-8c1e-f9263c2424f3'; -- was off_result 'Deep completion', positive

-- The two Player Action names that had no row at all. Both are genuine player credits.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Catch',         'off_player_action', 'global', null, '7-on-7', 0, 'positive'),
  ('Pass Complete', 'off_player_action', 'global', null, '7-on-7', 3, 'positive');

-- == 2. DEF "Their Formation" (5 new rows, neutral context) ===================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Trips',  'def_opp_formation', 'global', null, '7-on-7', 0, 'neutral'),
  ('Bunch',  'def_opp_formation', 'global', null, '7-on-7', 1, 'neutral'),
  ('Empty',  'def_opp_formation', 'global', null, '7-on-7', 2, 'neutral'),
  ('Stack',  'def_opp_formation', 'global', null, '7-on-7', 3, 'neutral'),
  ('Motion', 'def_opp_formation', 'global', null, '7-on-7', 4, 'neutral');

-- == 3. DEF "Their Play" (20 new rows, neutral context) ======================
-- A full mirror of our own concept list so a coach can tag what the OPPONENT ran, and so
-- "every Cover 3 snap against Mesh" is one export group. All neutral: what they ran is
-- never a credit to one of our players.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Mesh',            'def_opp_play', 'global', null, '7-on-7',  0, 'neutral'),
  ('Flood',           'def_opp_play', 'global', null, '7-on-7',  1, 'neutral'),
  ('Smash',           'def_opp_play', 'global', null, '7-on-7',  2, 'neutral'),
  ('Levels',          'def_opp_play', 'global', null, '7-on-7',  3, 'neutral'),
  ('Four Verticals',  'def_opp_play', 'global', null, '7-on-7',  4, 'neutral'),
  ('Slant',           'def_opp_play', 'global', null, '7-on-7',  5, 'neutral'),
  ('Out',             'def_opp_play', 'global', null, '7-on-7',  6, 'neutral'),
  ('In / Dig',        'def_opp_play', 'global', null, '7-on-7',  7, 'neutral'),
  ('Post',            'def_opp_play', 'global', null, '7-on-7',  8, 'neutral'),
  ('Corner',          'def_opp_play', 'global', null, '7-on-7',  9, 'neutral'),
  ('Go / Streak',     'def_opp_play', 'global', null, '7-on-7', 10, 'neutral'),
  ('Hitch / Curl',    'def_opp_play', 'global', null, '7-on-7', 11, 'neutral'),
  ('Comeback',        'def_opp_play', 'global', null, '7-on-7', 12, 'neutral'),
  ('Wheel',           'def_opp_play', 'global', null, '7-on-7', 13, 'neutral'),
  ('Seam',            'def_opp_play', 'global', null, '7-on-7', 14, 'neutral'),
  ('Crosser / Drag',  'def_opp_play', 'global', null, '7-on-7', 15, 'neutral'),
  ('Bubble / Screen', 'def_opp_play', 'global', null, '7-on-7', 16, 'neutral'),
  ('Fade',            'def_opp_play', 'global', null, '7-on-7', 17, 'neutral'),
  ('Back Shoulder',   'def_opp_play', 'global', null, '7-on-7', 18, 'neutral'),
  ('Scramble Drill',  'def_opp_play', 'global', null, '7-on-7', 19, 'neutral');

-- == 4. DEF "Their Result" (5 new rows, defence's point of view) ==============
-- Read from OUR defence: an incompletion or a turnover is our coverage winning; a
-- completion, first down or touchdown is not. Same convention as Flag Football (Slice F),
-- deliberately NOT Football's all-neutral results -- 7-on-7's own off_result already
-- carries polarity, and one sport must not use two conventions.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Touchdown',    'def_result', 'global', null, '7-on-7', 0, 'negative'),
  ('First Down',   'def_result', 'global', null, '7-on-7', 1, 'negative'),
  ('Completion',   'def_result', 'global', null, '7-on-7', 2, 'negative'),
  ('Incompletion', 'def_result', 'global', null, '7-on-7', 3, 'positive'),
  ('Turnover',     'def_result', 'global', null, '7-on-7', 4, 'positive');

-- == 5. Approved relabels, BY ID (names only; ids, categories, polarity intact) =
-- Semantic: 'INT thrown' is the same concept flag now calls 'Interception'.
update tags set name = 'Interception' where id = '6d537b14-1b8b-4fc1-b3e5-75be1b86ea35';
-- Title case, to match the approved launch lists. Zero uses on every row.
update tags set name = 'Four Verticals'             where id = '7272ad63-e230-4e3d-85aa-3e9c00c9a0a9';
update tags set name = 'Back Shoulder'              where id = '1a088a84-7b6d-48e1-86ec-5d82bea3e833';
update tags set name = 'Scramble Drill'             where id = 'de1813f0-93a0-4a31-9bb0-e45f1217d8e3';
update tags set name = 'First Down'                 where id = 'f2fe2680-9d9c-4fe9-9efa-b29b67b719af';
update tags set name = '2-pt Conversion'            where id = '710e3130-5038-4e1a-9241-347850f3e8da';
update tags set name = 'Tipped Ball'                where id = '271a8e8a-f0a0-41d5-8562-237a81113436';
update tags set name = 'Blanket Coverage'           where id = 'fb33b235-7b61-4c03-8313-f99652f02895';
update tags set name = 'Forced Incompletion'        where id = 'af9e1e9b-a232-455a-8a95-4e29888aa88d';
update tags set name = 'Stop / Turnover on Downs'   where id = '4d03d3ef-e975-4fe1-aee5-de0d312b6ea3';
update tags set name = 'Pass Breakup / PBU'         where id = 'f8f56d92-e862-46e1-a2e0-def784ff217c';
-- ('Contested Catch' and 'Deep Completion' are relabelled in section 1, with their move,
--  so no row is written twice.)

-- == 6. Sort-order tidy, BY ID (off_play and off_result) =====================
-- off_play had DUPLICATE sort_order values (two 5s, 6s, 7s, 8s, 9s), so chips rendered in
-- a scrambled order. Renumbered 0..19 to the approved launch list. Names/ids untouched.
update tags set sort_order =  0 where id = '1b2a08ed-e836-42b9-b2d0-dd76c63cf40c'; -- Mesh
update tags set sort_order =  1 where id = '79ba969f-aac0-4763-93a5-aa6359c7c84e'; -- Flood
update tags set sort_order =  2 where id = '29c5b70b-6e9e-48e8-b8d2-cb27282d30be'; -- Smash
update tags set sort_order =  3 where id = '4323d922-eda7-4db2-b239-3093e6dfad18'; -- Levels
update tags set sort_order =  4 where id = '7272ad63-e230-4e3d-85aa-3e9c00c9a0a9'; -- Four Verticals
update tags set sort_order =  5 where id = '13b9bb0f-dc36-4aef-9036-20c6f5ee9d69'; -- Slant
update tags set sort_order =  6 where id = 'fe9f51dd-37d7-4535-8e03-a544d1fea4c5'; -- Out
update tags set sort_order =  7 where id = '6bf00f9b-1b72-4e28-9980-ae83ba8768d0'; -- In / Dig
update tags set sort_order =  8 where id = 'eaf6ff40-4306-474d-a4c4-14f3e1371d94'; -- Post
update tags set sort_order =  9 where id = '78fed15b-bcc1-4ed2-a76e-246ea8bd66f0'; -- Corner
update tags set sort_order = 10 where id = '24452f91-2a46-4254-a61a-2f6dd1ee51ff'; -- Go / Streak
update tags set sort_order = 11 where id = '5002915e-6eae-4290-a57e-059964de741b'; -- Hitch / Curl
update tags set sort_order = 12 where id = 'f7f4b81f-b8dd-4e46-bfa1-b08782b5de6d'; -- Comeback
update tags set sort_order = 13 where id = 'b828df97-c9f3-474d-8587-860bb370c6a3'; -- Wheel
update tags set sort_order = 14 where id = '9e3aff30-98e3-4e63-9cd0-20b26d834e18'; -- Seam
update tags set sort_order = 15 where id = '719785a4-7df5-4ddd-bf37-84175a85fcf7'; -- Crosser / Drag
update tags set sort_order = 16 where id = '1282e61c-2106-4533-8f23-7db9ee67c1ce'; -- Bubble / Screen
update tags set sort_order = 17 where id = '48b89b61-818c-4afe-8900-3d45eb465a48'; -- Fade
update tags set sort_order = 18 where id = '1a088a84-7b6d-48e1-86ec-5d82bea3e833'; -- Back Shoulder
update tags set sort_order = 19 where id = 'de1813f0-93a0-4a31-9bb0-e45f1217d8e3'; -- Scramble Drill

-- off_result renumbered 0..5 to the approved launch list (the 3 moved rows are gone).
update tags set sort_order = 0 where id = '5fbb062b-4f07-4eed-aa60-c060e4e7b6bf'; -- Touchdown
update tags set sort_order = 1 where id = 'f2fe2680-9d9c-4fe9-9efa-b29b67b719af'; -- First Down
update tags set sort_order = 2 where id = '710e3130-5038-4e1a-9241-347850f3e8da'; -- 2-pt Conversion
update tags set sort_order = 3 where id = '4f6a7171-f77f-40f3-89da-9c6fcb65a8bc'; -- Completion
update tags set sort_order = 4 where id = 'fce19c72-1ae3-4760-9f82-e31f08459f5e'; -- Incompletion
update tags set sort_order = 5 where id = '6d537b14-1b8b-4fc1-b3e5-75be1b86ea35'; -- Interception

-- APPLIED LIVE 2026-09-25 as Supabase migration <server stamp>_seven_on_seven_launch_taxonomy
-- (identical statements; the applied copy carries trimmed header comments).
--
-- VERIFIED after apply:
--   tags 711 -> 743 (+32 inserts exactly); 7-on-7 73 -> 105; retired still 16 and all 16
--   are still the special_teams rows; clip_tags 1535 UNCHANGED and still 0 rows on any
--   7-on-7 tag; 0 teams / 0 videos for the sport.
--   Control sports untouched: Football 142, Flag Football 135 (5 retired), Basketball 60.
--   Regents parent-eligible pairs still 60 (no flag row was touched).
--   'Undercut / Jump' still NEUTRAL, as decided.
--   NO duplicate name inside any 7-on-7 column.
--   Rendered chip order, per column:
--     Our Formation (5)      Trips · Bunch · Empty · Stack · Motion
--     Their Coverage (7)     Man · Zone · Cover 1 · Cover 2 · Cover 3 · Cover 4 · Blitz
--     Our Play (20)          Mesh · Flood · Smash · Levels · Four Verticals · Slant · Out ·
--                            In / Dig · Post · Corner · Go / Streak · Hitch / Curl ·
--                            Comeback · Wheel · Seam · Crosser / Drag · Bubble / Screen ·
--                            Fade · Back Shoulder · Scramble Drill
--     Our Result (6)         Touchdown⁺ · First Down⁺ · 2-pt Conversion⁺ · Completion⁺ ·
--                            Incompletion⁻ · Interception⁻
--     Our Player Action (5)  Catch⁺ · Contested Catch⁺ · Drop⁻ · Pass Complete⁺ · Deep Completion⁺
--     Their Formation (5)    Trips · Bunch · Empty · Stack · Motion
--     Our Coverage (7)       Man · Zone · Cover 1 · Cover 2 · Cover 3 · Cover 4 · Blitz
--     Their Play (20)        same 20 concepts as Our Play, all neutral
--     Their Result (5)       Touchdown⁻ · First Down⁻ · Completion⁻ · Incompletion⁺ · Turnover⁺
--     Our Player Action (9)  Interception⁺ · Pass Breakup / PBU⁺ · Deflection⁺ · Tipped Ball⁺ ·
--                            Blanket Coverage⁺ · Forced Incompletion⁺ · Undercut / Jump (neutral) ·
--                            Pressure⁺ · Stop / Turnover on Downs⁺
--
-- ROLLBACK (all by id): delete the 32 inserted rows; move Contested Catch (sort 19),
-- Drop (21) and Deep Completion (2) back to off_result with their lower-case names;
-- restore the 11 relabelled names; restore the previous off_play / off_result sort_orders
-- (they were 4..18 with duplicates, and 0,1,3,20,22,23 respectively).
