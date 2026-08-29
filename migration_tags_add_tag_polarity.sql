-- Applied live 2026-08-29 via Supabase MCP (apply_migration).
--
-- Slice 6 of the Family Film Room plan (docs/PARENT_FILM_ROOM_PLAN.md): tag
-- polarity, the data foundation for the parent "positive highlight" flow (Slice 7).
-- Text + CHECK to match the existing stat_* columns; default 'neutral' so every
-- tag (and every future one) is neutral until classified. Own-team perspective.
--
-- Enforcement is LIGHT (Adam's call): polarity is metadata consumed by the
-- highlight builder + UI, NOT an RLS gate. A parent can still read their own
-- kid's negative clips; the reel just excludes them. Strict RLS stripping can be
-- added later if ever wanted.
--
-- Result: positive 49, negative 16, neutral 131 tag rows.

alter table public.tags
  add column if not exists tag_polarity text not null default 'neutral'
  check (tag_polarity in ('positive','neutral','negative'));

-- 1) Auto-seed from the stat signal already on the tags.
update public.tags set tag_polarity = 'positive' where stat_made = true;
update public.tags set tag_polarity = 'negative' where stat_made = false;
update public.tags set tag_polarity = 'positive'
  where stat_primitive in ('assist','steal','block','rebound');
update public.tags set tag_polarity = 'negative'
  where stat_primitive in ('foul','turnover');

-- 2) Curated POSITIVE (action tags without a stat signal).
update public.tags set tag_polarity = 'positive'
where category in ('offense','defense','plays') and name in (
  'Made Shot','Assist','Steal','Block','Rebound','Off Rebound','Def Rebound',
  'Charge Taken','Deflection','Fast Break','Contested Shot','Fouled on Shot','Pressure','QB pressure',
  'Touchdown','Passing TD','Rushing TD','Interception','Sack','Safety','First down',
  'Completion','Deep completion','Big gain (20+)','2-pt conversion','Contested catch',
  'Forced fumble','Forced Turnover','Forced incompletion','Fumble recovery','Flag pull',
  'Pass breakup','Pass breakup (PBU)','TFL (behind LOS)','Stop / turnover on downs'
);

-- 3) Curated NEGATIVE.
update public.tags set tag_polarity = 'negative'
where category in ('offense','defense','plays') and name in (
  'Missed Shot','Offensive Foul','Shooting Foul','Foul','Technical',
  'Fumble','INT thrown','Incompletion','Drop','Missed flag pull'
);
