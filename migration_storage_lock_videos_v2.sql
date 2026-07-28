-- ============================================================
-- LOCK the private 'Videos' bucket (v2) — close the storage read-leak ("Door #2")
-- WITHOUT breaking uploads.
--
-- ⚠️  DO NOT APPLY blindly. After applying, VERIFY ON DEVICE that (a) an upload
--     still succeeds and (b) playback still works. Uploads were confirmed working
--     under the broad temp SELECT policy; this NARROWS it to owner-scope, so the
--     upload path must be re-confirmed on device.
--
-- WHY v2 (v1 was wrong)
--   migration_storage_lock_videos.sql (v1) dropped videos_authenticated_select
--   ENTIRELY. That closed the leak but BROKE all uploads: the mobile resumable
--   (TUS) create sends `x-upsert: true`, and an upsert must run an existence
--   check — which is a SELECT on storage.objects. With NO SELECT policy that
--   query is denied, so the create fails. The failure was swallowed (log showed
--   "Creating TUS session" then silence), which made it hard to diagnose. v1 is
--   superseded and deleted from the repo.
--
-- WHAT v2 DOES
--   Scope SELECT to the CALLER'S OWN objects instead of removing it:
--       USING (bucket_id = 'Videos' AND owner = auth.uid())
--   This PERMITS the upsert's existence-check query — for a new, unique,
--   timestamped object key it simply returns 0 rows and the upload proceeds —
--   while still preventing an authenticated user from listing or signing ANYONE
--   ELSE'S media. The "enumerate everyone's videos" leak stays closed.
--
-- OWNER-NULL OBJECTS (measured, harmless)
--   40 of 96 existing Videos objects have owner = NULL (split: 56 set / 40 null,
--   and the null set includes the single newest object — the current upload path
--   does not reliably stamp owner). Under this policy those 40 are INVISIBLE to
--   client SELECT. That is HARMLESS: no client ever reads storage.objects to play
--   or export — playback goes through the sign-media Edge Function and export
--   through the Railway ffmpeg server, BOTH via the service role, which bypasses
--   RLS. Owner-scoping only affects direct client SELECT, which nothing relies on.
--
-- WHAT STAYS — uploads must keep working, so these are deliberately NOT touched:
--   * videos_authenticated_insert (INSERT, WITH CHECK bucket_id = 'Videos')
--   * videos_authenticated_update (UPDATE, USING/CHECK bucket_id = 'Videos')
--
-- Idempotent (IF EXISTS). Replaces whatever videos_authenticated_select currently
-- exists (the broad temp-restore policy) with the owner-scoped one.
-- ============================================================

DROP POLICY IF EXISTS videos_authenticated_select ON storage.objects;
CREATE POLICY videos_authenticated_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'Videos' AND owner = auth.uid());
