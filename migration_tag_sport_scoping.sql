-- =====================================================================
-- Sport-scope tags. APPLIED LIVE via the Supabase MCP (migration: tag_sport_scoping).
--
-- Goal: a team only ever sees its own sport's tag vocabulary in the tagger and
-- tag manager, plus the universal tags. Multi-sport Phase A, step 4.
--
-- tags.sport: NULL = universal (shown for every sport); a value (matching
-- teams.sport / the app SPORTS list) = that sport only. Global tags are filtered
-- in the tagger by (sport IS NULL OR sport = the content team's sport). Team tags
-- belong to their team regardless of sport.
-- =====================================================================

alter table tags add column if not exists sport text;

-- Existing global vocabulary is 100% basketball EXCEPT the universal specials
-- (★ Highlight / POE, category 'special') and team player tags — those stay NULL.
update tags set sport = 'Basketball'
where scope = 'global' and category in ('offense', 'defense', 'plays') and sport is null;

comment on column tags.sport is
  'Sport this tag belongs to (matches teams.sport / the app SPORTS values). NULL = universal (shown for every sport), e.g. the ★ Highlight / POE specials and team player tags. Global tags are filtered in the tagger by (sport is null OR sport = the content team''s sport).';

-- After applying: NOTIFY pgrst, 'reload schema';  (run once so PostgREST sees the new column)
-- =====================================================================
