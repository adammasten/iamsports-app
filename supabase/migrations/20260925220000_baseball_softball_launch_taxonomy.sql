-- SLICE K (Adam, 2026-09-25): Baseball + Softball launch taxonomy.
--
-- BOTH SPORTS ARE GREENFIELD -- checked, not assumed: 0 teams, 0 videos, 0 clips and 0
-- clip_tags rows on any baseball or softball tag (re-verified immediately before applying).
-- One combined slice, code + data together, because they share the same structural change.
--
-- Every statement is BY ID. No deletions, no id changes, no clip_tags writes, and NO
-- constraint change -- the five keys used (off_play, off_player_action, def_scheme,
-- def_result, def_our_play) have all been in tags_category_check since Slice E.
--
-- THE BOARD (identical structure, different chip vocabulary):
--   OFF  Our Play · Players · Result / Player Action                        (3 columns)
--   DEF  Pitch / Play · Their Result · Players · Our Player Action          (4 columns)
--
-- WHY OFF MERGES RESULT AND PLAYER ACTION (Adam, 2026-09-25): in every other sport five
-- players act at once, so "what the play produced" and "what one player did" are different
-- facts. Baseball and softball are the exception -- one player acts at a time, so a Single IS
-- both the team's result and the batter's credit. Splitting it would force a fake distinction.
-- Where the actor is the RUNNER rather than the batter (Stolen Base, Run Scored, Caught
-- Stealing, Picked Off) the player bundle disambiguates them on the same clip.
-- DEF keeps them separate because there the opponent produced the result while our pitcher
-- or fielder did something else -- same event, two different actors.
--
-- DROPPED AT LAUNCH by decision: no Situation column (Full count / First-pitch swing retired
-- -- base/out/count context belongs in a later structured layer, not a 2-chip column) and no
-- Alignment column (Defensive shift moves into Pitch / Play rather than owning a column).
-- No pitch-result vocabulary (ball/strike, called/swinging): that is pitch-by-pitch charting,
-- a different product from clip tagging.

-- ############################## BASEBALL ##############################

-- == B1. -> off_play · Our Play (4, all neutral) ==============================
update tags set category='off_play', sort_order=0                        where id='42165e64-ec1f-48ba-bc35-b22b9ba2a5ba'; -- Bunt
update tags set category='off_play', sort_order=1, name='Hit and Run'    where id='696176de-665f-4e8f-b457-15e9f4f28be4';
update tags set category='off_play', sort_order=2, name='Steal Attempt'  where id='4f1a1bbe-ef7b-474d-bb74-caa0c27deb19';
update tags set category='off_play', sort_order=3, name='Squeeze Play'   where id='049ff62b-3ece-43ad-bff2-3697262a7fbe';

-- == B2. -> off_player_action · Result / Player Action (19) ===================
update tags set category='off_player_action', sort_order=0                            where id='63f00303-b3ae-4990-baa2-630f55db8939'; -- Single            positive
update tags set category='off_player_action', sort_order=1                            where id='6fdd8448-d7f1-4ca8-9fc1-7e8b03e6ce19'; -- Double            positive
update tags set category='off_player_action', sort_order=2                            where id='b75feca0-3161-4563-8e9c-114981408729'; -- Triple            positive
update tags set category='off_player_action', sort_order=3,  name='Home Run'          where id='044f1f24-9027-4a3b-822e-d3339cf50e90'; -- positive
update tags set category='off_player_action', sort_order=4                            where id='281a7c6e-2506-48f5-9cfb-a336c4725358'; -- RBI               positive (batter)
update tags set category='off_player_action', sort_order=5,  name='Walk'              where id='188040ad-6bf7-46ff-960c-0f948b90aa62'; -- was 'Walk (BB)', positive
update tags set category='off_player_action', sort_order=6                            where id='28efe623-bf24-415a-8a22-151abdd2c4dd'; -- Sac Bunt          positive
update tags set category='off_player_action', sort_order=7                            where id='c6cfbbcd-c855-41c7-937d-aae5dfeef892'; -- Sac Fly           positive
update tags set category='off_player_action', sort_order=8,  name='Stolen Base'       where id='1ee91d55-5391-42fc-bc8c-71cc5b320157'; -- positive (runner)
update tags set category='off_player_action', sort_order=9,  name='Run Scored'        where id='79559673-d62a-4d1a-b979-f13d03d4ac46'; -- positive (runner)
update tags set category='off_player_action', sort_order=10                           where id='7631e2be-d6f5-4df3-b4fc-0ae7472ad022'; -- Strikeout         negative (batter)
update tags set category='off_player_action', sort_order=11                           where id='b9b12e87-1d5b-40d4-aaf8-0593b0472981'; -- Groundout         negative
update tags set category='off_player_action', sort_order=12                           where id='d8f82b46-ef01-4bc2-a760-ea2cb41677a8'; -- Flyout            negative
update tags set category='off_player_action', sort_order=13                           where id='3d388942-b9ab-45e2-adbd-26382f5ddd21'; -- Popout            negative
update tags set category='off_player_action', sort_order=14, name='Caught Stealing'   where id='0fd482b7-1b94-487f-812c-b2f4a5c82f0a'; -- negative (runner)
update tags set category='off_player_action', sort_order=15, name='Into Double Play'  where id='a80534b0-b981-4697-9dbb-a5b2441b7192'; -- negative
-- Hit By Pitch: a RESULT, not a player achievement -- it must not independently authorise a
-- parent highlight, so it becomes NEUTRAL (Adam, 2026-09-25).
update tags set category='off_player_action', sort_order=17, name='Hit By Pitch', tag_polarity='neutral' where id='5e31ea0f-3dff-4dba-bf5b-c17fa9014e20';
update tags set category='off_player_action', sort_order=18                           where id='d09b9500-4bdc-4eb7-9f87-d39ffd89e109'; -- Fielder's Choice  neutral
update tags set category='off_player_action', sort_order=19, name='Reach on Error'    where id='70b874dd-6162-46db-b79a-452ffcfa161a'; -- was 'Reached on Error', neutral

-- == B3. -> def_scheme · Pitch / Play (7, all neutral) =======================
update tags set category='def_scheme', sort_order=0                          where id='db4b83c8-46e8-40eb-8d63-b202bee2f0c2'; -- Fastball
update tags set category='def_scheme', sort_order=1                          where id='5f2c1bf6-c8ce-48ba-96ad-4c5fa6b78033'; -- Curveball
update tags set category='def_scheme', sort_order=2                          where id='90b75043-bd7d-4051-8814-33d0876b2764'; -- Changeup
update tags set category='def_scheme', sort_order=3                          where id='f3422c41-18d0-494a-883a-633124b2d7c4'; -- Slider (baseball only)
update tags set category='def_scheme', sort_order=4                          where id='7289e236-a6a0-4559-91fb-1797f87a0af5'; -- Rundown
update tags set category='def_scheme', sort_order=5, name='Relay Throw'      where id='68f1dae9-d874-4e73-b5ed-dd5c6d2c1882';
update tags set category='def_scheme', sort_order=6, name='Defensive Shift'  where id='03dc8c99-b1a0-4a5c-93e3-34b9dcf617ce'; -- no Alignment column at launch

-- == B4. -> def_result · Their Result (7; our-POV names dropped) =============
update tags set category='def_result', sort_order=0, name='Hit'       where id='8090df51-3d7d-419d-9c6d-839e0007c6a0'; -- was 'Hit allowed',      negative
update tags set category='def_result', sort_order=1, name='Walk'      where id='3fe886fc-6f3d-4644-b46e-5e4a203c4557'; -- was 'Walk allowed',     negative
update tags set category='def_result', sort_order=2, name='Home Run'  where id='7f1c5773-8b02-4870-b54c-84f2cf557c53'; -- was 'Home run allowed', negative
update tags set category='def_result', sort_order=3, name='Groundout' where id='0a2e28f0-d586-4059-b01c-bd48ba35f689'; -- was 'Groundout (fielded)', positive
update tags set category='def_result', sort_order=4, name='Flyout'    where id='e80c7f5f-10df-4ada-9229-6b938128eaac'; -- was 'Flyout (caught)',  positive
update tags set category='def_result', sort_order=5                   where id='6b9e7098-5b95-44da-8c96-b0e63f071de0'; -- Lineout              positive
update tags set category='def_result', sort_order=6, name='Popout'    where id='89a54fdf-58b9-48c7-937e-5c6d0d650126'; -- was 'Popout (caught)',  positive

-- == B5. -> def_our_play · Our Player Action (10) ============================
-- Strikeout lives HERE (the pitcher earned it) and is deliberately NOT duplicated into
-- Their Result; the batter's Strikeout is the separate OFF row above.
update tags set category='def_our_play', sort_order=0, name='Strikeout'                where id='13d8fac7-2672-4ad2-ab76-a13932db4335'; -- was 'Strikeout (pitcher)'
update tags set category='def_our_play', sort_order=1, name='Double Play Turned'       where id='97329045-2c95-4e50-8130-35d04cce85ef';
update tags set category='def_our_play', sort_order=2                                  where id='29bfdce6-6a62-4cc9-8513-c90af53bd3c9'; -- Putout
update tags set category='def_our_play', sort_order=3, name='Fielding Assist'          where id='2d6d297f-0b2d-41ac-8463-916eaecdeeec';
update tags set category='def_our_play', sort_order=4, name='Diving Catch'             where id='7f1c5498-a7a3-488c-b298-1af6e69dea49';
update tags set category='def_our_play', sort_order=5, name='Outfield Assist'          where id='2736bd17-8e4e-4c25-84b1-80782fd30e49'; -- was '(throw out)'
update tags set category='def_our_play', sort_order=6                                  where id='894d3e42-406c-4160-9e44-cfa8bcaff296'; -- Pickoff (the successful one)
update tags set category='def_our_play', sort_order=7, name='Caught Stealing'          where id='77f4883d-1b91-4d84-8f23-54ceda45ecfa'; -- was '(defense)'
update tags set category='def_our_play', sort_order=8                                  where id='f41462c0-69ed-4c8d-a36c-014e2c490922'; -- Error     negative
update tags set category='def_our_play', sort_order=9, name='Wild Pitch / Passed Ball' where id='bbf6a841-03cb-4422-abfc-8a8c499a9657'; -- kept combined at launch

-- == B6. Baseball: 3 new rows ================================================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Picked Off',      'off_player_action', 'global', null, 'Baseball', 16, 'negative'),
  ('Line Drive',      'off_player_action', 'global', null, 'Baseball', 20, 'neutral'),
  ('Pickoff Attempt', 'def_scheme',        'global', null, 'Baseball',  7, 'neutral');

-- == B7. Baseball: 3 retirements (retired_at ONLY) ===========================
update tags set retired_at = now() where id = '961c7abe-85ad-4e03-91ec-cf1cf0e46868'; -- Hard-hit ball     (subjective quality judgment)
update tags set retired_at = now() where id = '5080c625-0293-4c41-8aee-502aac03508a'; -- Full count        (no Situation column at launch)
update tags set retired_at = now() where id = 'f635c585-777f-4573-acc0-60ace8f4f2c8'; -- First-pitch swing (same)

-- ############################## SOFTBALL ##############################

-- == S1. -> off_play · Our Play (5, all neutral; Slap is softball-only) ======
update tags set category='off_play', sort_order=0                       where id='fccc1827-9f52-4eb4-b7ec-9490a488481e'; -- Bunt
update tags set category='off_play', sort_order=1                       where id='50d315fc-5403-4312-8f65-1152314ece5e'; -- Slap
update tags set category='off_play', sort_order=2, name='Hit and Run'   where id='88ed2023-0821-4407-aa07-fee0b0213d0f';
update tags set category='off_play', sort_order=3, name='Steal Attempt' where id='632a83c5-f12a-4903-9f52-f7e792fffa18';
update tags set category='off_play', sort_order=4, name='Squeeze Play'  where id='c05ce06f-5b4b-4267-9e88-8fa90029efb1';

-- == S2. -> off_player_action · Result / Player Action (20) ==================
update tags set category='off_player_action', sort_order=0                            where id='243e74c9-1b5f-4ec2-89b9-3c1cce8576a9'; -- Single    positive
update tags set category='off_player_action', sort_order=1                            where id='199161a0-bf8b-4b4b-8a4a-3ba103672767'; -- Double    positive
update tags set category='off_player_action', sort_order=2                            where id='0acf687e-b6fa-49ff-8a21-ab1aafbefba8'; -- Triple    positive
update tags set category='off_player_action', sort_order=3,  name='Home Run'          where id='34a0ceb5-fa34-41e9-84d5-5b7c8f1058cd'; -- positive
update tags set category='off_player_action', sort_order=4                            where id='fccb30b1-3824-4d98-9e4f-d9cf4e2f8818'; -- RBI       positive
update tags set category='off_player_action', sort_order=5,  name='Walk'              where id='3e7839e3-10a0-41eb-8c63-cefeb7c9cc4f'; -- positive
update tags set category='off_player_action', sort_order=6                            where id='3a030e4d-5ed7-4626-8bd3-7e0900f87530'; -- Sac Bunt  positive
update tags set category='off_player_action', sort_order=7                            where id='d6a2b0f0-73a4-4e6e-a59f-68fbf694fe0c'; -- Sac Fly   positive
update tags set category='off_player_action', sort_order=8,  name='Stolen Base'       where id='e8bf6ad5-578f-4ce4-b0c2-d26d060cad44'; -- positive
update tags set category='off_player_action', sort_order=9,  name='Run Scored'        where id='c240cb78-0f35-4fe4-ba4e-c7d23c5e5bd9'; -- positive
update tags set category='off_player_action', sort_order=10, name='Slap Hit'          where id='e29554bd-9738-4f5f-9806-6fa3785a1021'; -- softball-only, positive
update tags set category='off_player_action', sort_order=11                           where id='b4d9f6be-ca3b-4609-bd2b-4d654011744d'; -- Strikeout negative
update tags set category='off_player_action', sort_order=12                           where id='5c48c88a-db92-4864-8950-b65e3191a762'; -- Groundout negative
update tags set category='off_player_action', sort_order=13                           where id='d68d67f8-d57c-441d-b2d0-ea352effb22b'; -- Flyout    negative
update tags set category='off_player_action', sort_order=14                           where id='6427db40-c280-442f-abb7-4bab5b91fd5a'; -- Popout    negative
update tags set category='off_player_action', sort_order=15, name='Caught Stealing'   where id='5269ca1c-7b02-4e5c-bb33-210176b6ecb9'; -- negative
update tags set category='off_player_action', sort_order=16, name='Into Double Play'  where id='1b8d4a2c-7a42-4dbe-aaf7-430bd3e1a94a'; -- negative
update tags set category='off_player_action', sort_order=18, name='Hit By Pitch', tag_polarity='neutral' where id='39dbeed0-2dce-48dc-bffe-f5f5111a2668';
update tags set category='off_player_action', sort_order=19                           where id='85257152-e22c-4795-82e5-5e71e34248a7'; -- Fielder's Choice neutral
update tags set category='off_player_action', sort_order=20, name='Reach on Error'    where id='4ddbbeaf-bdf4-4a6c-9519-38339d39817f'; -- neutral

-- == S3. -> def_scheme · Pitch / Play (8, all neutral) ======================
update tags set category='def_scheme', sort_order=0                          where id='e8574f4f-6a74-4e38-b9bb-42cde281bffa'; -- Fastball
update tags set category='def_scheme', sort_order=1                          where id='1304186b-66e8-490b-920e-caaf8351b574'; -- Changeup
update tags set category='def_scheme', sort_order=2, name='Rise Ball'        where id='9b9d2762-0dec-4954-9119-9889b324f270'; -- softball-only
update tags set category='def_scheme', sort_order=3, name='Drop Ball'        where id='34dcbc18-45ce-46e0-8efc-300442607596'; -- softball-only
update tags set category='def_scheme', sort_order=4                          where id='031cc4cf-8b15-42db-a395-ce81ecf66da2'; -- Screwball  softball-only
update tags set category='def_scheme', sort_order=5                          where id='b1470771-916b-4474-a3d3-1d11db5fc960'; -- Curveball
update tags set category='def_scheme', sort_order=7, name='Relay Throw'      where id='331a54ba-ffd5-4b5e-81a3-d70ee293c4f7';
update tags set category='def_scheme', sort_order=8, name='Defensive Shift'  where id='4a696862-10fe-4fda-93bc-8589ed6ca947';

-- == S4. -> def_result · Their Result (7) ===================================
update tags set category='def_result', sort_order=0, name='Hit'       where id='96888bf7-467a-44a9-b073-60b3623f8fe9'; -- negative
update tags set category='def_result', sort_order=1, name='Walk'      where id='2e5557f9-e48a-4f68-9473-278530d8ac2d'; -- negative
update tags set category='def_result', sort_order=2, name='Home Run'  where id='6cc244e8-bee4-46ba-80e8-c33d03a2df92'; -- negative
update tags set category='def_result', sort_order=3, name='Groundout' where id='f5ccc20a-b276-4837-b37c-23d7f04e538e'; -- positive
update tags set category='def_result', sort_order=4, name='Flyout'    where id='1a35d53d-d086-4e07-9d12-f06871e3c5df'; -- positive
update tags set category='def_result', sort_order=5                   where id='57221ed8-9faf-4af3-b606-bb5fcc471efe'; -- Lineout positive
update tags set category='def_result', sort_order=6, name='Popout'    where id='8b1a94a8-2e8e-4e44-9478-cf29925db3ea'; -- positive

-- == S5. -> def_our_play · Our Player Action (10) ===========================
update tags set category='def_our_play', sort_order=0, name='Strikeout'                where id='3d8b96c7-a42f-4251-a122-6e80a09119d3';
update tags set category='def_our_play', sort_order=1, name='Double Play Turned'       where id='3960aa8e-bcc4-45bf-96f2-df947fee751b';
update tags set category='def_our_play', sort_order=2                                  where id='8fa18923-f3de-4a52-bbb0-5e1a68188bfe'; -- Putout
update tags set category='def_our_play', sort_order=3, name='Fielding Assist'          where id='c6bf1dfa-4a56-4b34-8d8f-c0bd9cbd5367';
update tags set category='def_our_play', sort_order=4, name='Diving Catch'             where id='1bf6ea65-32f7-4eda-bdbf-ec1147700481';
update tags set category='def_our_play', sort_order=5, name='Outfield Assist'          where id='11183695-d336-4300-b98a-04756b5c2a85';
update tags set category='def_our_play', sort_order=6                                  where id='00d9a926-a1be-4816-9fe1-5e2a465e191c'; -- Pickoff
update tags set category='def_our_play', sort_order=7, name='Caught Stealing'          where id='34c15deb-8e15-4570-96f8-7630d73e7a81';
update tags set category='def_our_play', sort_order=8                                  where id='63ccaf43-57f0-4ee1-b393-74d946bd09eb'; -- Error negative
update tags set category='def_our_play', sort_order=9, name='Wild Pitch / Passed Ball' where id='44dd133c-fcbe-40fa-8391-8f352429212e';

-- == S6. Softball: 4 new rows ===============================================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Picked Off',      'off_player_action', 'global', null, 'Softball', 17, 'negative'),
  ('Line Drive',      'off_player_action', 'global', null, 'Softball', 21, 'neutral'),
  ('Rundown',         'def_scheme',        'global', null, 'Softball',  6, 'neutral'),
  ('Pickoff Attempt', 'def_scheme',        'global', null, 'Softball',  9, 'neutral');

-- == S7. Softball: 2 retirements (retired_at ONLY) ==========================
update tags set retired_at = now() where id = '21434bca-f29c-4d8f-9200-5b7fa52d341c'; -- Hard-hit ball
update tags set retired_at = now() where id = '958133b5-7aa3-4219-89e5-9d999e33d6ca'; -- Full count

-- APPLIED LIVE 2026-09-25 as Supabase migration <server stamp>_baseball_softball_launch_taxonomy.
--
-- VERIFIED after apply:
--   tags 862 -> 869 (+7 inserts exactly). clip_tags 1535 -> 1535 with the md5 of every
--   (clip_id, tag_id, bundle_number) row UNCHANGED (a51e93ca480f33b76f11f80ae659663d).
--   Baseball 50 -> 53 rows: 50 active, 3 retired. Softball 52 -> 56: 54 active, 2 retired.
--   ZERO active rows left in offense/defense/plays for either sport; uses still 0 for both.
--   Retired: Baseball First-pitch swing / Full count / Hard-hit ball; Softball Full count /
--   Hard-hit ball. NO within-column duplicate in either sport.
--   Other sports untouched: Football 142, Flag 135, 7-on-7 105, Basketball 107 globals,
--   Soccer 86, Lacrosse 76, Volleyball 31.
--
--   BASEBALL final board
--     OFF  Our Play (4)                 Bunt · Hit and Run · Steal Attempt · Squeeze Play
--          Players                      (roster)
--          Result / Player Action (21)  Single+ · Double+ · Triple+ · Home Run+ · RBI+ · Walk+ ·
--                                       Sac Bunt+ · Sac Fly+ · Stolen Base+ · Run Scored+ ·
--                                       Strikeout- · Groundout- · Flyout- · Popout- ·
--                                       Caught Stealing- · Into Double Play- · Picked Off- ·
--                                       Hit By Pitch · Fielder's Choice · Reach on Error · Line Drive
--     DEF  Pitch / Play (8)             Fastball · Curveball · Changeup · Slider · Rundown ·
--                                       Relay Throw · Defensive Shift · Pickoff Attempt
--          Their Result (7)             Hit- · Walk- · Home Run- · Groundout+ · Flyout+ ·
--                                       Lineout+ · Popout+
--          Players                      (roster)
--          Our Player Action (10)       Strikeout+ · Double Play Turned+ · Putout+ ·
--                                       Fielding Assist+ · Diving Catch+ · Outfield Assist+ ·
--                                       Pickoff+ · Caught Stealing+ · Error- ·
--                                       Wild Pitch / Passed Ball-
--
--   SOFTBALL final board: identical structure; Our Play (5) adds Slap, Result / Player Action
--   (22) adds Slap Hit+, Pitch / Play (10) swaps Slider for Rise Ball / Drop Ball / Screwball
--   and gains Rundown; Their Result and Our Player Action are identical to Baseball.
--
--   Polarity verified live: Hit By Pitch is NEUTRAL in both sports (a result, not an
--   achievement); every other existing polarity preserved, including all seven Their Result
--   rows (already defence-POV correct) and all ten Our Player Action rows. The ours/theirs
--   name pairs carry opposite polarity by column as designed: Groundout / Flyout / Popout
--   (ours negative, theirs positive), Home Run and Walk (ours positive, theirs negative).
--   Strikeout and Caught Stealing also appear on both sides of the ball with opposite
--   polarity -- our batter/runner negative, our pitcher/catcher positive.
--
-- ROLLBACK (all by id): delete the 7 inserted rows; clear retired_at on the 5; move the 97
-- carried rows back to offense/defense/plays with their original names and sort_orders, and
-- restore both Hit by pitch rows to positive.
