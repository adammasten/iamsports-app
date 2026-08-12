-- migration_video_thumbnails.sql
--
-- Poster thumbnails for cards. Adds a nullable thumbnail_path (a storage object
-- KEY, like url — NOT a URL) to videos and highlight_reels. NULL = no thumbnail
-- yet → the card shows its placeholder icon (today's behavior), so this is purely
-- additive and fails safe: nothing depends on it, and a missing/failed thumbnail
-- can never make a card worse than it is now.
--
-- The Railway optimize job (processOptimize) grabs a representative frame from the
-- 720p copy and sets videos.thumbnail_path = 'thumbnails/<video_id>.jpg' (best-
-- effort — a thumbnail failure never fails the optimize). Reels get theirs from
-- the reel-render job later; the column is added now so no second migration is
-- needed. Playback is unaffected (still videos.url).
--
-- Entitlement: a thumbnail is viewable iff its parent video is — sign-media
-- authorizes 'thumbnails/<id>.jpg' via authorize_video_playback(<id>).

alter table videos          add column if not exists thumbnail_path text;
alter table highlight_reels add column if not exists thumbnail_path text;

notify pgrst, 'reload schema';
