-- ============================================================
-- Per-video tagging-completion flag (Film Room green "done" card).
--
-- MANUAL signal: the coach taps a video's ✓ in the Film Room inline list to
-- mark it done being tagged — it is NOT derived from clip count. A game card
-- face turns green only when it has videos AND every one is tagging_complete
-- (see gameIsDone() in app/my-work.tsx). The separate red/yellow "has tagging
-- started" signal stays derived from clips(count) — this column does not
-- duplicate it.
--
-- Nullable, default false, no backfill/table rewrite (PG stores the default in
-- the catalog; existing rows read false virtually). App treats
-- tagging_complete === true as done; false/null as not done.
-- Idempotent. Applied live 2026-07-17.
-- ============================================================

BEGIN;

alter table videos add column if not exists tagging_complete boolean default false;

notify pgrst, 'reload schema';

COMMIT;
