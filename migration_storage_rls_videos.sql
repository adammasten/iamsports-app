-- ============================================================
-- Storage RLS — 'Videos' bucket: authenticated-only access.
--
-- Replaces the dashboard's wide-open {public} CRUD policies
-- (named "New 16dfwjc_0..3") with authenticated-scoped equivalents
-- on storage.objects. Goal: logged-in users only, no anonymous
-- (publishable-key-without-session) read/write/delete. This is the
-- prerequisite for flipping the 'Videos' bucket to private without
-- breaking signed-URL minting.
--
-- SCOPE NOTE: deliberately simple — authenticated-only, NOT per-team
-- scoped yet. Any logged-in user can still read/sign any Videos
-- object; tightening to team-based ownership is a later step (would
-- require encoding team/owner in the object path and matching it here).
--
-- AUTH CONTEXT (audited):
--   * App uploads (game.tsx uploadVideoMobile/uploadVideoWeb) send the
--     user's session JWT (getFreshToken -> session.access_token), so
--     they run as role 'authenticated' -> INSERT/UPDATE pass.
--   * App playback/cache mint signed URLs via the publishable client
--     WHILE LOGGED IN (role 'authenticated') -> SELECT passes. Fetching
--     a minted signed URL is token-authorized and needs no policy.
--   * Railway export server uses the SERVICE_ROLE key, which BYPASSES
--     RLS entirely -> unaffected by these policies.
--
-- RUN IN: Supabase SQL Editor. If you hit "must be owner of table
-- objects", create these via the Storage -> Policies dashboard UI
-- instead (same definitions).
-- ============================================================

BEGIN;

-- 1. Drop the wide-open {public} policies (quoted — names contain spaces).
DROP POLICY IF EXISTS "New 16dfwjc_0" ON storage.objects;
DROP POLICY IF EXISTS "New 16dfwjc_1" ON storage.objects;
DROP POLICY IF EXISTS "New 16dfwjc_2" ON storage.objects;
DROP POLICY IF EXISTS "New 16dfwjc_3" ON storage.objects;

-- (Idempotency: drop our own names too, so this script is safe to re-run.)
DROP POLICY IF EXISTS videos_authenticated_select ON storage.objects;
DROP POLICY IF EXISTS videos_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS videos_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS videos_authenticated_delete ON storage.objects;

-- 2. Recreate the four operations, scoped to logged-in users only.
CREATE POLICY videos_authenticated_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'Videos');

CREATE POLICY videos_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'Videos');

CREATE POLICY videos_authenticated_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'Videos')
  WITH CHECK (bucket_id = 'Videos');

CREATE POLICY videos_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'Videos');

COMMIT;

-- ============================================================
-- VERIFY AFTER RUNNING (bucket can still be public for this check):
--
--   begin; set local role authenticated;
--   select count(*) as auth_visible from storage.objects where bucket_id = 'Videos';  -- expect: all objects
--   commit;
--
--   begin; set local role anon;
--   select count(*) as anon_visible from storage.objects where bucket_id = 'Videos';   -- expect: 0
--   commit;
--
-- Then smoke-test the LOGGED-IN app (play an uncached video + do a real
-- upload) while still public. Only after that, flip the 'Videos' bucket
-- to private and re-test playback + upload + export.
-- ============================================================
