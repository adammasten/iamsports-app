-- Seed GLOBAL tags for Soccer and Lacrosse (offense / defense / plays), matching
-- the existing model (Basketball / Flag Football / 7-on-7). Global tags are
-- sport-scoped (tags.sport), team_id null, scope='global'. The tagger surfaces
-- them for a video whose sport matches (exact Title-Case: 'Soccer' / 'Lacrosse').
-- Periods (Soccer 1H/2H, Lacrosse Q1-Q4) and ★/POE are sport=null globals that
-- already exist and are shared. The 'players' category is per-team (roster), not
-- global. tag_polarity: positive = highlight-worthy outcome, negative = mistake
-- (kept off family walls by clip_is_pure_negative), neutral = scheme/situation.
--
-- Idempotent: each sport block only inserts if that sport has no global tags yet.

do $$
begin
  -- ── SOCCER ──────────────────────────────────────────────────────────────────
  if not exists (select 1 from public.tags where scope='global' and sport='Soccer') then
    insert into public.tags (name, category, sort_order, scope, sport, tag_polarity) values
      -- offense
      ('Goal',                  'offense', 1,  'global','Soccer','positive'),
      ('Assist',                'offense', 2,  'global','Soccer','positive'),
      ('Shot on target',        'offense', 3,  'global','Soccer','positive'),
      ('Shot off target',       'offense', 4,  'global','Soccer','negative'),
      ('Shot blocked',          'offense', 5,  'global','Soccer','neutral'),
      ('Big chance created',    'offense', 6,  'global','Soccer','positive'),
      ('Key pass',              'offense', 7,  'global','Soccer','positive'),
      ('Through ball',          'offense', 8,  'global','Soccer','positive'),
      ('Cross',                 'offense', 9,  'global','Soccer','neutral'),
      ('Take-on / beat defender','offense',10, 'global','Soccer','positive'),
      ('Header on goal',        'offense', 11, 'global','Soccer','positive'),
      ('1v1 vs keeper',         'offense', 12, 'global','Soccer','positive'),
      ('Penalty won',           'offense', 13, 'global','Soccer','positive'),
      ('Penalty scored',        'offense', 14, 'global','Soccer','positive'),
      ('Penalty missed',        'offense', 15, 'global','Soccer','negative'),
      ('Hit the post',          'offense', 16, 'global','Soccer','neutral'),
      ('Turnover',              'offense', 17, 'global','Soccer','negative'),
      ('Offside',               'offense', 18, 'global','Soccer','negative'),
      -- defense
      ('Save',                  'defense', 1,  'global','Soccer','positive'),
      ('Diving save',           'defense', 2,  'global','Soccer','positive'),
      ('Penalty save',          'defense', 3,  'global','Soccer','positive'),
      ('Tackle won',            'defense', 4,  'global','Soccer','positive'),
      ('Interception',          'defense', 5,  'global','Soccer','positive'),
      ('Block',                 'defense', 6,  'global','Soccer','positive'),
      ('Clearance',             'defense', 7,  'global','Soccer','positive'),
      ('Header clearance',      'defense', 8,  'global','Soccer','positive'),
      ('Ball recovery',         'defense', 9,  'global','Soccer','positive'),
      ('1v1 stop',              'defense', 10, 'global','Soccer','positive'),
      ('High press win',        'defense', 11, 'global','Soccer','positive'),
      ('Foul committed',        'defense', 12, 'global','Soccer','negative'),
      ('Penalty conceded',      'defense', 13, 'global','Soccer','negative'),
      ('Beaten by attacker',    'defense', 14, 'global','Soccer','negative'),
      ('Own goal',              'defense', 15, 'global','Soccer','negative'),
      ('Goal conceded',         'defense', 16, 'global','Soccer','negative'),
      ('Yellow card',           'defense', 17, 'global','Soccer','negative'),
      ('Red card',              'defense', 18, 'global','Soccer','negative'),
      -- plays / situations
      ('Corner kick',           'plays',   1,  'global','Soccer','neutral'),
      ('Free kick',             'plays',   2,  'global','Soccer','neutral'),
      ('Throw-in',              'plays',   3,  'global','Soccer','neutral'),
      ('Goal kick',             'plays',   4,  'global','Soccer','neutral'),
      ('Kickoff / restart',     'plays',   5,  'global','Soccer','neutral'),
      ('Counter-attack',        'plays',   6,  'global','Soccer','positive'),
      ('Build-up / possession', 'plays',   7,  'global','Soccer','neutral'),
      ('Give-and-go (1-2)',     'plays',   8,  'global','Soccer','positive'),
      ('Overlap',               'plays',   9,  'global','Soccer','positive'),
      ('Switch of play',        'plays',   10, 'global','Soccer','neutral'),
      ('High press',            'plays',   11, 'global','Soccer','neutral'),
      ('Low block',             'plays',   12, 'global','Soccer','neutral'),
      ('Transition',            'plays',   13, 'global','Soccer','neutral'),
      ('Set piece',             'plays',   14, 'global','Soccer','neutral');
  end if;

  -- ── LACROSSE ────────────────────────────────────────────────────────────────
  if not exists (select 1 from public.tags where scope='global' and sport='Lacrosse') then
    insert into public.tags (name, category, sort_order, scope, sport, tag_polarity) values
      -- offense
      ('Goal',                  'offense', 1,  'global','Lacrosse','positive'),
      ('Assist / feed',         'offense', 2,  'global','Lacrosse','positive'),
      ('Shot on goal',          'offense', 3,  'global','Lacrosse','positive'),
      ('Shot missed',           'offense', 4,  'global','Lacrosse','negative'),
      ('Shot off pipe',         'offense', 5,  'global','Lacrosse','neutral'),
      ('Dodge (beat defender)', 'offense', 6,  'global','Lacrosse','positive'),
      ('Inside finish / crease','offense', 7,  'global','Lacrosse','positive'),
      ('Time & room shot',      'offense', 8,  'global','Lacrosse','positive'),
      ('On-the-run shot',       'offense', 9,  'global','Lacrosse','positive'),
      ('Man-up goal',           'offense', 10, 'global','Lacrosse','positive'),
      ('Two-point goal',        'offense', 11, 'global','Lacrosse','positive'),
      ('Ground ball (offense)', 'offense', 12, 'global','Lacrosse','positive'),
      ('Turnover',              'offense', 13, 'global','Lacrosse','negative'),
      ('Offensive foul',        'offense', 14, 'global','Lacrosse','negative'),
      ('Shot clock violation',  'offense', 15, 'global','Lacrosse','negative'),
      -- defense
      ('Save',                  'defense', 1,  'global','Lacrosse','positive'),
      ('Caused turnover',       'defense', 2,  'global','Lacrosse','positive'),
      ('Stick check / takeaway','defense', 3,  'global','Lacrosse','positive'),
      ('Ground ball',           'defense', 4,  'global','Lacrosse','positive'),
      ('Interception',          'defense', 5,  'global','Lacrosse','positive'),
      ('Slide',                 'defense', 6,  'global','Lacrosse','positive'),
      ('Man-down stop',         'defense', 7,  'global','Lacrosse','positive'),
      ('Shot blocked',          'defense', 8,  'global','Lacrosse','positive'),
      ('Ride (forces turnover)','defense', 9,  'global','Lacrosse','positive'),
      ('Goal allowed',          'defense', 10, 'global','Lacrosse','negative'),
      ('Beaten on dodge',       'defense', 11, 'global','Lacrosse','negative'),
      ('Penalty / foul',        'defense', 12, 'global','Lacrosse','negative'),
      ('Failed clear',          'defense', 13, 'global','Lacrosse','negative'),
      -- plays / situations
      ('Face-off win',          'plays',   1,  'global','Lacrosse','positive'),
      ('Face-off loss',         'plays',   2,  'global','Lacrosse','negative'),
      ('Clear',                 'plays',   3,  'global','Lacrosse','positive'),
      ('Ride',                  'plays',   4,  'global','Lacrosse','neutral'),
      ('Man-up (EMO)',          'plays',   5,  'global','Lacrosse','neutral'),
      ('Man-down',              'plays',   6,  'global','Lacrosse','neutral'),
      ('Fast break',            'plays',   7,  'global','Lacrosse','positive'),
      ('Settled offense',       'plays',   8,  'global','Lacrosse','neutral'),
      ('Transition',            'plays',   9,  'global','Lacrosse','neutral'),
      ('Two-man game',          'plays',   10, 'global','Lacrosse','neutral'),
      ('Zone defense',          'plays',   11, 'global','Lacrosse','neutral'),
      ('Man defense',           'plays',   12, 'global','Lacrosse','neutral'),
      ('Substitution (on the fly)','plays',13, 'global','Lacrosse','neutral');
  end if;
end $$;
