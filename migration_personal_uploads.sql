-- ============================================================
-- Personal (no-team) uploads — enablement.
--
-- A personal video is standalone: game_id = null, team_id = null, owned by the
-- uploader (videos.uploaded_by_user_id). videos already supports this
-- (videos_insert / videos_read have the team_id-null + uploaded_by branch).
-- This migration only adds:
--   1. optional kid attribution on videos (videos.player_id)
--   2. a teamless-owner branch on clips_insert, so a user can clip their own
--      personal (team_id null) video.
--
-- Does NOT touch the games table — personal videos have no game wrapper for now
-- (videos.game_id stays nullable so a "wrap into a game" feature can come later).
--
-- Depends on: videos, players, clips, is_super_admin(), is_team_member().
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Optional kid attribution on a video. ON DELETE SET NULL so deleting a
--    player doesn't delete the video, just clears the attribution.
alter table videos add column if not exists player_id uuid references players(id) on delete set null;
create index if not exists idx_videos_player on videos(player_id);

-- 2. clips_insert — add the teamless-owner branch (mirrors videos_insert) so a
--    user can create clips on their own personal video. Original (lockdown 3)
--    was: is_super_admin() OR is_team_member(team_id). clips_read/update/delete
--    already allow created_by_user_id = auth.uid(), so only INSERT needs this.
drop policy if exists clips_insert on clips;
create policy clips_insert on clips
  for insert
  with check (
    is_super_admin()
    or is_team_member(team_id)
    or (team_id is null and created_by_user_id = auth.uid())
  );

notify pgrst, 'reload schema';
