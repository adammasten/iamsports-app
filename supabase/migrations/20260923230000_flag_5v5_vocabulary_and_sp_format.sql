-- SLICE C step 1 (Adam, 2026-09-23): 5v5 vocabulary + Special Teams format scoping.
-- APPLIED LIVE as migration 20260923230000_flag_5v5_vocabulary_and_sp_format.
-- Regents is deliberately NOT switched here -- that is the LAST step (next migration),
-- run after the hypothetical-5v5 tests pass, so the behavioral flip is isolated.

-- 1. TWINS -- a real formation, NOT a duplicate of Deuce. USA Football's 7v7 playbook
--    treats DEUCE and TWINS OPEN RIGHT/LEFT as distinct formations, and NFL FLAG uses
--    a Twins formation in its 5v5 playbook. Deuce is left exactly as-is: not
--    relabelled, not deleted, not aliased. format NULL = shared flag vocabulary.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity, format)
values ('Twins', 'off_formation', 'global', null, 'Flag Football', 22, 'neutral', null);

-- 2. 1-PT CONVERSION -- complements '2-pt conversion', not a duplicate. format NULL:
--    7v7 flag rules commonly derive from the same scoring framework, so the concept
--    is not hidden from 7v7.
insert into tags (name, category, scope, team_id, sport, sort_order, tag_polarity, format)
values ('1-pt conversion', 'off_result', 'global', null, 'Flag Football', 31, 'positive', null);

-- 3. SPECIAL TEAMS -> 7v7 only. Most 5v5 flag leagues have no kicking game. This is
--    the ONLY genuinely format-specific flag vocabulary; the other 101 global rows
--    stay NULL because they truly apply to both formats. All 16 rows have ZERO clip
--    uses. Ids, names, categories and polarity untouched -- only `format` is set.
update tags set format = '7v7'
where sport = 'Flag Football' and scope = 'global' and category in ('st_play', 'st_result');

-- Verified: tags 554 -> 556; 16 rows at format='7v7'; 88 flag globals still NULL;
-- zero non-flag tags carry a format; teams all still NULL at this point.
