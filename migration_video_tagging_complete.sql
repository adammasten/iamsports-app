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
-- NOT NULL DEFAULT false (as applied live) — the column is never null, so app
-- code never inserts null (omit the column to take the default) and treats it
-- as an always-boolean in the green-card logic. ADD COLUMN with a DEFAULT is a
-- fast metadata-only default on PG 11+ (no table rewrite); NOT NULL is
-- satisfied by that default for existing rows.
-- Idempotent. Applied live 2026-07-17.
-- ============================================================

BEGIN;

alter table videos add column if not exists tagging_complete boolean not null default false;

notify pgrst, 'reload schema';

COMMIT;
