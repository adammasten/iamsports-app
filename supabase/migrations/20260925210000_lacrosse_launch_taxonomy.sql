-- SLICE J (Adam, 2026-09-25): Lacrosse launch taxonomy -- six-column OFF/DEF.
--
-- Lacrosse is GREENFIELD: 0 teams, 0 videos, 0 clips, 0 clip_tags rows on any lacrosse tag
-- (re-verified immediately before applying), so code + data ship in ONE slice.
--
-- Every statement is BY ID. No deletions, no id changes, no clip_tags writes, no constraint
-- change -- the ten keys are the football-family keys, which Football owns the shared master
-- labels for, so lacrosse's wording ("Our Set", "Their Defense") is board-only.
--
-- 38 rows recategorised (28 relabelled, 5 with a polarity correction), 33 new rows,
-- 5 zero-use legacy rows RETIRED not deleted.
--
-- POLARITY RULE (consistent with Basketball, Soccer and the rest):
--   NEUTRAL  = situation / technique / rotation -- Fast Break, Clear, Time-and-Room Shot,
--              On-the-Run Shot, Slide, and every set / scheme / opponent look / pattern
--   POSITIVE = achievement -- Assist / Feed, Dodge Beat Defender, Inside Finish, Ground Ball,
--              Draw Control Won, Face-off Won, Penalty Drawn, Save, Caused Turnover,
--              Stick Check, Interception, Shot Block, Ride Forces Turnover, Successful
--              Clear, Successful Ride
-- Nothing in a context column can independently authorise a parent highlight.
--
-- NOTE on the three name pairs with OPPOSITE polarity -- deliberate, and unambiguous because
-- they sit in different columns: Failed Clear (ours, off_result, negative) vs Failed Clear
-- (theirs, def_result, positive); Goal (ours positive / theirs negative); Turnover (ours
-- negative / theirs positive). Same convention as Flag, Soccer and Basketball.

-- == 1. -> off_formation · Our Set (6 rows) ===================================
update tags set category='off_formation', sort_order=0, name='Settled Offense' where id='a2a4f9f2-cee9-49a5-86d6-634e3fbabfca';
update tags set category='off_formation', sort_order=1, name='Fast Break', tag_polarity='neutral' where id='04321d8b-6b25-449b-bdf2-5962639e8c4b'; -- was POSITIVE; it is a situation
update tags set category='off_formation', sort_order=2                     where id='388b2791-312a-4db3-b072-617376f94446'; -- Transition
update tags set category='off_formation', sort_order=3, name='Two-Man Game' where id='dce3a066-7936-455b-8df5-c3eec2662e4f';
update tags set category='off_formation', sort_order=4, name='Man-Up / EMO' where id='042d6c76-d18b-406e-95e5-9df2bb65bc78'; -- was 'Man-up (EMO)'
update tags set category='off_formation', sort_order=5, tag_polarity='neutral' where id='611f65fe-8808-439a-a1cd-d2e897250193'; -- 'Clear', was POSITIVE

-- == 2. -> off_result · Our Result (7 rows; Successful Clear is new at 6) =====
update tags set category='off_result', sort_order=0                              where id='b8495478-d302-4aaa-ad74-b6027c2d45b1'; -- Goal            positive
update tags set category='off_result', sort_order=1, name='Shot on Goal'          where id='4059bd86-0e07-45e1-a1ad-43d5aec02a73'; -- positive
update tags set category='off_result', sort_order=2, name='Miss'                  where id='b223d0b2-50e0-454b-a3c9-afe6a416addc'; -- was 'Shot missed', negative
update tags set category='off_result', sort_order=3, name='Pipe'                  where id='23f149c7-d467-47f0-9588-9fda56d237df'; -- was 'Shot off pipe', neutral
update tags set category='off_result', sort_order=4                              where id='30f3ef0d-a913-42c5-bb2c-b29314b8b9b3'; -- Turnover        negative
update tags set category='off_result', sort_order=5, name='Shot Clock Violation'  where id='8c1da898-c9ff-4a54-831f-82c8dbe39bd2'; -- negative
-- OUR failed clear is an offensive-transition RESULT, not a defensive stat -- moves phases.
update tags set category='off_result', sort_order=7, name='Failed Clear'          where id='cab2fa39-26f8-4902-8fa4-e46f06a9f925'; -- was defense 'Failed clear', negative

-- == 3. -> off_player_action · OFF Our Player Action (10 rows) ================
update tags set category='off_player_action', sort_order=0,  name='Assist / Feed'        where id='a271bfb0-e174-4868-8a83-dd993dac79fe'; -- POSITIVE (created a goal)
update tags set category='off_player_action', sort_order=1,  name='Dodge Beat Defender'  where id='3a6565fa-7b3e-46da-9ff8-3e20dfa63836'; -- POSITIVE (beat a defender)
update tags set category='off_player_action', sort_order=2,  name='Inside Finish'        where id='a3d0a8b4-da8a-4cdc-84e2-909e0b5da304'; -- POSITIVE (a finish)
update tags set category='off_player_action', sort_order=3,  name='Time-and-Room Shot', tag_polarity='neutral' where id='490c2c20-1376-4c52-9c4a-51d7e28ae6c2'; -- shot TYPE
update tags set category='off_player_action', sort_order=4,  name='On-the-Run Shot',    tag_polarity='neutral' where id='31186002-3ae2-4b1e-be59-126814bb06ef'; -- shot TYPE
update tags set category='off_player_action', sort_order=5,  name='Ground Ball'          where id='a42c15bf-e136-45d2-a905-54d762784ccc'; -- was 'Ground ball (offense)', POSITIVE
update tags set category='off_player_action', sort_order=7,  name='Draw Control Won'     where id='cc521d41-a12b-4708-af47-9f636f26ac6a'; -- was plays 'Draw Control', POSITIVE
update tags set category='off_player_action', sort_order=9,  name='Face-off Won'         where id='de7c5aff-7aa6-4747-b1e0-41b8698859bd'; -- was plays 'Face-off win', POSITIVE
update tags set category='off_player_action', sort_order=10, name='Face-off Lost'        where id='190351ed-3755-454d-a4b6-34344d4e4d4a'; -- was plays 'Face-off loss', NEGATIVE
update tags set category='off_player_action', sort_order=11                              where id='4cb0149d-225e-4cd2-b220-81587596db49'; -- Penalty Drawn, POSITIVE

-- == 4. -> def_scheme · Our Scheme (4 rows -- the whole column, 0 new) ========
update tags set category='def_scheme', sort_order=0, name='Man'      where id='4f032df9-b71b-485d-a701-239b914c7de2'; -- was 'Man defense'
update tags set category='def_scheme', sort_order=1, name='Zone'     where id='eba25062-acb9-457a-8375-fb7e79dd36b2'; -- was 'Zone defense'
update tags set category='def_scheme', sort_order=2, name='Man-Down' where id='2533888b-3dbd-489d-85f4-7e4dbd95cfb9'; -- was 'Man-down'
update tags set category='def_scheme', sort_order=3                  where id='56770cdf-03a7-46a3-8a24-3ff8c9ff1bda'; -- Ride

-- == 5. -> def_result · Their Result (1 row) ==================================
update tags set category='def_result', sort_order=0, name='Goal' where id='462d00e6-0978-40c8-843e-fb2faeae36b9'; -- was 'Goal allowed', negative (kept)

-- == 6. -> def_our_play · DEF Our Player Action (10 rows) =====================
update tags set category='def_our_play', sort_order=0                                  where id='a3b8839c-0128-473c-89da-4aa9c9c74819'; -- Save                positive
update tags set category='def_our_play', sort_order=1,  name='Caused Turnover'          where id='6d0447b0-0b2f-4f78-9d7d-7d37e74b6892'; -- positive
update tags set category='def_our_play', sort_order=2,  name='Stick Check'              where id='0ef723b4-b574-4faa-a5c0-ab5457741526'; -- was 'Stick check / takeaway'
update tags set category='def_our_play', sort_order=3,  name='Ground Ball'              where id='80499e35-29b1-4d89-a31a-2704f4510160'; -- was 'Ground ball', positive
update tags set category='def_our_play', sort_order=4                                  where id='c49a61cf-2495-4f45-bc64-9a79cae9d4e2'; -- Interception        positive
update tags set category='def_our_play', sort_order=5,  tag_polarity='neutral'          where id='2699758e-6235-44ad-987e-31f09a585e3f'; -- 'Slide', was POSITIVE -- a rotation you can be beaten through
update tags set category='def_our_play', sort_order=6,  name='Shot Block'               where id='f4626db6-4b22-4c03-902e-57e2c0c32366'; -- was 'Shot blocked', positive
update tags set category='def_our_play', sort_order=7,  name='Ride Forces Turnover'     where id='306be8f0-1418-4225-86a3-603f8f75599b'; -- was 'Ride (forces turnover)', positive
update tags set category='def_our_play', sort_order=10, name='Beaten on Dodge'          where id='7b8ac804-184c-4372-acca-245c1f35874f'; -- negative (kept)
update tags set category='def_our_play', sort_order=11                                 where id='928126b4-15ce-421c-b850-c259836274f0'; -- Penalty Committed   negative

-- == 7. RETIRE 5 zero-use legacy rows (retired_at ONLY) ======================
-- Greenfield sport: no history to preserve, so non-launch clutter does not go onto the
-- board. Every id stays, every one has ZERO uses. They keep their current category on
-- purpose -- retirement filters them from every vocabulary reader AND lacrosse's definition
-- no longer lists offense/defense/plays, so two independent locks keep them off the board.
update tags set retired_at = now() where id = 'd84a9775-3e97-4976-b3fc-4cd35c097e0a'; -- Two-point goal (format-specific scoring; introduce with a format that needs it)
update tags set retired_at = now() where id = '72149e03-9239-463f-a8da-9989246aa6ae'; -- Man-up goal    (derivable: Man-Up / EMO + Goal)
update tags set retired_at = now() where id = 'a233346c-dd0a-47e5-8c4b-fbc8abcc83cd'; -- Offensive foul (overlaps Penalty Committed)
update tags set retired_at = now() where id = '2dbc5675-d2c8-44da-9388-f817c89545e3'; -- Man-down stop  (derivable: Man-Down + Save / Caused Turnover)
update tags set retired_at = now() where id = '0e59e815-ada6-4b50-a899-90e5f3f9c787'; -- Substitution (on the fly)

-- == 8. 33 new global rows ===================================================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Free Position', 'off_formation', 'global', null, 'Lacrosse', 6, 'neutral');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Man',            'off_opp_look', 'global', null, 'Lacrosse', 0, 'neutral'),
  ('Zone',           'off_opp_look', 'global', null, 'Lacrosse', 1, 'neutral'),
  ('Adjacent Slide', 'off_opp_look', 'global', null, 'Lacrosse', 2, 'neutral'),
  ('Crease Slide',   'off_opp_look', 'global', null, 'Lacrosse', 3, 'neutral'),
  ('Lockoff',        'off_opp_look', 'global', null, 'Lacrosse', 4, 'neutral'),
  ('Man-Down',       'off_opp_look', 'global', null, 'Lacrosse', 5, 'neutral');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Dodge',        'off_play', 'global', null, 'Lacrosse', 0, 'neutral'),
  ('Two-Man Game', 'off_play', 'global', null, 'Lacrosse', 1, 'neutral'),
  ('Pick',         'off_play', 'global', null, 'Lacrosse', 2, 'neutral'),
  ('Feed',         'off_play', 'global', null, 'Lacrosse', 3, 'neutral'),
  ('Skip',         'off_play', 'global', null, 'Lacrosse', 4, 'neutral'),
  ('Crease Feed',  'off_play', 'global', null, 'Lacrosse', 5, 'neutral'),
  ('Fast Break',   'off_play', 'global', null, 'Lacrosse', 6, 'neutral');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Successful Clear', 'off_result', 'global', null, 'Lacrosse', 6, 'positive');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Unforced Turnover', 'off_player_action', 'global', null, 'Lacrosse', 6, 'negative'),
  ('Draw Control Lost', 'off_player_action', 'global', null, 'Lacrosse', 8, 'negative');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Settled Offense', 'def_opp_formation', 'global', null, 'Lacrosse', 0, 'neutral'),
  ('Fast Break',      'def_opp_formation', 'global', null, 'Lacrosse', 1, 'neutral'),
  ('Transition',      'def_opp_formation', 'global', null, 'Lacrosse', 2, 'neutral'),
  ('Man-Up / EMO',    'def_opp_formation', 'global', null, 'Lacrosse', 3, 'neutral'),
  ('Clear',           'def_opp_formation', 'global', null, 'Lacrosse', 4, 'neutral');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Dodge',        'def_opp_play', 'global', null, 'Lacrosse', 0, 'neutral'),
  ('Two-Man Game', 'def_opp_play', 'global', null, 'Lacrosse', 1, 'neutral'),
  ('Pick',         'def_opp_play', 'global', null, 'Lacrosse', 2, 'neutral'),
  ('Skip',         'def_opp_play', 'global', null, 'Lacrosse', 3, 'neutral'),
  ('Crease Feed',  'def_opp_play', 'global', null, 'Lacrosse', 4, 'neutral'),
  ('Shot',         'def_opp_play', 'global', null, 'Lacrosse', 5, 'neutral');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Shot',         'def_result', 'global', null, 'Lacrosse', 1, 'negative'),
  ('Turnover',     'def_result', 'global', null, 'Lacrosse', 2, 'positive'),
  ('Failed Clear', 'def_result', 'global', null, 'Lacrosse', 3, 'positive');

insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Successful Ride', 'def_our_play', 'global', null, 'Lacrosse', 8, 'positive'),
  ('Failed Ride',     'def_our_play', 'global', null, 'Lacrosse', 9, 'negative');

-- APPLIED LIVE 2026-09-25 as Supabase migration <server stamp>_lacrosse_launch_taxonomy.
--
-- VERIFIED after apply:
--   tags 829 -> 862 (+33 inserts exactly). clip_tags 1535 -> 1535 with the md5 of every
--   (clip_id, tag_id, bundle_number) row UNCHANGED (a51e93ca480f33b76f11f80ae659663d).
--   Lacrosse 43 -> 76 rows: 71 active, 5 retired, ZERO active rows left in
--   offense/defense/plays, lacrosse uses still 0.
--   Retired: Man-down stop · Man-up goal · Offensive foul · Substitution (on the fly) ·
--   Two-point goal.
--   Other sports untouched: Football 142, Flag 135, 7-on-7 105, Basketball 107 globals,
--   Soccer 86, Baseball 50, Softball 52, Volleyball 31.
--   NO within-column duplicate anywhere.
--
--   Final active board (all ten counts match the approved plan):
--     OFF  Our Set (7)             Settled Offense · Fast Break · Transition · Two-Man Game ·
--                                  Man-Up / EMO · Clear · Free Position
--          Their Defense (6)       Man · Zone · Adjacent Slide · Crease Slide · Lockoff · Man-Down
--          Our Play (7)            Dodge · Two-Man Game · Pick · Feed · Skip · Crease Feed · Fast Break
--          Our Result (8)          Goal+ · Shot on Goal+ · Miss- · Pipe · Turnover- ·
--                                  Shot Clock Violation- · Successful Clear+ · Failed Clear-
--          Players                 (roster)
--          Our Player Action (12)  Assist / Feed+ · Dodge Beat Defender+ · Inside Finish+ ·
--                                  Time-and-Room Shot · On-the-Run Shot · Ground Ball+ ·
--                                  Unforced Turnover- · Draw Control Won+ · Draw Control Lost- ·
--                                  Face-off Won+ · Face-off Lost- · Penalty Drawn+
--     DEF  Their Set (5)           Settled Offense · Fast Break · Transition · Man-Up / EMO · Clear
--          Our Scheme (4)          Man · Zone · Man-Down · Ride
--          Their Play (6)          Dodge · Two-Man Game · Pick · Skip · Crease Feed · Shot
--          Their Result (4)        Goal- · Shot- · Turnover+ · Failed Clear+
--          Players                 (roster)
--          Our Player Action (12)  Save+ · Caused Turnover+ · Stick Check+ · Ground Ball+ ·
--                                  Interception+ · Slide · Shot Block+ · Ride Forces Turnover+ ·
--                                  Successful Ride+ · Failed Ride- · Beaten on Dodge- ·
--                                  Penalty Committed-
--
--   Polarity rule verified live: Fast Break, Clear, Time-and-Room Shot, On-the-Run Shot and
--   Slide are now neutral; every achievement row kept its positive; the three ours/theirs
--   name pairs carry opposite polarity by column as designed.
--
-- ROLLBACK (all by id): delete the 33 inserted rows; clear retired_at on the 5; move the 38
-- carried rows back to offense/defense/plays with their original names, sort_orders and
-- polarity (Fast break, Clear, Time & room shot, On-the-run shot and Slide were positive).
