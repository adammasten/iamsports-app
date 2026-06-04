-- ============================================================
-- Video tagging rights — ADDITIVE ONLY. Nothing is dropped.
-- Grants specific users the right to tag a given video, with
-- optional name-hiding and expiry. Safe to re-run (idempotent):
-- guarded with IF NOT EXISTS / existence checks.
-- ============================================================

BEGIN;

-- 1. Enum: grant_status (guarded so re-running is a no-op)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_status') THEN
    CREATE TYPE grant_status AS ENUM ('active', 'revoked', 'expired');
  END IF;
END $$;

-- 2. video_tagging_rights table
CREATE TABLE IF NOT EXISTS video_tagging_rights (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id            uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  granted_to_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  can_tag             boolean NOT NULL DEFAULT true,
  names_hidden        boolean NOT NULL DEFAULT false,
  status              grant_status NOT NULL DEFAULT 'active',
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, granted_to_user_id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_video_tagging_rights_video ON video_tagging_rights(video_id);
CREATE INDEX IF NOT EXISTS idx_video_tagging_rights_user  ON video_tagging_rights(granted_to_user_id);

-- 4. RLS — allow_all placeholder, matching the existing tables
ALTER TABLE video_tagging_rights ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'video_tagging_rights' AND policyname = 'allow_all_video_tagging_rights'
  ) THEN
    CREATE POLICY allow_all_video_tagging_rights ON video_tagging_rights FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;

-- 5. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
