-- migration_video_upload_status.sql
-- Phase 1 of the background-upload build: give videos a completion lifecycle so a
-- killed or backgrounded upload can never strand a row or surface a truncated video.
--
-- upload_status mirrors reel_status ('rendering','ready','failed') — the closest
-- media-processing lifecycle already in the schema. Values:
--   'uploading' — bytes in flight / object not yet finalized
--   'ready'     — object finalized AND size-verified (see upload_bytes)
--   'failed'    — upload aborted, or reconciliation found a size mismatch;
--                 the owner can retry or delete it (never a silent drop).
--
-- upload_bytes stores the expected source-file size captured at insert time, so
-- reconciliation can verify COMPLETENESS (HEAD content-length == upload_bytes)
-- rather than mere existence. Supabase stages in-progress bytes in
-- storage.s3_multipart_uploads (column in_progress_size) and only writes a
-- storage.objects row on finalization — but we still size-check, so a partial
-- object can never be marked 'ready'. Nullable: legacy rows have no expected size.
--
-- DEFAULT 'ready' backfills all existing rows via catalog metadata (PG11+; server
-- is PG17.6) — no table rewrite, no separate UPDATE. Every existing videos row is
-- a finished upload, so 'ready' is the correct backfill value.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'upload_status' and n.nspname = 'public'
  ) then
    create type public.upload_status as enum ('uploading', 'ready', 'failed');
  end if;
end $$;

alter table public.videos
  add column if not exists upload_status public.upload_status not null default 'ready';

alter table public.videos
  add column if not exists upload_bytes bigint;

notify pgrst, 'reload schema';
