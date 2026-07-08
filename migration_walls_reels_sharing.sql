-- ============================================================
-- Walls, highlight reels & sharing — ADDITIVE ONLY. Nothing dropped.
-- Adds highlight_reels, shares, and followers tables plus their
-- supporting enums. Safe to re-run (idempotent): guarded with
-- IF NOT EXISTS / existence checks.
-- ============================================================

BEGIN;

-- 1. Enums (each guarded so re-running is a no-op)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reel_status') THEN
    CREATE TYPE reel_status AS ENUM ('rendering', 'ready', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_content') THEN
    CREATE TYPE share_content AS ENUM ('reel', 'video', 'clip');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_audience') THEN
    CREATE TYPE share_audience AS ENUM ('public', 'team', 'player', 'coaches');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follower_scope') THEN
    CREATE TYPE follower_scope AS ENUM ('team', 'player');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follower_status') THEN
    CREATE TYPE follower_status AS ENUM ('pending', 'approved', 'revoked');
  END IF;
END $$;

-- 2. highlight_reels
CREATE TABLE IF NOT EXISTS highlight_reels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid REFERENCES teams(id) ON DELETE CASCADE,
  season_id           uuid REFERENCES seasons(id) ON DELETE CASCADE,
  created_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                text NOT NULL,
  storage_path        text,
  source_clip_ids     uuid[],
  duration_seconds    numeric,
  overlay_mode        text NOT NULL DEFAULT 'clean',
  status              reel_status NOT NULL DEFAULT 'rendering',
  public_share_token  text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 3. shares
CREATE TABLE IF NOT EXISTS shares (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type        share_content NOT NULL,
  content_id          uuid NOT NULL,
  team_id             uuid REFERENCES teams(id) ON DELETE CASCADE,
  season_id           uuid REFERENCES seasons(id) ON DELETE CASCADE,
  audience            share_audience NOT NULL,
  target_player_id    uuid REFERENCES players(id) ON DELETE CASCADE,
  shared_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hidden_by_family    boolean NOT NULL DEFAULT false,
  visible             boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_type, content_id, audience, target_player_id)
);

-- 4. followers
-- ============================================================
-- ⚠️ RESERVED / DORMANT — NOT IN USE. DO NOT WIRE OR BUILD ON THIS.
-- Referenced by ZERO app code. The follower feature is DEFERRED to post-launch
-- (decision locked 2026-07-08). Kept in the schema on purpose — do NOT delete.
--   • "See teammates' public content" is handled by TEAM MEMBERSHIP, not this.
--   • Request/approve onboarding + the viewer/grandparent tier are NET-NEW to
--     design later, and will NOT be built via this table for now.
-- If you're a future session eyeing this: treat as reserved, confirm with Adam
-- before touching. See CLAUDE.md "Don't relitigate" + the permissions/onboarding
-- memory note.
-- ============================================================
CREATE TABLE IF NOT EXISTS followers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope               follower_scope NOT NULL,
  team_id             uuid REFERENCES teams(id) ON DELETE CASCADE,
  player_id           uuid REFERENCES players(id) ON DELETE CASCADE,
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status              follower_status NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_user_id, scope, team_id, player_id)
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_highlight_reels_team   ON highlight_reels(team_id);
CREATE INDEX IF NOT EXISTS idx_highlight_reels_season ON highlight_reels(season_id);
CREATE INDEX IF NOT EXISTS idx_shares_content         ON shares(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_shares_audience        ON shares(audience);
CREATE INDEX IF NOT EXISTS idx_shares_target_player   ON shares(target_player_id);
CREATE INDEX IF NOT EXISTS idx_followers_team         ON followers(team_id);
CREATE INDEX IF NOT EXISTS idx_followers_player       ON followers(player_id);
CREATE INDEX IF NOT EXISTS idx_followers_user         ON followers(follower_user_id);

-- 6. RLS — allow_all placeholders, matching the existing tables
ALTER TABLE highlight_reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares          ENABLE ROW LEVEL SECURITY;
ALTER TABLE followers       ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'highlight_reels' AND policyname = 'allow_all_highlight_reels') THEN
    CREATE POLICY allow_all_highlight_reels ON highlight_reels FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shares' AND policyname = 'allow_all_shares') THEN
    CREATE POLICY allow_all_shares ON shares FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'followers' AND policyname = 'allow_all_followers') THEN
    CREATE POLICY allow_all_followers ON followers FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;

-- 7. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
