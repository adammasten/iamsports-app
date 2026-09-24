-- SLICE C final step (Adam, 2026-09-23): the single behavioral switch.
-- APPLIED LIVE as migration 20260923231000_regents_bangels_format_5v5.
--
-- Run ONLY after: Twins + 1-pt conversion exist, the 16 SP rows are format='7v7',
-- the 5v5 phase definition is live, and the hypothetical-5v5 tests pass. Isolating it
-- means this one row is the entire observable change.
--
-- Metadata only: one column on one team row. No tag id, tag row, clip, clip_tags,
-- team tag or player tag is touched. Regents' 87 historical clips and 19 team tags
-- are untouched and remain fully exportable -- format controls what is OFFERED for
-- new tagging, never what history means.
update teams set format = '5v5'
where id = 'ea52c5b6-ff03-4a47-b278-33cb4f4972c4';   -- Regents Bangels 3rd Grade 2026

-- Verified: Regents sport='Flag Football', format='5v5'; its board now loads 115
-- global rows with ZERO st_play/st_result; Twins, Deuce, 1-pt conversion and
-- Catch (Receiver) all present; 87 clips, 415 clip_tags rows, 19 team tags and 12
-- player tags unchanged; Cross/X1/X2/x3/Reverse intact; no other team has a format.
