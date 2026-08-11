-- migration_share_content_add_game.sql
--
-- REPO↔LIVE RECONCILIATION. The `share_content` enum was created as
-- ('reel','video','clip') in migration_walls_reels_sharing.sql, but the app and
-- `resolve_shared_content` (migration_resolve_shared_content_game.sql) use
-- 'game'::share_content pervasively — so live already has the value. This file
-- records that change in the repo so the migrations match live (the value was
-- added on live outside a committed migration). Idempotent + safe to run.
--
-- NOTE: ADD VALUE cannot run inside a transaction block in older PG; run this
-- statement on its own (no surrounding begin/commit).

alter type share_content add value if not exists 'game';

notify pgrst, 'reload schema';
