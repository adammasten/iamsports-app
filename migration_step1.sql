-- ============================================================
-- V3 Schema migration — Step 1 of 4: schema only
-- WIPE AND REBUILD. RLS allow_all preserved. Existing data is test data.
-- ============================================================

BEGIN;

-- 1. DROP existing tables (children first, CASCADE catches any stragglers)
DROP TABLE IF EXISTS clip_tags    CASCADE;
DROP TABLE IF EXISTS clips        CASCADE;
DROP TABLE IF EXISTS videos       CASCADE;
DROP TABLE IF EXISTS games        CASCADE;
DROP TABLE IF EXISTS tags         CASCADE;
DROP TABLE IF EXISTS teams        CASCADE;
DROP TABLE IF EXISTS profiles     CASCADE;

-- 2. Enums
DROP TYPE IF EXISTS membership_role    CASCADE;
DROP TYPE IF EXISTS membership_status  CASCADE;
DROP TYPE IF EXISTS content_visibility CASCADE;
DROP TYPE IF EXISTS tag_scope          CASCADE;

CREATE TYPE membership_role    AS ENUM ('admin', 'head_coach', 'coach', 'parent', 'player', 'follower');
CREATE TYPE membership_status  AS ENUM ('pending', 'confirmed');
CREATE TYPE content_visibility AS ENUM ('coaches_only', 'team', 'public_link', 'private_to_creator');
CREATE TYPE tag_scope          AS ENUM ('global', 'team');

-- 3. Tables (parents before children)

CREATE TABLE teams (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  sport               text NOT NULL,
  created_by_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_teams_created_by ON teams(created_by_user_id);

CREATE TABLE team_memberships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                membership_role NOT NULL,
  status              membership_status NOT NULL DEFAULT 'confirmed',
  invited_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id, role)
);
CREATE INDEX idx_memberships_team ON team_memberships(team_id);
CREATE INDEX idx_memberships_user ON team_memberships(user_id);

CREATE TABLE players (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name            text NOT NULL,
  jersey_number   text,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_players_team ON players(team_id);
CREATE INDEX idx_players_user ON players(user_id);

CREATE TABLE parent_player_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  relationship    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, player_id)
);
CREATE INDEX idx_parent_player_parent ON parent_player_links(parent_user_id);
CREATE INDEX idx_parent_player_player ON parent_player_links(player_id);

CREATE TABLE games (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_games_team ON games(team_id);

-- videos.team_id and videos.game_id are BOTH NULLABLE to support personal
-- parent uploads not tied to a team or a specific team-game. CASCADE still
-- cleans up game/team-attached videos when their parent row is deleted;
-- personal uploads (both NULL) are untouched.
CREATE TABLE videos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id               uuid REFERENCES games(id) ON DELETE CASCADE,
  team_id               uuid REFERENCES teams(id) ON DELETE CASCADE,
  uploaded_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  url                   text NOT NULL,
  label                 text NOT NULL,
  sort_order            int  NOT NULL DEFAULT 0,
  visibility            content_visibility NOT NULL DEFAULT 'team',
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_videos_game        ON videos(game_id);
CREATE INDEX idx_videos_team        ON videos(team_id);
CREATE INDEX idx_videos_uploaded_by ON videos(uploaded_by_user_id);

-- clips.team_id NULLABLE for parity with videos.team_id: a clip cut from a
-- personal upload has no team.
CREATE TABLE clips (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id              uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  team_id               uuid REFERENCES teams(id) ON DELETE CASCADE,
  created_by_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_time            numeric NOT NULL,
  end_time              numeric NOT NULL,
  is_starred            boolean NOT NULL DEFAULT false,
  is_point_of_emphasis  boolean NOT NULL DEFAULT false,
  note                  text    NOT NULL DEFAULT '',
  visibility            content_visibility NOT NULL DEFAULT 'team',
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clips_video        ON clips(video_id);
CREATE INDEX idx_clips_team         ON clips(team_id);
CREATE INDEX idx_clips_created_by   ON clips(created_by_user_id);

CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('offense', 'defense', 'plays', 'players')),
  sort_order  int  NOT NULL DEFAULT 0,
  scope       tag_scope NOT NULL DEFAULT 'team',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'global' AND team_id IS NULL) OR (scope = 'team' AND team_id IS NOT NULL))
);
CREATE INDEX idx_tags_team ON tags(team_id);

CREATE TABLE clip_tags (
  clip_id        uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  bundle_number  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (clip_id, tag_id, bundle_number)
);
CREATE INDEX idx_clip_tags_tag ON clip_tags(tag_id);

CREATE TABLE game_lineups (
  game_id           uuid NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  player_id         uuid NOT NULL REFERENCES players(id)  ON DELETE CASCADE,
  added_by_user_id  uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX idx_game_lineups_player ON game_lineups(player_id);

-- 4. RLS — allow_all preserved per locked decision (Step 3 replaces these)
ALTER TABLE teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE players              ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_player_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE games                ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE clips                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_lineups         ENABLE ROW LEVEL SECURITY;

CREATE POLICY allow_all_teams           ON teams                FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_memberships     ON team_memberships     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_players         ON players              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_parent_player   ON parent_player_links  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_games           ON games                FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_videos          ON videos               FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_clips           ON clips                FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_tags            ON tags                 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_clip_tags       ON clip_tags            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all_game_lineups    ON game_lineups         FOR ALL USING (true) WITH CHECK (true);

COMMIT;

-- 5. Schema cache trap (CLAUDE.md) — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
