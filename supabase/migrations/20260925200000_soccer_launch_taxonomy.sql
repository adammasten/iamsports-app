-- SLICE I (Adam, 2026-09-25): Soccer launch taxonomy -- six-column OFF/DEF.
--
-- Soccer is GREENFIELD: 0 teams, 0 videos, 0 clips and 0 clip_tags rows on any soccer tag
-- (re-verified immediately before applying). That is why this ships as ONE code + data
-- slice instead of the H1/H2 split Basketball needed -- there is no installed board whose
-- chips could vanish.
--
-- Every statement is BY ID. No deletions, no id changes, no clip_tags writes, and no
-- constraint change: all ten keys already exist (they are the football-family keys, which
-- Football owns the shared labels for, so soccer's board wording changes nothing shared).
--
-- 34 rows recategorised (with their sort_order, 23 of them relabelled, 5 with a polarity
-- correction), 35 new rows, 17 zero-use legacy rows RETIRED not deleted.
--
-- SOCCER PLAYER-ACTION SEMANTICS (Adam, 2026-09-25) -- the rule behind the polarity work:
--   NEUTRAL = technique/action:  Cross · Through Ball · Header · Shot · GK Punt · GK Throw
--   POSITIVE = achievement:      Assist (created a goal) · Key Pass (created a shot) ·
--                                Take-On (beat a defender) · Save · Tackle Won ·
--                                Interception · Block · Ball Recovery · 1v1 Stop · Pressure
-- Context (shapes, patterns, situations) is neutral throughout, so nothing in those
-- columns can independently authorise a parent highlight.

-- == 1. -> off_formation · Our Shape / Situation (6 rows) =====================
update tags set category='off_formation', sort_order=4, name='Counterattack', tag_polarity='neutral' where id='22fe53ae-55f9-48bc-82b6-9a380d2f371d'; -- was plays 'Counter-attack', POSITIVE
update tags set category='off_formation', sort_order=5, name='Build-up'      where id='4728254b-8386-4544-abaa-e1761b1f6867'; -- was 'Build-up / possession'
update tags set category='off_formation', sort_order=6, name='Corner'        where id='3da45203-0347-43f5-a9b0-ffc0bf9c23e1'; -- was 'Corner kick'
update tags set category='off_formation', sort_order=7, name='Free Kick'     where id='04e1a0cc-6513-4320-9d51-bac95e912e08'; -- was 'Free kick'
update tags set category='off_formation', sort_order=8                       where id='d2c723d3-3f9a-4f6c-bfdf-270ed382c745'; -- 'Throw-in', name already correct
update tags set category='off_formation', sort_order=9, name='Restart'       where id='d263d90e-7648-40c5-a490-d292d78badfb'; -- was 'Kickoff / restart'

-- == 2. -> off_play · Our Play / Pattern (3 rows) =============================
update tags set category='off_play', sort_order=0, name='Give-and-Go', tag_polarity='neutral' where id='1be26f4c-d8a4-459a-bc2f-77a601f864eb'; -- was 'Give-and-go (1-2)', POSITIVE
update tags set category='off_play', sort_order=1, tag_polarity='neutral'                     where id='8a513441-21cf-45c1-a75e-5db1f77bcf0f'; -- 'Overlap', was POSITIVE
update tags set category='off_play', sort_order=3, name='Switch of Play'                      where id='fa546226-3042-45f7-92f9-1b0071105837'; -- was 'Switch of play'

-- == 3. -> off_result · Our Result (7 rows; polarity all preserved) ===========
update tags set category='off_result', sort_order=0                          where id='ea405dfb-243d-4a27-ac6b-249908dcdc4a'; -- Goal            positive
update tags set category='off_result', sort_order=1, name='Shot on Target'    where id='fdc4583c-96e6-4f0f-9c67-28e8f7f41f57'; -- positive
update tags set category='off_result', sort_order=2, name='Shot off Target'   where id='e852f32a-daaf-4878-9da7-9a7ee339eae3'; -- negative
update tags set category='off_result', sort_order=3, name='Shot Blocked'      where id='ec9b7f1c-6b12-4c76-a50d-2fad6a3316f0'; -- neutral
update tags set category='off_result', sort_order=4, name='Penalty Won'       where id='b06d7930-fb0d-4ac8-aeef-544ec51d84df'; -- positive
update tags set category='off_result', sort_order=5                          where id='17cb9385-5d9e-4230-bb34-f52eaacfce3f'; -- Offside         negative
update tags set category='off_result', sort_order=6                          where id='db653d88-1f7e-47d9-be9a-43fd10d725b5'; -- Turnover        negative

-- == 4. -> off_player_action · OFF Our Player Action (6 rows) =================
update tags set category='off_player_action', sort_order=0                    where id='a246aee8-84ac-4e00-bf2f-e4bfcdbfa2b7'; -- Assist    stays POSITIVE (created a goal)
update tags set category='off_player_action', sort_order=1, name='Key Pass'   where id='66965c15-d45f-4726-bf95-a6d287c85bc3'; -- stays POSITIVE (created a shot)
update tags set category='off_player_action', sort_order=2, name='Take-On'    where id='d62c8fc7-827d-40d9-9647-24d823f8f5c8'; -- stays POSITIVE (beat a defender)
update tags set category='off_player_action', sort_order=3                    where id='ac33e053-a2be-4f47-9786-8dd4bd3886d6'; -- Cross     already neutral
update tags set category='off_player_action', sort_order=4, name='Header',       tag_polarity='neutral' where id='4945b8ce-c986-4a12-b4fc-99bbfb6bdb51'; -- was 'Header on goal', POSITIVE
update tags set category='off_player_action', sort_order=6, name='Through Ball', tag_polarity='neutral' where id='29aee6ed-3f5f-40eb-bd50-6b994375912a'; -- was 'Through ball',  POSITIVE

-- == 5. -> def_scheme · Our Defensive Shape (2 rows) ==========================
update tags set category='def_scheme', sort_order=0, name='High Press' where id='ed8c2abf-0ec2-4e79-99cd-37ebac3a93c4'; -- was plays 'High press'
update tags set category='def_scheme', sort_order=2, name='Low Block'  where id='7045b31d-08b6-4bef-b2db-969b01c8c323'; -- was plays 'Low block'

-- == 6. -> def_opp_play · Their Play / Pattern (1 row) ========================
update tags set category='def_opp_play', sort_order=5, name='Set Piece' where id='5791ee56-3dcc-4b6f-a057-c2b7e98d3d5f'; -- was plays 'Set piece'

-- == 7. -> def_result · Their Result (1 row) ==================================
-- 'Goal conceded' IS their result, and negative from our defence's point of view already.
update tags set category='def_result', sort_order=0, name='Goal' where id='9647cbf1-d9a5-4c1c-a289-53708b8a3dcb';

-- == 8. -> def_our_play · DEF Our Player Action (8 rows; polarity preserved) ==
update tags set category='def_our_play', sort_order=0, name='Tackle Won'   where id='ffa38cae-aacb-45a7-b3dc-450adfe13131'; -- positive
update tags set category='def_our_play', sort_order=1                      where id='b1cfd020-9fb2-4576-ad65-33633968d4ad'; -- Interception  positive
update tags set category='def_our_play', sort_order=2                      where id='03482108-d14f-4ec4-9243-496761195801'; -- Block         positive
update tags set category='def_our_play', sort_order=3                      where id='4576ceff-fd6c-4727-ac2d-e873ca9b5d1a'; -- Clearance     positive
update tags set category='def_our_play', sort_order=4, name='Ball Recovery' where id='65d2224a-4f8c-4bd6-9849-cc742c84c914'; -- positive
update tags set category='def_our_play', sort_order=5                      where id='42a01af8-67c3-4f1d-90fc-c42d0ebe7de4'; -- Save          positive
update tags set category='def_our_play', sort_order=6, name='1v1 Stop'     where id='784a9c06-4274-4db6-ad7d-7928fb9fd7fb'; -- positive
update tags set category='def_our_play', sort_order=7, name='Foul'         where id='edec4989-c193-4922-a834-4a0dea3614de'; -- was 'Foul committed', negative

-- == 9. RETIRE 17 zero-use legacy rows (retired_at ONLY) =====================
-- Soccer is greenfield, so there is no history to preserve and no reason to carry
-- non-launch clutter onto the board. NOT deleted: every id stays, and every one has ZERO
-- clip_tags uses, so nothing historical can change. They are left in their current
-- category on purpose -- retirement filters them out of every vocabulary reader, AND
-- soccer's definition no longer lists offense/defense/plays at all, so two independent
-- locks keep them off every board and out of My Tags' extras.
update tags set retired_at = now() where id = 'ae603247-c533-4567-b999-c73be57cff2d'; -- Goal kick
update tags set retired_at = now() where id = '15cfc876-1162-4cf3-b5c4-5226b1eaf1b9'; -- Transition
update tags set retired_at = now() where id = 'efb95ae3-0628-4c4d-b383-241b0f0518b6'; -- Penalty scored
update tags set retired_at = now() where id = '50bf011c-d449-4165-8844-0ff01491089d'; -- Penalty missed
update tags set retired_at = now() where id = '278a567b-553a-44b7-8247-eb103f243765'; -- Hit the post
update tags set retired_at = now() where id = '0bb4532c-9847-4fc3-bcce-dc54df598290'; -- Big chance created
update tags set retired_at = now() where id = '680d0fb8-f3f6-44cf-b2fe-7176dca73dca'; -- 1v1 vs keeper
update tags set retired_at = now() where id = 'd1ad2573-610e-4713-8114-12904e84544b'; -- Foul Won / Foul Drawn
update tags set retired_at = now() where id = '5351995d-dea0-4ef8-af31-4d7263a53def'; -- Diving save
update tags set retired_at = now() where id = '07a4e81c-5f06-4c44-8fe4-7f93ea3c47cb'; -- Penalty save
update tags set retired_at = now() where id = '7e2dc04c-2081-4921-9db0-d1ff4f3ec694'; -- Header clearance
update tags set retired_at = now() where id = '108cbb1f-697b-426a-85bc-91c092f32b97'; -- High press win
update tags set retired_at = now() where id = '1e974c65-2001-4ea6-b9f2-89de4175965c'; -- Penalty conceded
update tags set retired_at = now() where id = '1223a243-1f86-4233-97e4-9e8e82ceddc5'; -- Beaten by attacker
update tags set retired_at = now() where id = 'ba626060-afec-4e22-94a4-0518434945d4'; -- Own goal
update tags set retired_at = now() where id = 'e24dbbf9-fd07-4ef7-bb10-f74493a35384'; -- Yellow card
update tags set retired_at = now() where id = 'b0722869-0a1a-4c07-875f-688e18a328d5'; -- Red card

-- == 10. 35 new global rows ==================================================
-- Our Shape / Situation: the four base formations (context, neutral).
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('4-3-3',   'off_formation', 'global', null, 'Soccer', 0, 'neutral'),
  ('4-2-3-1', 'off_formation', 'global', null, 'Soccer', 1, 'neutral'),
  ('4-4-2',   'off_formation', 'global', null, 'Soccer', 2, 'neutral'),
  ('3-5-2',   'off_formation', 'global', null, 'Soccer', 3, 'neutral');

-- Our Play / Pattern. 'Counter' here is the PATTERN; 'Counterattack' above is the
-- SITUATION; Their Play / Pattern has its own 'Counter'. Three columns, three meanings.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Underlap',          'off_play', 'global', null, 'Soccer', 2, 'neutral'),
  ('Through Ball',      'off_play', 'global', null, 'Soccer', 4, 'neutral'),
  ('Cross',             'off_play', 'global', null, 'Soccer', 5, 'neutral'),
  ('Counter',           'off_play', 'global', null, 'Soccer', 6, 'neutral'),
  ('Combination Play',  'off_play', 'global', null, 'Soccer', 7, 'neutral');

-- OFF Our Player Action: technique/action types, all NEUTRAL by decision.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Shot',     'off_player_action', 'global', null, 'Soccer', 5, 'neutral'),
  ('GK Punt',  'off_player_action', 'global', null, 'Soccer', 7, 'neutral'),
  ('GK Throw', 'off_player_action', 'global', null, 'Soccer', 8, 'neutral');

-- Their Shape (OFF): the posture we are attacking INTO -- formations plus press/block.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('4-3-3',      'off_opp_look', 'global', null, 'Soccer', 0, 'neutral'),
  ('4-2-3-1',    'off_opp_look', 'global', null, 'Soccer', 1, 'neutral'),
  ('4-4-2',      'off_opp_look', 'global', null, 'Soccer', 2, 'neutral'),
  ('3-5-2',      'off_opp_look', 'global', null, 'Soccer', 3, 'neutral'),
  ('High Press', 'off_opp_look', 'global', null, 'Soccer', 4, 'neutral'),
  ('Mid-Block',  'off_opp_look', 'global', null, 'Soccer', 5, 'neutral'),
  ('Low Block',  'off_opp_look', 'global', null, 'Soccer', 6, 'neutral');

-- Their Shape (DEF): formations ONLY -- their press/block is meaningless when they have
-- the ball, so it is deliberately not offered here (Adam's decision 1).
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('4-3-3',   'def_opp_formation', 'global', null, 'Soccer', 0, 'neutral'),
  ('4-2-3-1', 'def_opp_formation', 'global', null, 'Soccer', 1, 'neutral'),
  ('4-4-2',   'def_opp_formation', 'global', null, 'Soccer', 2, 'neutral'),
  ('3-5-2',   'def_opp_formation', 'global', null, 'Soccer', 3, 'neutral');

-- Our Defensive Shape (the two carried rows sit at 0 and 2).
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Mid-Block',           'def_scheme', 'global', null, 'Soccer', 1, 'neutral'),
  ('Man-Oriented Press',  'def_scheme', 'global', null, 'Soccer', 3, 'neutral');

-- Their Play / Pattern (Set Piece is the carried row at 5).
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Build-up',     'def_opp_play', 'global', null, 'Soccer', 0, 'neutral'),
  ('Counter',      'def_opp_play', 'global', null, 'Soccer', 1, 'neutral'),
  ('Overlap',      'def_opp_play', 'global', null, 'Soccer', 2, 'neutral'),
  ('Through Ball', 'def_opp_play', 'global', null, 'Soccer', 3, 'neutral'),
  ('Cross',        'def_opp_play', 'global', null, 'Soccer', 4, 'neutral');

-- Their Result, read from OUR defence's point of view ('Goal' is the carried row at 0).
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Shot',        'def_result', 'global', null, 'Soccer', 1, 'negative'),
  ('Turnover',    'def_result', 'global', null, 'Soccer', 2, 'positive'),
  ('Corner Won',  'def_result', 'global', null, 'Soccer', 3, 'negative'),
  ('Foul Won',    'def_result', 'global', null, 'Soccer', 4, 'negative');

-- DEF Our Player Action: successful defensive pressure, like the other sports.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Pressure', 'def_our_play', 'global', null, 'Soccer', 8, 'positive');

-- APPLIED LIVE 2026-09-25 as Supabase migration <server stamp>_soccer_launch_taxonomy.
--
-- VERIFIED after apply:
--   tags 794 -> 829 (+35 inserts exactly). clip_tags 1535 -> 1535 with the md5 of every
--   (clip_id, tag_id, bundle_number) row UNCHANGED (a51e93ca480f33b76f11f80ae659663d) --
--   soccer had no uses to touch and nothing else was written.
--   Soccer 51 -> 86 rows: 69 active, 17 retired, and ZERO active rows left in
--   offense/defense/plays. Soccer uses still 0.
--   Other sports untouched: Football 142, Flag 135, 7-on-7 105, Basketball 107 globals,
--   Baseball 50, Softball 52, Lacrosse 43, Volleyball 31.
--   NO within-column duplicate anywhere in the soccer vocabulary.
--
--   Final active board (all ten counts match the approved plan):
--     OFF  Our Shape / Situation (10)  4-3-3 · 4-2-3-1 · 4-4-2 · 3-5-2 · Counterattack ·
--                                      Build-up · Corner · Free Kick · Throw-in · Restart
--          Our Play / Pattern (8)      Give-and-Go · Overlap · Underlap · Switch of Play ·
--                                      Through Ball · Cross · Counter · Combination Play
--          Our Result (7)              Goal+ · Shot on Target+ · Shot off Target- ·
--                                      Shot Blocked · Penalty Won+ · Offside- · Turnover-
--          Players                     (roster)
--          Our Player Action (9)       Assist+ · Key Pass+ · Take-On+ · Cross · Header ·
--                                      Shot · Through Ball · GK Punt · GK Throw
--          Their Shape (7)             4-3-3 · 4-2-3-1 · 4-4-2 · 3-5-2 · High Press ·
--                                      Mid-Block · Low Block
--     DEF  Their Shape (4)             4-3-3 · 4-2-3-1 · 4-4-2 · 3-5-2
--          Our Defensive Shape (4)     High Press · Mid-Block · Low Block · Man-Oriented Press
--          Their Play / Pattern (6)    Build-up · Counter · Overlap · Through Ball · Cross ·
--                                      Set Piece
--          Their Result (5)            Goal- · Shot- · Turnover+ · Corner Won- · Foul Won-
--          Players                     (roster)
--          Our Player Action (9)       Tackle Won+ · Interception+ · Block+ · Clearance+ ·
--                                      Ball Recovery+ · Save+ · 1v1 Stop+ · Foul- · Pressure+
--
--   Polarity rule verified live: every technique row (Cross, Header, Shot, Through Ball,
--   GK Punt, GK Throw) is neutral; every achievement row (Assist, Key Pass, Take-On, and
--   the nine defensive actions bar Foul) is positive; all context is neutral.
--
-- ROLLBACK (all by id): delete the 35 inserted rows; clear retired_at on the 17; move the
-- 34 carried rows back to offense/defense/plays with their original names, sort_orders and
-- polarity (Counter-attack/Give-and-go/Overlap/Header on goal/Through ball were positive).
