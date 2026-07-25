-- ============================================================
-- Retire the dead public_share_token branch from highlight_reels_read.
--
-- The reel read policy granted SELECT to ANYONE for any reel where
-- public_share_token IS NOT NULL — latent world-read of kid reels. But
-- public_share_token is DEAD: zero app code ever sets or reads it (leftover
-- public scaffolding, same class as retired 'Public' — see
-- migration_retire_public.sql). Removing the branch closes the latent hole and
-- changes nothing functionally (no reel relies on it).
--
-- Supersedes the public_share_token branch in migration_rls_lockdown_13_highlight_reels.sql
-- and migration_reels_nullable_creator.sql. The column itself is left in place
-- (dormant), like the followers table. Idempotent.
-- ============================================================

BEGIN;

drop policy if exists highlight_reels_read on highlight_reels;
create policy highlight_reels_read on highlight_reels
  for select
  using (
    is_super_admin()
    or created_by_user_id = auth.uid()
    or is_team_member(team_id)
  );

notify pgrst, 'reload schema';

COMMIT;
