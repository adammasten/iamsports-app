-- migration_video_original_url.sql
--
-- Two-copy playback model (source + streaming rendition), so streaming/tagging
-- works on any recording format without destroying quality:
--   videos.url          -> the STREAMING copy the player uses (720p H.264, made
--                          by the Railway /optimize endpoint). Playback already
--                          reads videos.url, so no app playback change is needed.
--   videos.original_url -> the full-quality MASTER, kept for download/export.
--
-- /optimize sets original_url = (old url) and url = (new 720p key); the master
-- file is never deleted. Nullable: original_url is null for videos that haven't
-- been optimized yet (they still play from url as before).

alter table videos add column if not exists original_url text;

notify pgrst, 'reload schema';
