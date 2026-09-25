-- SLICE F (Adam, 2026-09-25): Flag Football launch taxonomy -- six-column OFF/DEF.
--
-- Flag reaches the same shape Football got in Slice E: Player before Player Action, a
-- "Their Look" column on offense and a "Their Formation" column on defense. SP is
-- unchanged for 5v5 (that format has no SP phase at all) and gains a player-action
-- column for 7v7.
--
-- SAFE BY CONSTRUCTION. Every statement is BY ID: no row is deleted, no id changes, no
-- clip_tags row is written, and no category key is added (all 13 keys already pass
-- tags_category_check after Slice E, so the constraint is untouched). Recategorising a
-- tag changes which COLUMN it renders in; clip_tags is id-based and clipMatchesGroup
-- never reads `category`, so every historical Regents clip stays exportable exactly as
-- it is. Retirement removes a tag from FUTURE vocabulary only -- Export resolves tags
-- unfiltered, so a retired tag still resolves and still exports on the clips that used it.
--
-- Decisions applied verbatim from Adam's Slice F approval:
--   * retire ONLY 'Deep completion' and 'Big gain (20+)'. Legitimate football concepts
--     stay even at zero use (Pass, Play action, Option, Run Outside, Wheel, Rollout, the
--     directional runs, Trey, Safety, Forced fumble, Fumble recovery).
--   * minimal semantic relabels only (6). Crosser / Drag, Sweep / Toss, Reverse / Trick,
--     TFL (behind LOS) and Pass breakup keep their names. Global 'Reverse / Trick' is
--     deliberately NOT relabelled to 'Reverse' so Regents' own team 'Reverse' play does
--     not end up as a duplicate chip.
--   * keep Flag's existing play-result polarity convention. No broader may_reel_clip /
--     parent-highlight semantics change. The only polarity edits are the three named
--     below.

-- == 1. OFF player actions: move 5 rows out of off_result, BY ID ==============
-- off_result today mixes play FACTS with PLAYER attribution -- the same defect Slice E
-- fixed for Football's special_teams. Polarity is preserved on all five (the receiver /
-- passer positives were corrected on 2026-09-23 and are deliberate).
update tags set category = 'off_player_action', name = 'Catch',         sort_order = 0 where id = 'b64c27f8-38d8-45a5-9f7f-5368a88efb76'; -- was off_result 'Catch (Receiver)',        positive, 11 uses
update tags set category = 'off_player_action',                          sort_order = 1 where id = '902912ac-2148-4773-97a5-cdeace7a3b71'; -- was off_result 'Drop',                    negative,  1 use
update tags set category = 'off_player_action', name = 'Pass Complete',  sort_order = 2 where id = '099e19a2-3314-4820-9961-a6e5a98db057'; -- was off_result 'Pass completed (Passer)', positive,  4 uses
update tags set category = 'off_player_action', name = 'TD Pass',        sort_order = 3 where id = 'ca9aefc1-4f9f-420a-9c2f-671c07800d09'; -- was off_result 'Passing TD',              positive,  7 uses
update tags set category = 'off_player_action',                          sort_order = 5 where id = '640dcae3-9b62-4471-b0e2-c6c6df6cc17d'; -- was off_result 'Rushing TD',              positive,  1 use

-- 'Rush' is the neutral carry (mirrors Football's 'Carry'): being handed the ball is not
-- itself an achievement, so it must not authorise a parent highlight on its own.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Rush', 'off_player_action', 'global', null, 'Flag Football', 4, 'neutral');

-- == 2. OFF result: 1 relabel, 2 new rows, 2 retirements ======================
update tags set name = 'Interception' where id = '7e189273-1f96-428c-907f-2333d9d78075'; -- was 'INT thrown', negative, 0 uses
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('No Gain', 'off_result', 'global', null, 'Flag Football', 27, 'neutral'),
  ('Loss',    'off_result', 'global', null, 'Flag Football', 28, 'negative');

-- Retired, not deleted: derived/subjective outcomes. Their clips keep exporting.
update tags set retired_at = now() where id = 'b80963e6-c524-4391-b773-ef0e84579099'; -- 'Deep completion', 1 use
update tags set retired_at = now() where id = 'dc22aeb1-9ebe-4432-9ce9-d7661ea55654'; -- 'Big gain (20+)',  3 uses

-- == 3. OFF "Their Look" -- the defensive look we are FACING (7 new rows) =====
-- Context only, so every row is neutral: no play-context tag can qualify a child for a
-- parent highlight. Names intentionally mirror def_scheme -- same words, opposite side of
-- the ball, different column. Exactly what 7-on-7 and Football already do.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Man',            'off_opp_look', 'global', null, 'Flag Football', 0, 'neutral'),
  ('Zone',           'off_opp_look', 'global', null, 'Flag Football', 1, 'neutral'),
  ('Cover 2',        'off_opp_look', 'global', null, 'Flag Football', 2, 'neutral'),
  ('Cover 3',        'off_opp_look', 'global', null, 'Flag Football', 3, 'neutral'),
  ('Blitz',          'off_opp_look', 'global', null, 'Flag Football', 4, 'neutral'),
  ('Contain',        'off_opp_look', 'global', null, 'Flag Football', 5, 'neutral'),
  ('Box / Nose Look','off_opp_look', 'global', null, 'Flag Football', 6, 'neutral');

-- == 4. DEF "Their Formation" (6 new rows) ===================================
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Trips',  'def_opp_formation', 'global', null, 'Flag Football', 0, 'neutral'),
  ('Bunch',  'def_opp_formation', 'global', null, 'Flag Football', 1, 'neutral'),
  ('Twins',  'def_opp_formation', 'global', null, 'Flag Football', 2, 'neutral'),
  ('Empty',  'def_opp_formation', 'global', null, 'Flag Football', 3, 'neutral'),
  ('Stack',  'def_opp_formation', 'global', null, 'Flag Football', 4, 'neutral'),
  ('Motion', 'def_opp_formation', 'global', null, 'Flag Football', 5, 'neutral');

-- == 5. DEF "Their Play": routes + a generic run (6 new rows) =================
-- 'Pass' (15 uses, the most-used defensive chip) and the directional runs are KEPT --
-- adding routes does not replace them.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity) values
  ('Slant',  'def_opp_play', 'global', null, 'Flag Football', 13, 'neutral'),
  ('Out',    'def_opp_play', 'global', null, 'Flag Football', 14, 'neutral'),
  ('Post',   'def_opp_play', 'global', null, 'Flag Football', 15, 'neutral'),
  ('Corner', 'def_opp_play', 'global', null, 'Flag Football', 16, 'neutral'),
  ('Cross',  'def_opp_play', 'global', null, 'Flag Football', 17, 'neutral'),
  ('Run',    'def_opp_play', 'global', null, 'Flag Football', 18, 'neutral');

-- == 6. DEF result: 2 relabels + the one approved polarity fix ================
-- 'TD allowed' was neutral while its sibling 'First down allowed' was negative. Checked
-- before applying: the single clip using it also carries a positive (QB pressure), so it
-- cannot become pure-negative and disappear from a family's view.
update tags set name = 'First Down' where id = 'fdb69c16-ac4b-4af2-af51-fa25b43243ce'; -- was 'First down allowed', negative, 0 uses
update tags set name = 'Touchdown', tag_polarity = 'negative'
  where id = '79066c1a-2803-4b87-814d-300ea37f690f';                                    -- was 'TD allowed',         neutral,  2 uses

-- == 7. SP (7v7 only): player actions + return polarity ======================
-- Mirrors Slice E's Football SP shape. All eight st_* rows are format='7v7' with ZERO
-- uses, so this cannot affect any existing clip, and 5v5 has no SP phase at all.
update tags set category = 'st_player_action', sort_order = 0 where id = '7ad361ee-ec8a-4414-ba58-db610c51ad3c'; -- 'Return TD', stays positive
update tags set category = 'st_player_action', sort_order = 1 where id = '195a9fc6-e434-47ac-8838-9cbadddf3b10'; -- 'Tackle',    stays positive
-- Kick/Punt Return describe the KIND of play, not a good outcome.
update tags set tag_polarity = 'neutral' where id = 'af1953bf-2a09-44b8-8e38-832d6bc02130'; -- 'Kick Return', was positive
update tags set tag_polarity = 'neutral' where id = '449e1109-b2fc-4763-b3f0-79fc8a976118'; -- 'Punt Return', was positive

-- APPLIED LIVE 2026-09-25 as Supabase migration 20260925<server>_flag_football_launch_taxonomy.
--
-- VERIFIED after apply:
--   tags 689 -> 711 (+22 inserts exactly); Flag Football 113 -> 135; flag retired 3 -> 5;
--   clip_tags 1535 UNCHANGED; the 4 clip_tags rows on the two retired tags still exist and
--   both tags still resolve by id (Deep completion 1 use, Big gain (20+) 3 uses).
--   Control sports untouched: Football 142, 7-on-7 73, Basketball 60.
--   Flag active rows per column: off_formation 9 · off_opp_look 7 · off_play 23+5 team ·
--   off_result 11 · off_player_action 6 · def_opp_formation 6 · def_scheme 8 ·
--   def_opp_play 18 · def_result 9 · def_our_play 10 · st_play 8 · st_result 6 ·
--   st_player_action 2.
--   Our Player Action reads exactly: Catch · Drop · Pass Complete · TD Pass · Rush · Rushing TD.
--   NO duplicate chip in any column of the 5v5 offered set (checked on lower(name) per
--   category): global 'Reverse / Trick' was deliberately left unrelabelled, so Regents'
--   team 'Reverse' remains the only 'Reverse' chip; 'Cross' (team, off_play) and
--   'Crosser / Drag' stay distinct.
--   5v5 is offered zero st_* rows (they are all format='7v7').
--   Parent-highlight authorization UNCHANGED: 60 eligible player/clip pairs before and
--   after (every moved row kept its polarity).
--
-- ROLLBACK (all by id): move the 5 off_player_action rows back to off_result with their
-- original names/sort_orders (Catch (Receiver) 7, Drop 23, Pass completed (Passer) 8,
-- Passing TD 1, Rushing TD 2); rename Interception -> INT thrown, First Down -> First down
-- allowed, Touchdown -> TD allowed with tag_polarity='neutral'; set retired_at = null on
-- Deep completion and Big gain (20+); move Return TD (sort 7) and Tackle (sort 15) back to
-- st_result; restore Kick Return / Punt Return to positive; delete the 22 inserted rows.
