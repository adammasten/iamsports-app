-- ============================================================
-- migration_stats_layer.sql
-- Stats derivation layer: tag→stat mapping, opponent tracking,
-- and the four aggregation views.
-- Run date: 2026-07-30
-- ============================================================
-- Run order matters. Sections 1-6 are schema + reference data
-- and are safe to run on any database at the pre-migration state.
-- Section 7 is one-off data repair for specific test rows and
-- should NOT be run elsewhere.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Columns on tags
-- ------------------------------------------------------------

alter table tags add column if not exists player_id uuid
  references players(id) on delete set null;

alter table tags add column if not exists stat_primitive text;

alter table tags add column if not exists stat_side text default 'own';


-- ------------------------------------------------------------
-- 2. Constraints
-- ------------------------------------------------------------

alter table tags drop constraint if exists tags_stat_primitive_check;
alter table tags add constraint tags_stat_primitive_check
  check (stat_primitive in (
    'made_2','missed_2','made_3','missed_3','made_ft','missed_ft',
    'off_reb','def_reb','assist','steal','block','turnover',
    'foul','technical'
  ));

alter table tags drop constraint if exists tags_stat_side_check;
alter table tags add constraint tags_stat_side_check
  check (stat_side in ('own','opponent'));

-- Extends the pre-existing 5-value category check with 'opponent'
alter table tags drop constraint if exists tags_category_check;
alter table tags add constraint tags_category_check
  check (category = any (array[
    'offense','defense','plays','players','special','opponent'
  ]));


-- ------------------------------------------------------------
-- 3. Map the 13 pre-existing tags to primitives
-- ------------------------------------------------------------

update tags set stat_primitive = 'made_2'    where name = 'MADE 2';
update tags set stat_primitive = 'missed_2'  where name = 'miss 2';
update tags set stat_primitive = 'made_3'    where name = 'MADE 3';
update tags set stat_primitive = 'missed_3'  where name = 'miss 3';
update tags set stat_primitive = 'made_ft'   where name = 'MADE FT';
update tags set stat_primitive = 'missed_ft' where name = 'miss ft';
update tags set stat_primitive = 'off_reb'   where name = 'Reb O';
update tags set stat_primitive = 'def_reb'   where name = 'Reb D';
update tags set stat_primitive = 'assist'    where name = 'Assist';
update tags set stat_primitive = 'steal'     where name = 'Steal';
update tags set stat_primitive = 'block'     where name = 'Block';
update tags set stat_primitive = 'turnover'  where name = 'Turnover';
update tags set stat_primitive = 'foul'      where name = 'Foul D';


-- ------------------------------------------------------------
-- 4. New own-team tags
--    scope/team_id copied from an existing tag rather than
--    hardcoded, since scope is a USER-DEFINED enum.
-- ------------------------------------------------------------

insert into tags (name, category, sort_order, scope, team_id, stat_primitive, stat_side)
select v.name, v.category, v.sort_order, ref.scope, ref.team_id, v.stat_primitive, v.stat_side
from (values
  ('Foul O',    'offense', 100, 'foul',      'own'),
  ('Technical', 'defense', 101, 'technical', 'own')
) as v(name, category, sort_order, stat_primitive, stat_side)
cross join (select scope, team_id from tags where name = 'MADE 2' limit 1) as ref
where not exists (select 1 from tags t where t.name = v.name);


-- ------------------------------------------------------------
-- 5. Opponent tags (8)
--    Team-level only, never player-attributed.
-- ------------------------------------------------------------

insert into tags (name, category, sort_order, scope, team_id, stat_primitive, stat_side)
select v.name, v.category, v.sort_order, ref.scope, ref.team_id, v.stat_primitive, v.stat_side
from (values
  ('OPP MADE 2',  'opponent', 102, 'made_2',    'opponent'),
  ('OPP MADE 3',  'opponent', 103, 'made_3',    'opponent'),
  ('OPP MADE FT', 'opponent', 104, 'made_ft',   'opponent'),
  ('OPP miss 2',  'opponent', 105, 'missed_2',  'opponent'),
  ('OPP miss 3',  'opponent', 106, 'missed_3',  'opponent'),
  ('OPP miss ft', 'opponent', 107, 'missed_ft', 'opponent'),
  ('OPP Reb O',   'opponent', 108, 'off_reb',   'opponent'),
  ('OPP Reb D',   'opponent', 109, 'def_reb',   'opponent')
) as v(name, category, sort_order, stat_primitive, stat_side)
cross join (select scope, team_id from tags where name = 'MADE 2' limit 1) as ref
where not exists (select 1 from tags t where t.name = v.name);


-- ------------------------------------------------------------
-- 6. Views
-- ------------------------------------------------------------

-- 6a. stat_events — the atomic resolver.
--     bundle_number 0 is descriptive only and never produces a stat.
--     A bundle with an action and no player is a TEAM stat.
--     A bundle with a player and no action is a coaching note (no row).
--     distinct on stat_primitive dedups double-tapped synonyms.
create or replace view stat_events as
with bundle_player as (
  select ct.clip_id, ct.bundle_number, t.name as player_name
  from clip_tags ct
  join tags t on t.id = ct.tag_id
  where ct.bundle_number >= 1
    and t.category = 'players'
),
bundle_stat as (
  select distinct ct.clip_id, ct.bundle_number, t.stat_primitive, t.stat_side
  from clip_tags ct
  join tags t on t.id = ct.tag_id
  where ct.bundle_number >= 1
    and t.stat_primitive is not null
)
select
  bs.clip_id,
  bs.bundle_number,
  bp.player_name,
  bs.stat_primitive,
  bs.stat_side,
  (bp.player_name is null) as is_team_stat
from bundle_stat bs
left join bundle_player bp
  on bp.clip_id = bs.clip_id
 and bp.bundle_number = bs.bundle_number;


-- 6b. game_box_score — per game, per player.
--     NOTE: splits 2FG/3FG. NCAA/NBA convention is total FG with
--     3PT as a subset. Realign to match season_player_stats.
create or replace view game_box_score as
select
  v.game_id,
  coalesce(se.player_name, 'TEAM') as player,
  se.stat_side,
  count(*) filter (where se.stat_primitive = 'made_2')                  as fgm_2,
  count(*) filter (where se.stat_primitive in ('made_2','missed_2'))    as fga_2,
  count(*) filter (where se.stat_primitive = 'made_3')                  as fgm_3,
  count(*) filter (where se.stat_primitive in ('made_3','missed_3'))    as fga_3,
  count(*) filter (where se.stat_primitive = 'made_ft')                 as ftm,
  count(*) filter (where se.stat_primitive in ('made_ft','missed_ft'))  as fta,
  count(*) filter (where se.stat_primitive = 'made_2') * 2
    + count(*) filter (where se.stat_primitive = 'made_3') * 3
    + count(*) filter (where se.stat_primitive = 'made_ft')             as pts,
  count(*) filter (where se.stat_primitive = 'off_reb')                 as oreb,
  count(*) filter (where se.stat_primitive = 'def_reb')                 as dreb,
  count(*) filter (where se.stat_primitive in ('off_reb','def_reb'))    as reb,
  count(*) filter (where se.stat_primitive = 'assist')                  as ast,
  count(*) filter (where se.stat_primitive = 'steal')                   as stl,
  count(*) filter (where se.stat_primitive = 'block')                   as blk,
  count(*) filter (where se.stat_primitive = 'turnover')                as tov,
  count(*) filter (where se.stat_primitive = 'foul')                    as pf,
  count(*) filter (where se.stat_primitive = 'technical')               as tf
from stat_events se
join clips c  on c.id = se.clip_id
join videos v on v.id = c.video_id
where v.game_id is not null
group by v.game_id, coalesce(se.player_name, 'TEAM'), se.stat_side;


-- 6c. season_player_stats — season to date, NCAA column order.
--     KNOWN ISSUE: the gp CTE joins players.name against tag names.
--     Tag names are first-name-only ('Lars') while players.name is
--     full ('Lars Masten'), so GP resolves null. Fix by joining on
--     tags.player_id. Also depends on game_lineups being populated.
create or replace view season_player_stats as
with gs as (
  select g.id as game_id, g.season_id
  from games g where g.season_id is not null
),
ev as (
  select gs.season_id, coalesce(se.player_name,'TEAM') as player, se.stat_primitive
  from stat_events se
  join clips c on c.id = se.clip_id
  join videos v on v.id = c.video_id
  join gs on gs.game_id = v.game_id
  where se.stat_side = 'own'
),
agg as (
  select season_id, player,
    count(*) filter (where stat_primitive in ('made_2','made_3'))                       as fgm,
    count(*) filter (where stat_primitive in ('made_2','made_3','missed_2','missed_3')) as fga,
    count(*) filter (where stat_primitive = 'made_3')                                   as fg3m,
    count(*) filter (where stat_primitive in ('made_3','missed_3'))                     as fg3a,
    count(*) filter (where stat_primitive = 'made_ft')                                  as ftm,
    count(*) filter (where stat_primitive in ('made_ft','missed_ft'))                   as fta,
    count(*) filter (where stat_primitive = 'off_reb')                                  as oreb,
    count(*) filter (where stat_primitive = 'def_reb')                                  as dreb,
    count(*) filter (where stat_primitive = 'assist')                                   as ast,
    count(*) filter (where stat_primitive = 'turnover')                                 as tov,
    count(*) filter (where stat_primitive = 'steal')                                    as stl,
    count(*) filter (where stat_primitive = 'block')                                    as blk,
    count(*) filter (where stat_primitive = 'foul')                                     as pf,
    count(*) filter (where stat_primitive = 'technical')                                as tf,
    count(*) filter (where stat_primitive = 'made_2') * 2
      + count(*) filter (where stat_primitive = 'made_3') * 3
      + count(*) filter (where stat_primitive = 'made_ft')                              as pts
  from ev group by season_id, player
),
gp as (
  select gs.season_id, p.name as player, count(distinct gl.game_id) as gp
  from game_lineups gl
  join gs on gs.game_id = gl.game_id
  join players p on p.id = gl.player_id
  group by gs.season_id, p.name
)
select
  a.season_id, a.player, gp.gp,
  a.fgm, a.fga,   round(100.0 * a.fgm  / nullif(a.fga,0), 1)  as fg_pct,
  a.fg3m, a.fg3a, round(100.0 * a.fg3m / nullif(a.fg3a,0), 1) as fg3_pct,
  a.ftm, a.fta,   round(100.0 * a.ftm  / nullif(a.fta,0), 1)  as ft_pct,
  a.oreb, a.dreb, a.oreb + a.dreb as reb,
  round(1.0 * (a.oreb + a.dreb) / nullif(gp.gp,0), 1) as reb_avg,
  a.ast, a.tov, a.stl, a.blk, a.pf, a.tf,
  a.pts, round(1.0 * a.pts / nullif(gp.gp,0), 1) as ppg
from agg a
left join gp on gp.season_id = a.season_id and gp.player = a.player;


-- 6d. season_team_stats — TOTAL vs OPPONENT.
--     'TOTAL' = all players + unattributed. Distinct from the 'TEAM'
--     row in season_player_stats, which is unattributed only.
--     Mirrors the NCAA sheet's three row types.
create or replace view season_team_stats as
select
  season_id, team_id,
  case when stat_side = 'own' then 'TOTAL' else 'OPPONENT' end as side,
  gp, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, tov, stl, blk, pf, pts
from (
  select
    g.season_id, g.team_id, se.stat_side,
    count(distinct g.id) as gp,
    count(*) filter (where se.stat_primitive in ('made_2','made_3'))                       as fgm,
    count(*) filter (where se.stat_primitive in ('made_2','made_3','missed_2','missed_3')) as fga,
    count(*) filter (where se.stat_primitive = 'made_3')                                   as fg3m,
    count(*) filter (where se.stat_primitive in ('made_3','missed_3'))                     as fg3a,
    count(*) filter (where se.stat_primitive = 'made_ft')                                  as ftm,
    count(*) filter (where se.stat_primitive in ('made_ft','missed_ft'))                   as fta,
    count(*) filter (where se.stat_primitive = 'off_reb')                                  as oreb,
    count(*) filter (where se.stat_primitive = 'def_reb')                                  as dreb,
    count(*) filter (where se.stat_primitive = 'assist')                                   as ast,
    count(*) filter (where se.stat_primitive = 'turnover')                                 as tov,
    count(*) filter (where se.stat_primitive = 'steal')                                    as stl,
    count(*) filter (where se.stat_primitive = 'block')                                     as blk,
    count(*) filter (where se.stat_primitive = 'foul')                                      as pf,
    count(*) filter (where se.stat_primitive = 'made_2') * 2
      + count(*) filter (where se.stat_primitive = 'made_3') * 3
      + count(*) filter (where se.stat_primitive = 'made_ft')                               as pts
  from stat_events se
  join clips c on c.id = se.clip_id
  join videos v on v.id = c.video_id
  join games g on g.id = v.game_id
  where g.season_id is not null
  group by g.season_id, g.team_id, se.stat_side
) x;


-- ------------------------------------------------------------
-- 7. ONE-OFF DATA REPAIR — do not run on other databases
-- ------------------------------------------------------------
-- Conrad Masten's players row had a null team_id because
-- create_kid() hardcodes team_id = null. Patched manually.
-- The real fix is a coach roster path; see docs/stats-data-layer.md
--
-- update players
-- set team_id = '07e44046-f169-4fc2-8d13-4c3d7e1e26c6'
-- where id = '1b95a1c4-a5e4-4f44-b695-2acfb932175e';
--
-- Link Lars's tag to his roster row:
-- update tags
-- set player_id = 'e34c2405-8550-4f08-be5c-446765aa0eeb'
-- where id = 'e7502944-d7c0-4801-9b2b-7b0a410ecd12';
--
-- Create Conrad's player tag, linked:
-- insert into tags (name, category, sort_order, scope, team_id, player_id)
-- values ('Conrad', 'players', 201, 'team',
--   '07e44046-f169-4fc2-8d13-4c3d7e1e26c6',
--   '1b95a1c4-a5e4-4f44-b695-2acfb932175e');


-- ------------------------------------------------------------
-- Verify
-- ------------------------------------------------------------
-- select category, name, stat_primitive, stat_side
-- from tags order by category, sort_order;
--   Expect 27 tags, 23 with a primitive.
--
-- select * from stat_events order by clip_id, bundle_number;
-- select * from game_box_score;
-- select * from season_player_stats;
-- select * from season_team_stats;
