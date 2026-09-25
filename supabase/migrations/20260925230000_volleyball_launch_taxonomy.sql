-- SLICE L (Adam, 2026-09-25): Volleyball launch taxonomy -- the FINAL sport.
--
-- GREENFIELD -- checked, not assumed: 0 teams, 0 videos, 0 clips, 0 clip_tags rows on any
-- volleyball tag (re-verified immediately before applying). One slice, code + data together.
--
-- VOLLEYBALL STAYS NON-PHASED. It is rally-based, not possession-phase based, so there is no
-- OFF/DEF toggle. The board is a single five-column set:
--   Rally Phase · Our Play / System · Result · Players · Our Player Action
-- Players sits 4th because the definition opts into the shared placement rule
-- (playersBefore), which is a new capability for FLAT sports -- see tag-categories.ts.
--
-- Every statement is BY ID. No deletions, no id changes, no clip_tags writes, and NO
-- constraint change: off_formation / off_play / off_result / off_player_action have all been
-- in tags_category_check since Slice E. Our Rotation was DROPPED at launch precisely because
-- it was the only column that would have needed a new category key, and volleyball has zero
-- existing rotation vocabulary -- rotation belongs in the later structured context layer.
--
-- RESULT AND PLAYER ACTION STAY SEPARATE (unlike baseball/softball, where one player acts at
-- a time): a volleyball rally has a passer, a setter and a hitter, so "we won the point" and
-- "she got the kill" are different facts. Every one of the 31 existing rows was
-- player-attributed, which is why Result is created fresh as 4 team-outcome rows.
--
-- POLARITY RULE, continued: NEUTRAL = context or technique that proves nothing (rally states,
-- attack types, Block Touch, Serve Receive / Pass, Attack Attempt); POSITIVE = real player
-- achievement (Kill, Ace, Assist, Dig, Solo Block, Block Assist, Perfect Pass, Save /
-- Pancake); NEGATIVE = real negative outcome.

-- == 1. -> off_formation · Rally Phase (7 carried; all already neutral) =======
update tags set category='off_formation', sort_order=0                              where id='93090f2c-9902-4943-a9a1-ff97379d34d2'; -- Serve
update tags set category='off_formation', sort_order=3                              where id='d47d8ed0-fdad-4f26-b55a-39309c4bc7bf'; -- Transition
update tags set category='off_formation', sort_order=4, name='Free Ball Received'   where id='9c2a42f9-0674-4afa-8a02-f9d641d4717f'; -- was 'Free ball'
update tags set category='off_formation', sort_order=6, name='In-System'            where id='acc0bb66-6e3b-4b29-a208-449e38ccfa60';
update tags set category='off_formation', sort_order=7, name='Out-of-System'        where id='2627fb82-3d6c-4cfe-ab38-a51807afa383';
update tags set category='off_formation', sort_order=8                              where id='04f6941b-2596-4f7c-a256-8c9e3adf095c'; -- Overpass
update tags set category='off_formation', sort_order=9, name='Down Ball'            where id='bb462927-6287-4879-ba51-da68bdf93d39';

-- == 2. -> off_play · Our Play / System (4 carried; ALL lose their positive) ==
-- These name the attack/play TYPE, not success -- the same rule that made basketball's Layup
-- and lacrosse's On-the-Run Shot neutral. Outcomes live in Result / Player Action instead,
-- so no concept is duplicated across columns.
update tags set category='off_play', sort_order=0, name='Quick Attack',    tag_polarity='neutral' where id='04b586ab-cbe0-463b-849b-8d869741fe76';
update tags set category='off_play', sort_order=1,                          tag_polarity='neutral' where id='4dab399b-dc0e-46bd-b529-1834092f6083'; -- Slide
update tags set category='off_play', sort_order=2, name='Back-Row Attack',  tag_polarity='neutral' where id='6cf53c64-a2de-4c16-8d11-30e8b6bafb57';
update tags set category='off_play', sort_order=3, name='Tip / Roll Shot',  tag_polarity='neutral' where id='5ec14813-bf09-4112-ac68-58a08f05fa2c';

-- == 3. -> off_player_action · Our Player Action (18 carried) =================
update tags set category='off_player_action', sort_order=0                                    where id='6bdaf5a6-e81c-4470-ab40-384e680360e1'; -- Kill            positive
update tags set category='off_player_action', sort_order=1                                    where id='4c1fc0bb-bb27-48a5-8067-330adc3ae748'; -- Ace             positive
update tags set category='off_player_action', sort_order=2,  name='Assist'                    where id='f7784022-c927-44c5-bb9e-1d19df1ec0d7'; -- was 'Assist (set)', positive
update tags set category='off_player_action', sort_order=3                                    where id='cf068c60-7bdd-4b32-92d3-14e9e536d662'; -- Dig             positive
update tags set category='off_player_action', sort_order=4,  name='Solo Block'                where id='000b8c19-3a3d-41b8-91e1-6451f8935627'; -- was 'Block (solo)', positive
update tags set category='off_player_action', sort_order=5,  name='Block Assist'              where id='358b5999-ad18-4a07-ab28-e5992fbb1c88'; -- positive
update tags set category='off_player_action', sort_order=6,  name='Perfect Pass'              where id='e4b45e42-446f-4c86-a8d4-900972cf8570'; -- positive (the achievement)
update tags set category='off_player_action', sort_order=7,  name='Save / Pancake'            where id='5c2fd386-4e75-4c3d-80d3-85f832f80ed7'; -- positive
update tags set category='off_player_action', sort_order=8,  name='Attack Attempt'            where id='1df2183a-f4e8-40c2-8a72-abaa3501e263'; -- stays NEUTRAL
update tags set category='off_player_action', sort_order=9,  name='Block Touch',        tag_polarity='neutral' where id='5ea18e71-8c18-4bb5-84ed-4c3f49119aa5'; -- a touch is not a point
update tags set category='off_player_action', sort_order=10, name='Serve Receive / Pass', tag_polarity='neutral' where id='72013623-b04c-4ee6-99ba-24118b299e1d'; -- Perfect Pass is the achievement
update tags set category='off_player_action', sort_order=11, name='Attack Error'              where id='819c53ae-6608-4aa1-bf4b-71db92b4e784'; -- was 'Hitting error', negative
update tags set category='off_player_action', sort_order=12, name='Attack Blocked'            where id='30d663b4-ddca-467c-86e7-b7c751ad2da3'; -- negative
update tags set category='off_player_action', sort_order=13, name='Service Error'             where id='dcb68a89-e25e-4025-9ab1-5ca4d9de8618'; -- negative
update tags set category='off_player_action', sort_order=14, name='Ball-Handling Error'       where id='6e60dfb8-7670-4aeb-b2c8-8c6564f9f1f9'; -- negative
update tags set category='off_player_action', sort_order=15, name='Reception Error'           where id='84f9f913-a946-4b4d-8061-fb93919f33c8'; -- negative
update tags set category='off_player_action', sort_order=16, name='Missed Dig'                where id='ade98cd6-fc70-4803-b522-1ec020480e30'; -- negative
update tags set category='off_player_action', sort_order=17, name='Net / Blocking Violation'  where id='2b8f0d98-11c2-4c57-9f69-79cb0f2a56dd'; -- negative

-- == 4. RETIRE 2 zero-use rows (retired_at ONLY, nothing deleted) ============
update tags set retired_at = now() where id = '873fc773-44bc-44d6-89a8-60c9cf835bc0'; -- Long rally (subjective context)
update tags set retired_at = now() where id = 'fcf59261-030b-48ba-ae92-4f0b56f3330e'; -- Joust      (real but too rare/ambiguous for a launch filter)

-- == 5. 12 new global rows ===================================================
-- Rally Phase: context/state, so neutral throughout.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Serve Receive',  'off_formation', 'global', null, 'Volleyball', 1, 'neutral'),
  ('Defense',        'off_formation', 'global', null, 'Volleyball', 2, 'neutral'),
  ('Free Ball Sent', 'off_formation', 'global', null, 'Volleyball', 5, 'neutral');

-- Our Play / System: the attack calls, all neutral.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Outside',    'off_play', 'global', null, 'Volleyball', 4, 'neutral'),
  ('Middle',     'off_play', 'global', null, 'Volleyball', 5, 'neutral'),
  ('Right Side', 'off_play', 'global', null, 'Volleyball', 6, 'neutral'),
  ('Pipe',       'off_play', 'global', null, 'Volleyball', 7, 'neutral'),
  ('Dump',       'off_play', 'global', null, 'Volleyball', 8, 'neutral');

-- Result: the only TEAM-level vocabulary volleyball has -- the column is created fresh.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Point Won',      'off_result', 'global', null, 'Volleyball', 0, 'positive'),
  ('Point Lost',     'off_result', 'global', null, 'Volleyball', 1, 'negative'),
  ('Side Out',       'off_result', 'global', null, 'Volleyball', 2, 'positive'),
  ('Opponent Error', 'off_result', 'global', null, 'Volleyball', 3, 'positive');

-- APPLIED LIVE 2026-09-25 as Supabase migration <server stamp>_volleyball_launch_taxonomy.
--
-- VERIFIED after apply:
--   tags 869 -> 881 (+12 inserts exactly). clip_tags 1535 -> 1535 with the md5 of every
--   (clip_id, tag_id, bundle_number) row UNCHANGED (a51e93ca480f33b76f11f80ae659663d).
--   Volleyball 31 -> 43 rows: 41 active, 2 retired (Joust, Long rally). ZERO active rows left
--   in offense/defense/plays; uses still 0. NO within-column duplicate.
--   Other sports untouched: Football 142, Flag 135, 7-on-7 105, Basketball 107 globals,
--   Soccer 86, Lacrosse 76, Baseball 53, Softball 56. Sets still S1-S5.
--
--   Final active board (5 columns; the native horizontal strip engages only above 5):
--     Rally Phase (10)        Serve · Serve Receive · Defense · Transition ·
--                             Free Ball Received · Free Ball Sent · In-System ·
--                             Out-of-System · Overpass · Down Ball          -- all neutral
--     Our Play / System (9)   Quick Attack · Slide · Back-Row Attack · Tip / Roll Shot ·
--                             Outside · Middle · Right Side · Pipe · Dump   -- all neutral
--     Result (4)              Point Won+ · Point Lost- · Side Out+ · Opponent Error+
--     Players                 (roster, 4th of 5)
--     Our Player Action (18)  Kill+ · Ace+ · Assist+ · Dig+ · Solo Block+ · Block Assist+ ·
--                             Perfect Pass+ · Save / Pancake+ · Attack Attempt · Block Touch ·
--                             Serve Receive / Pass · Attack Error- · Attack Blocked- ·
--                             Service Error- · Ball-Handling Error- · Reception Error- ·
--                             Missed Dig- · Net / Blocking Violation-
--
--   Six polarity corrections verified live: Quick Attack, Slide, Back-Row Attack,
--   Tip / Roll Shot (play types), Block Touch (a touch is not a point) and
--   Serve Receive / Pass (Perfect Pass is the achievement) are all now NEUTRAL.
--
-- ROLLBACK (all by id): delete the 12 inserted rows; clear retired_at on Joust and Long
-- rally; move the 29 carried rows back to offense/defense/plays with their original names and
-- sort_orders, restoring positive polarity on Quick attack, Slide, Back-row attack,
-- Tip / roll shot, Block touch and Serve receive (pass).
