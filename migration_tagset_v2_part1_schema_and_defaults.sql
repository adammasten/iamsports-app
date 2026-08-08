-- migration_tagset_v2_part1_schema_and_defaults.sql
--
-- PIECE 1 of the tag-set + stats rebuild. Adds the new structured stat columns,
-- switches stat_primitive to the 7-value model, moves us/them to a per-event
-- column on clip_tags, and replaces the GLOBAL default tag set with the locked
-- list. Player/roster tags (scope='team') are untouched.
--
-- SAFE FOR TAGGING: after this, the tagger shows the new set and saving clips
-- still works (clip_tags.stat_side defaults to 'us'). Stats will read zero until
-- the views are rewritten in Piece 2 — that's expected.
--
-- DESTRUCTIVE (intended): deletes all scope='global' tags, which cascades their
-- clip_tags rows. Confirmed OK — no tagged games to preserve.

begin;

-- 1. New structured stat columns on tags.
alter table tags add column if not exists stat_made   boolean;  -- shots/FT: true=make, false=miss
alter table tags add column if not exists stat_value  int;      -- points: 3 | 2 | 1 (FT) | null
alter table tags add column if not exists stat_detail text;     -- rebound: off|def · foul: personal|technical|offensive

-- 2. Per-event side lives on clip_tags now (toggle at tag time), not on the tag.
alter table clip_tags add column if not exists stat_side text not null default 'us'
  check (stat_side in ('us','them'));

-- 3. Clear the old global set (cascades clip_tags — intended). Roster/team tags stay.
delete from tags where scope = 'global';

-- 4. Swap stat_primitive to the 7-value model (safe now that old-valued globals are gone;
--    remaining team tags carry null stat_primitive).
alter table tags drop constraint if exists tags_stat_primitive_check;
alter table tags add constraint tags_stat_primitive_check
  check (stat_primitive is null or stat_primitive in
    ('shot','rebound','assist','steal','block','turnover','foul'));

-- stat_detail allowed values (null for tags where it doesn't apply).
alter table tags drop constraint if exists tags_stat_detail_check;
alter table tags add constraint tags_stat_detail_check
  check (stat_detail is null or stat_detail in ('off','def','personal','technical','offensive'));

-- 5. Insert the locked default GLOBAL set.
insert into tags (name, category, sort_order, scope, team_id, stat_primitive, stat_made, stat_value, stat_detail) values
  -- OFFENSE
  ('MADE 2',        'offense', 0, 'global', null, 'shot',    true,  2, null),
  ('miss 2',        'offense', 1, 'global', null, 'shot',    false, 2, null),
  ('MADE 3',        'offense', 2, 'global', null, 'shot',    true,  3, null),
  ('miss 3',        'offense', 3, 'global', null, 'shot',    false, 3, null),
  ('MADE FT',       'offense', 4, 'global', null, 'shot',    true,  1, null),
  ('miss ft',       'offense', 5, 'global', null, 'shot',    false, 1, null),
  ('Assist',        'offense', 6, 'global', null, 'assist',  null,  null, null),
  ('Off Rebound',   'offense', 7, 'global', null, 'rebound', null,  null, 'off'),
  ('Turnover',      'offense', 8, 'global', null, 'turnover',null,  null, null),
  ('Offensive Foul','offense', 9, 'global', null, 'foul',    null,  null, 'offensive'),
  -- DEFENSE
  ('Steal',         'defense', 0, 'global', null, 'steal',   null,  null, null),
  ('Block',         'defense', 1, 'global', null, 'block',   null,  null, null),
  ('Def Rebound',   'defense', 2, 'global', null, 'rebound', null,  null, 'def'),
  ('Foul',          'defense', 3, 'global', null, 'foul',    null,  null, 'personal'),
  ('Technical',     'defense', 4, 'global', null, 'foul',    null,  null, 'technical'),
  ('Press',         'defense', 5, 'global', null, null,      null,  null, null),
  ('Zone',          'defense', 6, 'global', null, null,      null,  null, null),
  ('BLOB',          'defense', 7, 'global', null, null,      null,  null, null),
  -- PLAYS (teaching/filter — no stat)
  ('Transition',      'plays', 0, 'global', null, null, null, null, null),
  ('Fast Break',      'plays', 1, 'global', null, null, null, null, null),
  ('Press Break',     'plays', 2, 'global', null, null, null, null, null),
  ('Half-Court / Man','plays', 3, 'global', null, null, null, null, null),
  ('Pick & Roll',     'plays', 4, 'global', null, null, null, null, null),
  ('Isolation',       'plays', 5, 'global', null, null, null, null, null),
  ('Set Play',        'plays', 6, 'global', null, null, null, null, null),
  -- SPECIAL (surfaced via ★/POE buttons)
  ('★ Highlight',   'special', 0, 'global', null, null, null, null, null),
  ('POE',           'special', 1, 'global', null, null, null, null, null);

commit;

notify pgrst, 'reload schema';
