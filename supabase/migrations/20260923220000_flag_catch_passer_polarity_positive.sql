-- Polarity correction pre-slice (Adam, 2026-09-23), ahead of the football-family work.
-- APPLIED LIVE as migration 20260923220000_flag_catch_passer_polarity_positive.
--
-- 'Catch (Receiver)' and 'Pass completed (Passer)' are POSITIVE PLAYER ACTIONS, but
-- were stored neutral. Under the parent-highlight rule (may_reel_clip) a parent needs
-- a positive tag in their own player's bundle, so a receiver credited with a catch --
-- or a QB with a completion -- did not qualify for their own highlight, while the
-- play-level 'Completion' (already positive) did. This inverts that.
--
-- tag_polarity ONLY, by id. No new rows, no name/category change, no clip_tags
-- touched, no other polarity altered.
update tags set tag_polarity = 'positive'
  where id = 'b64c27f8-38d8-45a5-9f7f-5368a88efb76';   -- Catch (Receiver),        11 clip uses
update tags set tag_polarity = 'positive'
  where id = '099e19a2-3314-4820-9961-a6e5a98db057';   -- Pass completed (Passer),  4 clip uses

-- Post-apply verification (2026-09-23):
--   exactly 2 rows changed: polarity totals pos 186->188, neutral 290->288, negative 78 unchanged
--   tags 554, clip_tags 1535, clips 402 (all origin='team') -- unchanged
--   parent-highlight adversarial test still blocks the Lars/Ward cross-bundle clip
--   no currently-linked parent's eligible-clip count changed (see note below)
--   export/tag baseline byte-identical on all 7 groups incl. the empty control
--
-- NOTE: no live parent is currently linked to a Regents Bangels flag player, so this
-- correction has zero effect on today's eligibility. It is forward-looking: the next
-- flag receiver whose guardian links to them will now correctly qualify for their own
-- catches. Reported, deliberately NOT changed in this slice:
--   * Flag def_result 'TD allowed' is neutral while 'First down allowed' is negative
--   * 7-on-7 'Tipped ball' / 'Blanket coverage' / 'Undercut / Jump' are neutral while
--     their sibling player actions are positive (0 uses; better handled in slice D)
--   * 'Kick Return' / 'Punt Return' are positive although they are play types, not
--     player actions (0 uses; better handled in slice E)
