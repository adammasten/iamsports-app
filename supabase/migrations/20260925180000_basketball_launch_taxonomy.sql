-- SLICE H2 (Adam, 2026-09-25): Basketball launch taxonomy -- the DATA half.
--
-- ORDERING IS THE POINT OF THIS SLICE. Basketball holds 315 of 402 clips and 884 of the
-- 1535 clip_tags rows, so per CLAUDE.md invariant 4 the reading build shipped FIRST:
-- H1 = commit 11e1c65, TestFlight build 64 (EAS 3c9ed1b9-f126-4c8c-99d0-591b543507c2),
-- installed and device-verified by Adam before this migration was applied. Applying this
-- ahead of that build would have emptied the installed app's basketball board.
--
-- SAFE BY CONSTRUCTION: every statement is BY ID. No deletions, no id changes, no
-- clip_tags writes, and NO constraint change -- basketball reuses the generic keys
-- `plays` / `offense` / `defense` for Our Play and the two Our Player Action columns,
-- which is what keeps 804 of its 884 uses in the very column they already had and gives
-- Export zero orphaned sections. 80 uses change which column they display in; all 80 stay
-- attached to the same clips and the same bundles.
--
-- Final board (H1 definition, unchanged here):
--   OFF  Our Set / Situation · Our Play · Players · Our Player Action · Their Defense
--   DEF  Their Set / Formation · Our Defense · Their Play · Their Result · Players ·
--        Our Player Action

-- == 1. plays -> off_formation (Our Set / Situation): 11 rows, 52 uses ========
-- `plays` was doing triple duty -- sets, play calls AND player actions. The sets and
-- game situations move to their own column. Two relabels ride along (both by id).
update tags set category = 'off_formation', sort_order =  0 where id = '8f9592d4-e41a-428a-8393-d64804c150ad'; -- Horns          [0]
update tags set category = 'off_formation', sort_order =  1 where id = '7314a13d-fcb5-4ba3-9798-007c365a9081'; -- BLOB           [16]  OURS
update tags set category = 'off_formation', sort_order =  2 where id = '5eed12e8-07f6-4370-9e09-6239d4c7b37b'; -- SLOB           [6]
update tags set category = 'off_formation', sort_order =  3 where id = '117a8747-fe05-4b2c-86a6-3ec5e76e2c5c'; -- ATO            [0]
update tags set category = 'off_formation', sort_order =  4 where id = '9a4a5a73-e20e-44ba-9596-802bd2bbc42f'; -- Transition     [25]
update tags set category = 'off_formation', sort_order =  5 where id = '2fbcbb18-330b-4d85-ac16-798dbb7ec323'; -- Early Offense  [0]
update tags set category = 'off_formation', sort_order =  6 where id = '427b0283-331a-4ff5-a494-4441580154b4'; -- Flow           [0]
update tags set category = 'off_formation', sort_order =  7, name = 'Zone Offense' where id = '70240169-c827-44e6-8d6c-65298508f765'; -- was 'Zone Off' [2]
update tags set category = 'off_formation', sort_order =  8, name = 'Man Offense'  where id = '8cf5baa1-cebe-469e-878e-5829bdef09ab'; -- was 'Man Off'  [0]
update tags set category = 'off_formation', sort_order =  9 where id = '6369ee48-96b2-43ad-877c-1727b415cc65'; -- Press Break    [3]
update tags set category = 'off_formation', sort_order = 10 where id = 'c44fc157-c873-48cc-872a-3bfeee3a0b54'; -- Second Chance  [0]

-- == 2. plays -> offense (Our Player Action): 3 rows, 19 uses ================
-- Nobody CALLS "Drive" -- a player drives. Same for Cut and Kick Out.
update tags set category = 'offense', sort_order = 12 where id = '1440824c-8f61-4aab-b4c2-a83c4ce0eaaf'; -- Drive    [19]
update tags set category = 'offense', sort_order = 13 where id = 'c8120796-efad-44c1-9f3a-c9ddcee6926b'; -- Cut      [0]
update tags set category = 'offense', sort_order = 14 where id = 'b6d17776-2fa1-4cbe-a51f-2329b8913b71'; -- Kick Out [0]

-- == 3. plays -> def_scheme (Our Defense): 1 row, 0 uses =====================
update tags set category = 'def_scheme', sort_order = 8 where id = '004076ab-bfb8-45b7-b20f-0a722749745e'; -- Zone Press [0]

-- == 4. offense -> plays (Our Play): 2 rows, 0 uses ==========================
-- The CALLED versions: an iso and a called backdoor are play calls, not player actions.
update tags set category = 'plays', sort_order = 11 where id = '667b2200-4a4b-4582-87b6-c808c52d61bd'; -- Isolation [0]
update tags set category = 'plays', sort_order =  8, name = 'Backdoor' where id = '9dd425fb-3105-4aeb-b413-8a9fafa04acf'; -- was 'Backdoor Cut' [0]

-- == 5. defense -> def_scheme (Our Defense): 5 rows, 6 uses ==================
-- `defense` was holding schemes AND player actions. Schemes get their own column.
update tags set category = 'def_scheme', sort_order = 0, name = 'Man' where id = '8de3892d-e4d2-461d-8d7f-7db4a8619ee9'; -- was 'Man to Man' [0]
update tags set category = 'def_scheme', sort_order = 5 where id = 'cd2a6e61-2253-457d-a5f6-86980af9ebf4'; -- Zone         [1]  generic catch-all, KEPT
update tags set category = 'def_scheme', sort_order = 6 where id = '34f1483b-f65c-4a8e-ae88-2d6f5cca2a50'; -- Press        [4]
update tags set category = 'def_scheme', sort_order = 7 where id = '27a7c321-b2f6-429b-9960-c869a6f74295'; -- Trap         [0]
update tags set category = 'def_scheme', sort_order = 9 where id = 'f2e77921-84c4-4e9f-b3a8-a72ab639fe31'; -- Transition D [1]

-- == 6. defense -> def_opp_formation (Their Set / Formation): 1 row, 1 use ====
-- The Blob/BLOB pair is NOT a typo: this one was filed under defense because it meant
-- THEIR out-of-bounds play. Both ids are kept; the columns disambiguate them.
update tags set category = 'def_opp_formation', sort_order = 4, name = 'BLOB' where id = '00a18c1b-eee7-4bc8-9cb8-154495261aed'; -- was 'Blob' [1]  THEIRS

-- == 7. sort-order cleanup so chips render in the approved launch order ======
-- offense (Our Player Action): 6 rows whose legacy order no longer matches the list.
update tags set sort_order =  2 where id = 'b3b80399-679f-4f9d-97f2-53a520e1a15d'; -- MADE 3          [9]
update tags set sort_order =  3 where id = 'dc238257-d53e-4b73-9171-a4f801acefb2'; -- MISSED 3        [14]
update tags set sort_order =  4 where id = '1c15d2c1-8783-4d63-8e2a-4ddb0a1a9eb6'; -- MADE FT         [12]
update tags set sort_order =  6 where id = 'fb1555e2-de11-44c0-841b-88d5380027db'; -- Assist          [24]
update tags set sort_order =  7 where id = '32d3e311-3341-48f3-abc1-01426c541d55'; -- Off Rebound     [23]
update tags set sort_order = 18 where id = '4c484ac4-8e83-47c4-91fd-5b084e724806'; -- Off-Ball Screen [0]
-- defense (DEF Our Player Action): 5 rows, after the schemes left the column.
update tags set sort_order = 10 where id = 'de5e0078-c325-47b7-9687-2f874ffe2b09'; -- Closeout      [0]
update tags set sort_order = 11 where id = 'b976f662-c390-447e-b0d1-24c0c09957c2'; -- Box Out       [2]
update tags set sort_order = 12 where id = '0a5fd10c-fb3b-4725-8ce9-329bd2855c68'; -- Denial        [0]
update tags set sort_order = 13 where id = '3d2a2b2d-7d43-4514-af40-dc5a6487bc6c'; -- Rotation      [0]
update tags set sort_order = 14 where id = '64d93618-0dfe-4ecf-beaf-48dde17bb9e8'; -- Ball Screen D [0]

-- == 8. team-scoped: 2 retirements + 1 recategorisation ======================
-- The global Drive now lives in Our Player Action, which is where these two team rows
-- already sat -- so without this they would be a second identical "Drive" chip in the
-- same column. RETIRED, NOT DELETED: both keep their ids and their clip_tags, both still
-- resolve in Export on the clips that used them; they are simply not offered for NEW
-- tagging. The global Drive is the future chip.
update tags set retired_at = now() where id = '44c62770-c0b2-4ca5-9b64-3c946b7065f0'; -- Centex2026 6th Grade 'Drive' [10 uses]
update tags set retired_at = now() where id = 'df7eac5f-34fb-4194-99f3-bbffd108398c'; -- Demo Warriors 14U   'Drive' [1 use]
-- 'Fast Break' is a game situation, so it must not stay in `offense` now that `offense`
-- means Our Player Action. Team id, name, polarity and its 2 uses are untouched.
update tags set category = 'off_formation', sort_order = 11 where id = 'b8a9cd8e-a0a3-496c-9f10-39e86145546e'; -- Demo Warriors 'Fast Break' [2]

-- == 9. 51 new global rows ===================================================
-- Our Play (9). All neutral: a play call is context, never a credit to a player.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Pick & Roll',  'plays', 'global', null, 'Basketball',  1, 'neutral'),
  ('Screen Away',  'plays', 'global', null, 'Basketball',  3, 'neutral'),
  ('Flare',        'plays', 'global', null, 'Basketball',  4, 'neutral'),
  ('Pin Down',     'plays', 'global', null, 'Basketball',  5, 'neutral'),
  ('Stagger',      'plays', 'global', null, 'Basketball',  6, 'neutral'),
  ('UCLA Cut',     'plays', 'global', null, 'Basketball',  7, 'neutral'),
  ('Give & Go',    'plays', 'global', null, 'Basketball',  9, 'neutral'),
  ('Post Entry',   'plays', 'global', null, 'Basketball', 10, 'neutral'),
  ('Drive & Kick', 'plays', 'global', null, 'Basketball', 12, 'neutral');

-- Our Player Action (7 launch additions). ALL NEUTRAL by Adam's decision 2026-09-25:
-- these name the TYPE of attempt, not whether it went in. MADE 2 / MISSED 2 / MADE 3 /
-- MISSED 3 / MADE FT / MISSED FT already carry success, so a MISSED layup must not become
-- parent-highlight eligible just because its shot type was tagged.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Layup',          'offense', 'global', null, 'Basketball', 19, 'neutral'),
  ('Dunk',           'offense', 'global', null, 'Basketball', 20, 'neutral'),
  ('Floater',        'offense', 'global', null, 'Basketball', 21, 'neutral'),
  ('Pull-Up',        'offense', 'global', null, 'Basketball', 22, 'neutral'),
  ('Catch & Shoot',  'offense', 'global', null, 'Basketball', 23, 'neutral'),
  ('And-1',          'offense', 'global', null, 'Basketball', 24, 'neutral'),
  ('Putback',        'offense', 'global', null, 'Basketball', 25, 'neutral');

-- Their Defense (10). Context we are FACING -- all neutral.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Man',               'off_opp_look', 'global', null, 'Basketball', 0, 'neutral'),
  ('2-3 Zone',          'off_opp_look', 'global', null, 'Basketball', 1, 'neutral'),
  ('3-2 Zone',          'off_opp_look', 'global', null, 'Basketball', 2, 'neutral'),
  ('1-3-1 Zone',        'off_opp_look', 'global', null, 'Basketball', 3, 'neutral'),
  ('Matchup Zone',      'off_opp_look', 'global', null, 'Basketball', 4, 'neutral'),
  ('Box-and-One',       'off_opp_look', 'global', null, 'Basketball', 5, 'neutral'),
  ('Triangle-and-Two',  'off_opp_look', 'global', null, 'Basketball', 6, 'neutral'),
  ('Man Trap',          'off_opp_look', 'global', null, 'Basketball', 7, 'neutral'),
  ('Zone Trap',         'off_opp_look', 'global', null, 'Basketball', 8, 'neutral'),
  ('Full-Court Press',  'off_opp_look', 'global', null, 'Basketball', 9, 'neutral');

-- Their Set / Formation (6 new; sort 4 is the moved BLOB). All neutral.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('5-Out',         'def_opp_formation', 'global', null, 'Basketball', 0, 'neutral'),
  ('4-Out / 1-In',  'def_opp_formation', 'global', null, 'Basketball', 1, 'neutral'),
  ('3-Out / 2-In',  'def_opp_formation', 'global', null, 'Basketball', 2, 'neutral'),
  ('Horns',         'def_opp_formation', 'global', null, 'Basketball', 3, 'neutral'),
  ('SLOB',          'def_opp_formation', 'global', null, 'Basketball', 5, 'neutral'),
  ('Transition',    'def_opp_formation', 'global', null, 'Basketball', 6, 'neutral');

-- Our Defense (4 new; 0/5/6/7/9 are the moved rows). All neutral.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('2-3',          'def_scheme', 'global', null, 'Basketball', 1, 'neutral'),
  ('3-2',          'def_scheme', 'global', null, 'Basketball', 2, 'neutral'),
  ('1-3-1',        'def_scheme', 'global', null, 'Basketball', 3, 'neutral'),
  ('Matchup Zone', 'def_scheme', 'global', null, 'Basketball', 4, 'neutral');

-- Their Play (8). What THEY ran -- all neutral.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Ball Screen', 'def_opp_play', 'global', null, 'Basketball', 0, 'neutral'),
  ('DHO',         'def_opp_play', 'global', null, 'Basketball', 1, 'neutral'),
  ('Post Up',     'def_opp_play', 'global', null, 'Basketball', 2, 'neutral'),
  ('Isolation',   'def_opp_play', 'global', null, 'Basketball', 3, 'neutral'),
  ('Screen Away', 'def_opp_play', 'global', null, 'Basketball', 4, 'neutral'),
  ('Drive',       'def_opp_play', 'global', null, 'Basketball', 5, 'neutral'),
  ('Cut',         'def_opp_play', 'global', null, 'Basketball', 6, 'neutral'),
  ('Backdoor',    'def_opp_play', 'global', null, 'Basketball', 7, 'neutral');

-- Their Result (7), read from OUR defence's point of view -- the polarity Adam approved.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Made 2',             'def_result', 'global', null, 'Basketball', 0, 'negative'),
  ('Missed 2',           'def_result', 'global', null, 'Basketball', 1, 'positive'),
  ('Made 3',             'def_result', 'global', null, 'Basketball', 2, 'negative'),
  ('Missed 3',           'def_result', 'global', null, 'Basketball', 3, 'positive'),
  ('Turnover',           'def_result', 'global', null, 'Basketball', 4, 'positive'),
  ('Offensive Rebound',  'def_result', 'global', null, 'Basketball', 5, 'negative'),
  ('Foul Drawn',         'def_result', 'global', null, 'Basketball', 6, 'negative');

-- APPLIED LIVE 2026-09-25 as Supabase migration <server stamp>_basketball_launch_taxonomy,
-- AFTER Adam confirmed TestFlight build 64 (H1, commit 11e1c65) was installed and verified.
--
-- VERIFIED after apply:
--   tags 743 -> 794 (+51 inserts exactly). clip_tags 1535 -> 1535, and the md5 of every
--   (clip_id, tag_id, bundle_number) row in the table is UNCHANGED
--   (a51e93ca480f33b76f11f80ae659663d before and after), as is the md5 of just the 80 rows
--   on the moved tags (d0c5f345d15f3e3083e74198057b6c43) -- so all 80 uses are still on the
--   same clips in the same bundles; only the column they display in changed.
--   Basketball globals 56 -> 107. Basketball uses still 884. Retired +2 (the two team
--   Drives only). Basketball parent-eligible pairs 190 -> 190; flag's 60 -> 60.
--   Other sports unchanged: Football 142, Flag 135, 7-on-7 105, Soccer 51, Baseball 50,
--   Softball 52, Lacrosse 43, Volleyball 31.
--   All 21 existing basketball polarities verified BY ID: unchanged. The 7 new shot
--   actions are all neutral. def_result carries the approved defence-POV polarity.
--   Used-category set for basketball clips = off_formation, plays, offense,
--   def_opp_formation, def_scheme, defense + the stamps -- every one defined, so Export
--   has ZERO orphaned sections.
--   Both retired team Drives still resolve with their uses intact (10 and 1).
--
--   Final global chip counts / order:
--     Our Set / Situation (11)  Horns · BLOB · SLOB · ATO · Transition · Early Offense ·
--                               Flow · Zone Offense · Man Offense · Press Break · Second Chance
--     Our Play (13)             Ball Screen · Pick & Roll · DHO · Screen Away · Flare ·
--                               Pin Down · Stagger · UCLA Cut · Backdoor · Give & Go ·
--                               Post Entry · Isolation · Drive & Kick
--     Our Player Action (26)    MADE 2 · MISSED 2 · MADE 3 · MISSED 3 · MADE FT · MISSED FT ·
--                               Assist · Off Rebound · Turnover · Offensive Foul ·
--                               Fouled on Shot · Post Up · Drive · Cut · Kick Out ·
--                               Paint Touch · Extra Pass · Swing Ball · Off-Ball Screen ·
--                               Layup · Dunk · Floater · Pull-Up · Catch & Shoot · And-1 · Putback
--     Their Defense (10)        Man · 2-3 Zone · 3-2 Zone · 1-3-1 Zone · Matchup Zone ·
--                               Box-and-One · Triangle-and-Two · Man Trap · Zone Trap ·
--                               Full-Court Press
--     Their Set / Formation (7) 5-Out · 4-Out / 1-In · 3-Out / 2-In · Horns · BLOB · SLOB · Transition
--     Our Defense (10)          Man · 2-3 · 3-2 · 1-3-1 · Matchup Zone · Zone · Press ·
--                               Trap · Zone Press · Transition D
--     Their Play (8)            Ball Screen · DHO · Post Up · Isolation · Screen Away ·
--                               Drive · Cut · Backdoor
--     Their Result (7)          Made 2- · Missed 2+ · Made 3- · Missed 3+ · Turnover+ ·
--                               Offensive Rebound- · Foul Drawn-
--     DEF Our Player Action (15) Steal · Block · Def Rebound · Deflection · Charge Taken ·
--                               Foul · Shooting Foul · Technical · Forced Turnover ·
--                               Contested Shot · Closeout · Box Out · Denial · Rotation ·
--                               Ball Screen D
--
--   DUPLICATE-CHIP CHECK, reported honestly: zero duplicates on Legends 2036, Centex
--   Attack Bobby, Centex Attack Regents and Centex2026 6th Grade (the approved Drive
--   retirement removed Centex2026's). Demo Warriors 14U still has four: 'Steal', 'Block'
--   and 'Assist' PRE-DATE this migration and are preserved on purpose (Adam: do not
--   merge/delete them), and 'Pick & Roll' is a NEW duplicate created here, because the
--   approved global Pick & Roll now sits beside that team's own 0-use row which Adam
--   explicitly said to leave alone. Fix if wanted: retire the team row by id
--   (afa1c93c-3720-4430-8887-e95de92a0728) exactly as the Drives were. NOT DONE without
--   approval.
--
-- ROLLBACK (all by id): delete the 51 inserted rows; move the 11 Our Set rows back to
-- `plays` (restoring 'Zone Off' / 'Man Off'), Drive/Cut/Kick Out back to `plays`, Zone
-- Press back to `plays`, Isolation and 'Backdoor'->'Backdoor Cut' back to `offense`, the 5
-- schemes back to `defense` (restoring 'Man to Man'), 'BLOB'->'Blob' back to `defense`, and
-- Demo's Fast Break back to `offense`; clear retired_at on the two team Drives; restore the
-- 11 legacy sort_order values.
