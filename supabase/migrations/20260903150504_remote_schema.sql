SET local check_function_bodies = off;

CREATE EXTENSION "pg_cron";

CREATE EXTENSION "pg_net" SCHEMA "public";

CREATE EXTENSION "pg_trgm" SCHEMA "public";

CREATE TABLE "public"."admin_audit_log" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id"  uuid,
  "action"         text                     NOT NULL,
  "target_user_id" uuid,
  "target_table"   text,
  "target_id"      uuid,
  "detail"         jsonb,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."admin_audit_log"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."clip_football" (
  "clip_id"       uuid                     NOT NULL,
  "odk"           text                     NOT NULL,
  "down"          smallint,
  "distance"      smallint,
  "yard_line"     smallint,
  "play_type"     text,
  "gap"           text,
  "off_formation" text,
  "def_front"     text,
  "result"        text,
  "gain_loss"     smallint,
  "drive_id"      integer,
  "opp_formation" text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "clip_football_distance_check" CHECK ((distance >= 0)),
  CONSTRAINT "clip_football_down_check" CHECK (((down >= 1) AND (down <= 4))),
  CONSTRAINT "clip_football_odk_check" CHECK ((odk = ANY (ARRAY['offense'::text, 'defense'::text, 'kicking'::text]))),
  CONSTRAINT "clip_football_pkey" PRIMARY KEY (clip_id),
  CONSTRAINT "clip_football_yard_line_check" CHECK (((yard_line >= 1) AND (yard_line <= 99)))
);

ALTER TABLE "public"."clip_football"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."clip_tags" (
  "clip_id"       uuid    NOT NULL,
  "tag_id"        uuid    NOT NULL,
  "bundle_number" integer NOT NULL DEFAULT 0,
  "stat_side"     text    NOT NULL DEFAULT 'us'::text,
  CONSTRAINT "clip_tags_pkey" PRIMARY KEY (clip_id, tag_id, bundle_number),
  CONSTRAINT "clip_tags_stat_side_check" CHECK ((stat_side = ANY (ARRAY['us'::text, 'them'::text])))
);

ALTER TABLE "public"."clip_tags"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."clips" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "video_id"             uuid                     NOT NULL,
  "team_id"              uuid,
  "created_by_user_id"   uuid,
  "start_time"           numeric                  NOT NULL,
  "end_time"             numeric                  NOT NULL,
  "is_starred"           boolean                  NOT NULL DEFAULT false,
  "is_point_of_emphasis" boolean                  NOT NULL DEFAULT false,
  "note"                 text                     NOT NULL DEFAULT ''::text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "period"               smallint,
  CONSTRAINT "clips_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."clips"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."content_reports" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "reporter_user_id" uuid                     NOT NULL,
  "content_type"     text                     NOT NULL,
  "content_id"       uuid                     NOT NULL,
  "share_id"         uuid,
  "reason"           text                     NOT NULL,
  "note"             text,
  "status"           text                     NOT NULL DEFAULT 'pending'::text,
  "reviewed_by"      uuid,
  "reviewed_at"      timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "content_reports_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."content_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."device_push_tokens" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "token"      text                     NOT NULL,
  "platform"   text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY (id),
  CONSTRAINT "device_push_tokens_token_key" UNIQUE (token)
);

ALTER TABLE "public"."device_push_tokens"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."event_attendance" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"          uuid                     NOT NULL,
  "player_id"         uuid                     NOT NULL,
  "responder_user_id" uuid,
  "rsvp_status"       text                     NOT NULL,
  "note"              text,
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "event_attendance_event_id_player_id_key" UNIQUE (event_id, player_id),
  CONSTRAINT "event_attendance_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_attendance_rsvp_status_check" CHECK ((rsvp_status = ANY (ARRAY['going'::text, 'maybe'::text, 'out'::text])))
);

ALTER TABLE "public"."event_attendance"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."event_snack_signups" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"           uuid                     NOT NULL,
  "team_id"            uuid                     NOT NULL,
  "claimed_by_user_id" uuid                     NOT NULL,
  "player_id"          uuid,
  "note"               text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "event_snack_signups_event_id_key" UNIQUE (event_id),
  CONSTRAINT "event_snack_signups_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."event_snack_signups"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."events" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"        uuid                     NOT NULL,
  "season_id"      uuid,
  "tournament_id"  uuid,
  "series_id"      uuid,
  "event_type"     text                     NOT NULL,
  "title"          text,
  "local_date"     date                     NOT NULL,
  "starts_at"      timestamp with time zone,
  "ends_at"        timestamp with time zone,
  "arrival_at"     timestamp with time zone,
  "event_timezone" text                     NOT NULL DEFAULT 'America/Chicago'::text,
  "time_status"    text                     NOT NULL DEFAULT 'confirmed'::text,
  "home_away"      text,
  "venue_name"     text,
  "venue_address"  text,
  "status"         text                     NOT NULL DEFAULT 'scheduled'::text,
  "uniform"        text,
  "notes"          text,
  "created_by"     uuid,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "version"        integer                  NOT NULL DEFAULT 1,
  "snacks_enabled" boolean                  NOT NULL DEFAULT true,
  "deleted_at"     timestamp with time zone,
  CONSTRAINT "events_event_type_check" CHECK ((event_type = ANY (ARRAY['game'::text, 'scrimmage'::text, 'practice'::text, 'tournament_game'::text, 'team_event'::text]))),
  CONSTRAINT "events_home_away_check" CHECK ((home_away = ANY (ARRAY['home'::text, 'away'::text]))),
  CONSTRAINT "events_pkey" PRIMARY KEY (id),
  CONSTRAINT "events_status_check" CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'canceled'::text, 'postponed'::text]))),
  CONSTRAINT "events_time_status_check" CHECK ((time_status = ANY (ARRAY['confirmed'::text, 'tbd'::text, 'all_day'::text])))
);

ALTER TABLE "public"."events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."followers" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "follower_user_id"    uuid                     NOT NULL,
  "team_id"             uuid,
  "player_id"           uuid,
  "approved_by_user_id" uuid,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "followers_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."followers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."game_lineups" (
  "game_id"          uuid                     NOT NULL,
  "player_id"        uuid                     NOT NULL,
  "added_by_user_id" uuid,
  "added_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "game_lineups_pkey" PRIMARY KEY (game_id, player_id)
);

ALTER TABLE "public"."game_lineups"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."game_stat_lines" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"            uuid                     NOT NULL,
  "player_id"          uuid,
  "stat_side"          text                     NOT NULL DEFAULT 'own'::text,
  "fgm"                integer                  NOT NULL DEFAULT 0,
  "fga"                integer                  NOT NULL DEFAULT 0,
  "fg3m"               integer                  NOT NULL DEFAULT 0,
  "fg3a"               integer                  NOT NULL DEFAULT 0,
  "ftm"                integer                  NOT NULL DEFAULT 0,
  "fta"                integer                  NOT NULL DEFAULT 0,
  "oreb"               integer                  NOT NULL DEFAULT 0,
  "dreb"               integer                  NOT NULL DEFAULT 0,
  "ast"                integer                  NOT NULL DEFAULT 0,
  "tov"                integer                  NOT NULL DEFAULT 0,
  "stl"                integer                  NOT NULL DEFAULT 0,
  "blk"                integer                  NOT NULL DEFAULT 0,
  "pf"                 integer                  NOT NULL DEFAULT 0,
  "tf"                 integer                  NOT NULL DEFAULT 0,
  "created_by_user_id" uuid,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "game_stat_lines_ast_check" CHECK ((ast >= 0)),
  CONSTRAINT "game_stat_lines_blk_check" CHECK ((blk >= 0)),
  CONSTRAINT "game_stat_lines_check1" CHECK ((fg3m <= fg3a)),
  CONSTRAINT "game_stat_lines_check2" CHECK ((fg3m <= fgm)),
  CONSTRAINT "game_stat_lines_check3" CHECK ((fg3a <= fga)),
  CONSTRAINT "game_stat_lines_check4" CHECK ((ftm <= fta)),
  CONSTRAINT "game_stat_lines_check" CHECK ((fgm <= fga)),
  CONSTRAINT "game_stat_lines_dreb_check" CHECK ((dreb >= 0)),
  CONSTRAINT "game_stat_lines_fg3a_check" CHECK ((fg3a >= 0)),
  CONSTRAINT "game_stat_lines_fg3m_check" CHECK ((fg3m >= 0)),
  CONSTRAINT "game_stat_lines_fga_check" CHECK ((fga >= 0)),
  CONSTRAINT "game_stat_lines_fgm_check" CHECK ((fgm >= 0)),
  CONSTRAINT "game_stat_lines_fta_check" CHECK ((fta >= 0)),
  CONSTRAINT "game_stat_lines_ftm_check" CHECK ((ftm >= 0)),
  CONSTRAINT "game_stat_lines_oreb_check" CHECK ((oreb >= 0)),
  CONSTRAINT "game_stat_lines_pf_check" CHECK ((pf >= 0)),
  CONSTRAINT "game_stat_lines_pkey" PRIMARY KEY (id),
  CONSTRAINT "game_stat_lines_stat_side_check" CHECK ((stat_side = ANY (ARRAY['own'::text, 'opponent'::text]))),
  CONSTRAINT "game_stat_lines_stl_check" CHECK ((stl >= 0)),
  CONSTRAINT "game_stat_lines_tf_check" CHECK ((tf >= 0)),
  CONSTRAINT "game_stat_lines_tov_check" CHECK ((tov >= 0))
);

ALTER TABLE "public"."game_stat_lines"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."games" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"        uuid                     NOT NULL,
  "title"          text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "game_date"      date,
  "opponent"       text,
  "season_id"      uuid,
  "tournament_id"  uuid,
  "team_score"     integer,
  "opponent_score" integer,
  "period_count"   smallint,
  "period_label"   text,
  "deleted_at"     timestamp with time zone,
  "event_id"       uuid,
  CONSTRAINT "games_event_id_key" UNIQUE (event_id),
  CONSTRAINT "games_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."games"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."highlight_reels" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"            uuid,
  "season_id"          uuid,
  "created_by_user_id" uuid,
  "name"               text                     NOT NULL,
  "storage_path"       text,
  "source_clip_ids"    uuid[],
  "duration_seconds"   numeric,
  "overlay_mode"       text                     NOT NULL DEFAULT 'clean'::text,
  "public_share_token" text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "thumbnail_path"     text,
  "deleted_at"         timestamp with time zone,
  CONSTRAINT "highlight_reels_pkey" PRIMARY KEY (id),
  CONSTRAINT "highlight_reels_public_share_token_key" UNIQUE (public_share_token)
);

ALTER TABLE "public"."highlight_reels"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."install_plays" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "install_id"   uuid                     NOT NULL,
  "play_id"      uuid                     NOT NULL,
  "play_version" integer                  NOT NULL,
  "sort_order"   integer                  NOT NULL DEFAULT 0,
  "note"         text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "install_plays_install_id_play_id_play_version_key" UNIQUE (install_id, play_id, play_version),
  CONSTRAINT "install_plays_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."install_plays"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."install_receipts" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "install_id" uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "play_id"    uuid,
  "event_type" text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "install_receipts_event_type_check" CHECK ((event_type = ANY (ARRAY['install_viewed'::text, 'play_opened'::text, 'video_viewed'::text, 'install_completed'::text]))),
  CONSTRAINT "install_receipts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."install_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."installs" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"      uuid                     NOT NULL,
  "title"        text                     NOT NULL,
  "note"         text,
  "status"       text                     NOT NULL DEFAULT 'draft'::text,
  "scheduled_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_by"   uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "installs_pkey" PRIMARY KEY (id),
  CONSTRAINT "installs_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
);

ALTER TABLE "public"."installs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."library_plays" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id"  uuid                     NOT NULL,
  "sport"          text                     NOT NULL,
  "name"           text                     NOT NULL,
  "doc"            jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "schema_version" integer                  NOT NULL DEFAULT 1,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "tags"           text[]                   NOT NULL DEFAULT '{}'::text[],
  "side"           text                     NOT NULL DEFAULT 'offense'::text,
  "visibility"     text                     NOT NULL DEFAULT 'private'::text,
  "save_count"     integer                  NOT NULL DEFAULT 0,
  "curated"        boolean                  NOT NULL DEFAULT false,
  CONSTRAINT "library_plays_pkey" PRIMARY KEY (id),
  CONSTRAINT "library_plays_side_chk" CHECK ((side = ANY (ARRAY['offense'::text, 'defense'::text, 'special_teams'::text]))),
  CONSTRAINT "library_plays_visibility_check" CHECK ((visibility = ANY (ARRAY['private'::text, 'community'::text])))
);

ALTER TABLE "public"."library_plays"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."messages" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"        uuid                     NOT NULL,
  "event_id"       uuid,
  "parent_id"      uuid,
  "author_user_id" uuid                     NOT NULL,
  "kind"           text                     NOT NULL DEFAULT 'chat'::text,
  "body"           text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "edited_at"      timestamp with time zone,
  "deleted_at"     timestamp with time zone,
  "deleted_by"     uuid,
  CONSTRAINT "messages_body_check" CHECK ((length(TRIM(BOTH FROM body)) > 0)),
  CONSTRAINT "messages_kind_check" CHECK ((kind = ANY (ARRAY['chat'::text, 'announcement'::text]))),
  CONSTRAINT "messages_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."messages"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."notification_outbox" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"       uuid,
  "team_id"        uuid                     NOT NULL,
  "change_kind"    text                     NOT NULL,
  "actor_user_id"  uuid,
  "event_version"  integer,
  "payload"        jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "dispatch_after" timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"   timestamp with time zone,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "message_id"     uuid,
  "source"         text                     NOT NULL DEFAULT 'event'::text,
  "target_user_id" uuid,
  CONSTRAINT "notification_outbox_change_kind_check"
    CHECK ((change_kind = ANY (ARRAY['created'::text, 'time_changed'::text, 'venue_changed'::text, 'canceled'::text, 'completed'::text, 'custom'::text, 'snack_reminder'::text]))),
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."notification_outbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."notifications" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" uuid                     NOT NULL,
  "type"              text                     NOT NULL,
  "actor_user_id"     uuid,
  "target_player_id"  uuid,
  "team_id"           uuid,
  "entity_type"       text,
  "entity_id"         uuid,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "seen_at"           timestamp with time zone,
  "read_at"           timestamp with time zone,
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."parent_player_links" (
  "id"                        uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "parent_user_id"            uuid                     NOT NULL,
  "player_id"                 uuid                     NOT NULL,
  "relationship"              text,
  "created_at"                timestamp with time zone NOT NULL DEFAULT now(),
  "receives_logistics_alerts" boolean                  NOT NULL DEFAULT true,
  CONSTRAINT "parent_player_links_parent_user_id_player_id_key" UNIQUE (parent_user_id, player_id),
  CONSTRAINT "parent_player_links_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."parent_player_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."phone_verifications" (
  "user_id"    uuid                     NOT NULL,
  "phone"      text                     NOT NULL,
  "code_hash"  text                     NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts"   integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "phone_verifications_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."phone_verifications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."play_clips" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "play_id"      uuid                     NOT NULL,
  "play_version" integer                  NOT NULL,
  "clip_id"      uuid                     NOT NULL,
  "team_id"      uuid                     NOT NULL,
  "link_type"    text                     NOT NULL,
  "created_by"   uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "play_clips_link_type_check" CHECK ((link_type = ANY (ARRAY['exemplar'::text, 'execution'::text, 'mistake'::text]))),
  CONSTRAINT "play_clips_pkey" PRIMARY KEY (id),
  CONSTRAINT "play_clips_play_id_play_version_clip_id_key" UNIQUE (play_id, play_version, clip_id)
);

ALTER TABLE "public"."play_clips"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."play_versions" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "play_id"    uuid                     NOT NULL,
  "version"    integer                  NOT NULL,
  "doc"        jsonb                    NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "play_versions_pkey" PRIMARY KEY (id),
  CONSTRAINT "play_versions_play_id_version_key" UNIQUE (play_id, VERSION)
);

ALTER TABLE "public"."play_versions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."player_guardian_codes" (
  "player_id"    uuid                     NOT NULL,
  "code"         text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone,
  CONSTRAINT "player_guardian_codes_code_key" UNIQUE (code),
  CONSTRAINT "player_guardian_codes_pkey" PRIMARY KEY (player_id)
);

ALTER TABLE "public"."player_guardian_codes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."player_guardian_seats" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "player_id"          uuid                     NOT NULL,
  "granted_to_user_id" uuid                     NOT NULL,
  "source"             text                     NOT NULL,
  "external_txn_id"    text,
  "granted_by_user_id" uuid,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at"         timestamp with time zone,
  CONSTRAINT "player_guardian_seats_pkey" PRIMARY KEY (id),
  CONSTRAINT "player_guardian_seats_source_check" CHECK ((source = ANY (ARRAY['purchase'::text, 'comp'::text])))
);

ALTER TABLE "public"."player_guardian_seats"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."player_teams" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "player_id"        uuid                     NOT NULL,
  "team_id"          uuid                     NOT NULL,
  "jersey_number"    text,
  "added_by_user_id" uuid,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "left_at"          timestamp with time zone,
  CONSTRAINT "player_teams_pkey" PRIMARY KEY (id),
  CONSTRAINT "player_teams_player_id_team_id_key" UNIQUE (player_id, team_id)
);

ALTER TABLE "public"."player_teams"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."players" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"           uuid,
  "name"              text                     NOT NULL,
  "jersey_number"     text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "season_id"         uuid,
  "player_lineage_id" uuid,
  "grad_class"        text,
  "photo_path"        text,
  CONSTRAINT "players_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."players"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."plays" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"         uuid                     NOT NULL,
  "library_play_id" uuid,
  "sport"           text                     NOT NULL,
  "name"            text                     NOT NULL,
  "doc"             jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "latest_version"  integer                  NOT NULL DEFAULT 0,
  "created_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "tags"            text[]                   NOT NULL DEFAULT '{}'::text[],
  "side"            text                     NOT NULL DEFAULT 'offense'::text,
  CONSTRAINT "plays_pkey" PRIMARY KEY (id),
  CONSTRAINT "plays_side_chk" CHECK ((side = ANY (ARRAY['offense'::text, 'defense'::text, 'special_teams'::text])))
);

ALTER TABLE "public"."plays"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reel_tags" (
  "reel_id" uuid NOT NULL,
  "tag_id"  uuid NOT NULL,
  CONSTRAINT "reel_tags_pkey" PRIMARY KEY (reel_id, tag_id)
);

ALTER TABLE "public"."reel_tags"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."saved_items" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "share_id"   uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "saved_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "saved_items_user_id_share_id_key" UNIQUE (user_id, share_id)
);

ALTER TABLE "public"."saved_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."schedule_import_log" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_import_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."schedule_import_log"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."schedule_notifications" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"            uuid,
  "team_id"             uuid,
  "recipient_user_id"   uuid                     NOT NULL,
  "channel"             text                     NOT NULL,
  "change_kind"         text                     NOT NULL,
  "dedupe_key"          text                     NOT NULL,
  "status"              text                     NOT NULL DEFAULT 'queued'::text,
  "send_after"          timestamp with time zone NOT NULL DEFAULT now(),
  "title"               text,
  "body"                text,
  "data"                jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "provider_message_id" text,
  "error_code"          text,
  "sent_at"             timestamp with time zone,
  "status_updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_notifications_channel_check" CHECK ((channel = ANY (ARRAY['push'::text, 'sms'::text, 'wall'::text]))),
  CONSTRAINT "schedule_notifications_dedupe_key_key" UNIQUE (dedupe_key),
  CONSTRAINT "schedule_notifications_pkey" PRIMARY KEY (id),
  CONSTRAINT "schedule_notifications_status_check"
    CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'opted_out'::text, 'skipped'::text])))
);

ALTER TABLE "public"."schedule_notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."seasons" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"            uuid                     NOT NULL,
  "name"               text                     NOT NULL,
  "starts_on"          date,
  "ends_on"            date,
  "created_by_user_id" uuid,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "seasons_pkey" PRIMARY KEY (id),
  CONSTRAINT "seasons_team_id_name_key" UNIQUE (team_id, name)
);

ALTER TABLE "public"."seasons"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."share_comments" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "share_id"       uuid                     NOT NULL,
  "author_user_id" uuid                     NOT NULL,
  "body"           text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "share_comments_body_check" CHECK (((length(TRIM(BOTH FROM body)) > 0) AND (length(body) <= 2000))),
  CONSTRAINT "share_comments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."share_comments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."shares" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "content_id"        uuid                     NOT NULL,
  "team_id"           uuid,
  "season_id"         uuid,
  "target_player_id"  uuid,
  "shared_by_user_id" uuid,
  "hidden_by_family"  boolean                  NOT NULL DEFAULT false,
  "visible"           boolean                  NOT NULL DEFAULT true,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "note"              text,
  "on_wall"           boolean                  NOT NULL DEFAULT false,
  CONSTRAINT "shares_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."shares"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sms_opt_outs" (
  "phone_number"     text                     NOT NULL,
  "opted_out_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "opted_back_in_at" timestamp with time zone,
  CONSTRAINT "sms_opt_outs_pkey" PRIMARY KEY (phone_number)
);

ALTER TABLE "public"."sms_opt_outs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."super_admins" (
  "user_id"           uuid                     NOT NULL,
  "granted_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "note"              text,
  "acting_as_user_id" uuid,
  CONSTRAINT "super_admins_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."super_admins"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tagger_links" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id"  uuid                     NOT NULL,
  "tagger_user_id" uuid                     NOT NULL,
  "label"          text,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tagger_links_check" CHECK ((owner_user_id <> tagger_user_id)),
  CONSTRAINT "tagger_links_owner_user_id_tagger_user_id_key" UNIQUE (owner_user_id, tagger_user_id),
  CONSTRAINT "tagger_links_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."tagger_links"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tagging_job_messages" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "job_id"         uuid                     NOT NULL,
  "author_user_id" uuid                     NOT NULL,
  "body"           text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tagging_job_messages_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."tagging_job_messages"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tagging_jobs" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"             uuid                     NOT NULL,
  "team_id"             uuid                     NOT NULL,
  "requester_user_id"   uuid                     NOT NULL,
  "tagger_user_id"      uuid,
  "template_id"         uuid,
  "instructions"        text,
  "due_at"              timestamp with time zone,
  "requested_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "tagger_completed_at" timestamp with time zone,
  "finalized_at"        timestamp with time zone,
  "released_at"         timestamp with time zone,
  "revisions"           integer                  NOT NULL DEFAULT 0,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tagging_jobs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."tagging_jobs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tags" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"        uuid,
  "name"           text                     NOT NULL,
  "category"       text                     NOT NULL,
  "sort_order"     integer                  NOT NULL DEFAULT 0,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "stat_primitive" text,
  "stat_side"      text                     DEFAULT 'own'::text,
  "player_id"      uuid,
  "stat_made"      boolean,
  "stat_value"     integer,
  "stat_detail"    text,
  "sport"          text,
  "tag_polarity"   text                     NOT NULL DEFAULT 'neutral'::text,
  CONSTRAINT "tags_category_check"
    CHECK ((category = ANY (ARRAY['offense'::text, 'defense'::text, 'plays'::text, 'players'::text, 'special'::text, 'opponent'::text, 'period'::text]))),
  CONSTRAINT "tags_pkey" PRIMARY KEY (id),
  CONSTRAINT "tags_stat_detail_check"
    CHECK (((stat_detail IS NULL) OR (stat_detail = ANY (ARRAY['off'::text, 'def'::text, 'personal'::text, 'technical'::text, 'offensive'::text])))),
  CONSTRAINT "tags_stat_primitive_check"
    CHECK
    (((stat_primitive IS NULL) OR (stat_primitive = ANY (ARRAY['shot'::text, 'rebound'::text, 'assist'::text, 'steal'::text, 'block'::text, 'turnover'::text, 'foul'::text])))),
  CONSTRAINT "tags_stat_side_check" CHECK ((stat_side = ANY (ARRAY['own'::text, 'opponent'::text]))),
  CONSTRAINT "tags_tag_polarity_check" CHECK ((tag_polarity = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text])))
);

ALTER TABLE "public"."tags"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_hidden_tags" (
  "team_id"    uuid                     NOT NULL,
  "tag_id"     uuid                     NOT NULL,
  "hidden_by"  uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "team_hidden_tags_pkey" PRIMARY KEY (team_id, tag_id)
);

ALTER TABLE "public"."team_hidden_tags"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_member_permissions" (
  "team_id"            uuid                     NOT NULL,
  "user_id"            uuid                     NOT NULL,
  "allowed"            boolean                  NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "public"."team_member_permissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_memberships" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"            uuid                     NOT NULL,
  "user_id"            uuid                     NOT NULL,
  "invited_by_user_id" uuid,
  "joined_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "season_id"          uuid,
  CONSTRAINT "team_memberships_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."team_memberships"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_permission_defaults" (
  "team_id"            uuid                     NOT NULL,
  "allowed"            boolean                  NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "public"."team_permission_defaults"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_player_permissions" (
  "team_id"            uuid                     NOT NULL,
  "player_id"          uuid                     NOT NULL,
  "allowed"            boolean                  NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "public"."team_player_permissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."teams" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"                     text                     NOT NULL,
  "sport"                    text                     NOT NULL,
  "created_by_user_id"       uuid                     NOT NULL,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "grad_class"               text,
  "join_code"                text,
  "logo_path"                text,
  "require_coaches_pin"      boolean                  NOT NULL DEFAULT false,
  "coach_code"               text,
  "ics_token"                text                     DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text),
  "accent_color"             text,
  "snacks_enabled_games"     boolean                  NOT NULL DEFAULT true,
  "snacks_enabled_practices" boolean                  NOT NULL DEFAULT false,
  "parent_film_visible"      boolean                  NOT NULL DEFAULT true,
  CONSTRAINT "teams_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."teams"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tournaments" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "team_id"            uuid                     NOT NULL,
  "name"               text                     NOT NULL,
  "created_by_user_id" uuid,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tournaments_pkey" PRIMARY KEY (id),
  CONSTRAINT "tournaments_team_id_name_key" UNIQUE (team_id, name)
);

ALTER TABLE "public"."tournaments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."user_blocks" (
  "blocker_user_id" uuid                     NOT NULL,
  "blocked_user_id" uuid                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_blocks_pkey" PRIMARY KEY (blocker_user_id, blocked_user_id)
);

ALTER TABLE "public"."user_blocks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."user_profiles" (
  "user_id"                uuid                     NOT NULL,
  "display_name"           text,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "accepted_terms_at"      timestamp with time zone,
  "accepted_terms_version" integer,
  "deactivated_at"         timestamp with time zone,
  "coaches_pin_hash"       text,
  "timezone"               text,
  "phone_number"           text,
  "phone_verified_at"      timestamp with time zone,
  "phone_consent_at"       timestamp with time zone,
  "phone_consent_source"   text,
  "tagger_code"            text,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "user_profiles_tagger_code_key" UNIQUE (tagger_code)
);

ALTER TABLE "public"."user_profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."video_tagging_rights" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "video_id"           uuid                     NOT NULL,
  "granted_to_user_id" uuid                     NOT NULL,
  "granted_by_user_id" uuid,
  "can_tag"            boolean                  NOT NULL DEFAULT true,
  "names_hidden"       boolean                  NOT NULL DEFAULT false,
  "expires_at"         timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "video_tagging_rights_pkey" PRIMARY KEY (id),
  CONSTRAINT "video_tagging_rights_video_id_granted_to_user_id_key" UNIQUE (video_id, granted_to_user_id)
);

ALTER TABLE "public"."video_tagging_rights"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."videos" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"             uuid,
  "team_id"             uuid,
  "uploaded_by_user_id" uuid,
  "url"                 text                     NOT NULL,
  "label"               text                     NOT NULL,
  "sort_order"          integer                  NOT NULL DEFAULT 0,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "season_id"           uuid,
  "player_id"           uuid,
  "event_type"          text,
  "event_date"          date,
  "sport"               text,
  "tagging_complete"    boolean                  DEFAULT false,
  "upload_bytes"        bigint,
  "original_url"        text,
  "thumbnail_path"      text,
  "deleted_at"          timestamp with time zone,
  CONSTRAINT "videos_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."videos"
  ENABLE ROW LEVEL SECURITY;

CREATE TYPE "public"."content_visibility" AS ENUM (
  'coaches_only',
  'team',
  'public_link',
  'private_to_creator'
);

ALTER TABLE "public"."clips"
  ADD COLUMN "visibility" public.content_visibility NOT NULL DEFAULT 'team'::public.content_visibility;

ALTER TABLE "public"."videos"
  ADD COLUMN "visibility" public.content_visibility NOT NULL DEFAULT 'team'::public.content_visibility;

CREATE TYPE "public"."follower_scope" AS ENUM (
  'team',
  'player'
);

ALTER TABLE "public"."followers"
  ADD COLUMN "scope" public.follower_scope NOT NULL;

CREATE TYPE "public"."follower_status" AS ENUM (
  'pending',
  'approved',
  'revoked'
);

ALTER TABLE "public"."followers"
  ADD COLUMN "status" public.follower_status NOT NULL DEFAULT 'pending'::public.follower_status;

CREATE TYPE "public"."grant_status" AS ENUM (
  'active',
  'revoked',
  'expired'
);

ALTER TABLE "public"."video_tagging_rights"
  ADD COLUMN "status" public.grant_status NOT NULL DEFAULT 'active'::public.grant_status;

CREATE TYPE "public"."membership_role" AS ENUM (
  'admin',
  'head_coach',
  'coach',
  'parent',
  'player',
  'follower'
);

ALTER TABLE "public"."team_memberships"
  ADD COLUMN "role" public.membership_role NOT NULL;

CREATE TYPE "public"."membership_status" AS ENUM (
  'pending',
  'confirmed'
);

ALTER TABLE "public"."team_memberships"
  ADD COLUMN "status" public.membership_status NOT NULL DEFAULT 'confirmed'::public.membership_status;

CREATE TYPE "public"."reel_status" AS ENUM (
  'rendering',
  'ready',
  'failed'
);

ALTER TABLE "public"."highlight_reels"
  ADD COLUMN "status" public.reel_status NOT NULL DEFAULT 'rendering'::public.reel_status;

CREATE TYPE "public"."season_status" AS ENUM (
  'active',
  'archived'
);

ALTER TABLE "public"."seasons"
  ADD COLUMN "status" public.season_status NOT NULL DEFAULT 'active'::public.season_status;

CREATE TYPE "public"."share_audience" AS ENUM (
  'public',
  'team',
  'player',
  'coaches'
);

ALTER TABLE "public"."shares"
  ADD COLUMN "audience" public.share_audience NOT NULL;

CREATE TYPE "public"."share_content" AS ENUM (
  'reel',
  'video',
  'clip',
  'game'
);

ALTER TABLE "public"."shares"
  ADD COLUMN "content_type" public.share_content NOT NULL;

CREATE TYPE "public"."tag_scope" AS ENUM (
  'global',
  'team'
);

ALTER TABLE "public"."tags"
  ADD COLUMN "scope" public.tag_scope NOT NULL DEFAULT 'team'::public.tag_scope;

CREATE TYPE "public"."tagging_job_status" AS ENUM (
  'new',
  'in_progress',
  'review',
  'changes_requested',
  'complete',
  'canceled',
  'declined'
);

ALTER TABLE "public"."tagging_jobs"
  ADD COLUMN "status" public.tagging_job_status NOT NULL DEFAULT 'new'::public.tagging_job_status;

CREATE TYPE "public"."team_permission" AS ENUM (
  'post_wall',
  'upload_video',
  'tag_videos',
  'send_to_team',
  'create_games',
  'build_reels',
  'delete_content',
  'manage_roster'
);

ALTER TABLE "public"."team_member_permissions"
  ADD COLUMN "permission" public.team_permission NOT NULL;

ALTER TABLE "public"."team_permission_defaults"
  ADD COLUMN "permission" public.team_permission NOT NULL;

ALTER TABLE "public"."team_player_permissions"
  ADD COLUMN "permission" public.team_permission NOT NULL;

CREATE TYPE "public"."upload_status" AS ENUM (
  'uploading',
  'ready',
  'failed'
);

ALTER TABLE "public"."videos"
  ADD COLUMN "upload_status" public.upload_status NOT NULL DEFAULT 'ready'::public.upload_status;

CREATE OR REPLACE FUNCTION public._revoke_job_grants (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare j tagging_jobs;
begin
  select * into j from tagging_jobs where id = p_job;
  if not found then return; end if;
  update video_tagging_rights r set status = 'revoked'
   where r.granted_to_user_id = j.tagger_user_id
     and r.status = 'active'
     and r.video_id in (select id from videos where game_id = j.game_id);
end $function$;

CREATE OR REPLACE FUNCTION public.accept_terms (
  p_version integer
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  insert into user_profiles (user_id, accepted_terms_at, accepted_terms_version, updated_at)
  values (auth.uid(), now(), p_version, now())
  on conflict (user_id) do update
    set accepted_terms_at = now(), accepted_terms_version = excluded.accepted_terms_version, updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.am_i_super_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select is_super_admin();
$function$;

CREATE OR REPLACE FUNCTION public.assign_team_accent()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare palette text[] := array[
  '#6C63FF','#2FB380','#3B9EDB','#E0A52E','#E2574A','#A468E0',
  '#2BB3A3','#FF6A2C','#E86AA6','#86C34A','#5B8DEF','#C9A227'];
begin
  if new.accent_color is null then
    new.accent_color := palette[(abs(hashtext(new.id::text)) % array_length(palette,1)) + 1];
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.assign_team_coach (
  p_team_id uuid,
  p_user_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or exists (
    select 1 from team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach') and tm.status = 'confirmed'
  )) then
    raise exception 'not authorized';
  end if;
  insert into team_memberships (team_id, user_id, role, status)
    values (p_team_id, p_user_id, 'coach', 'confirmed')
    on conflict (team_id, user_id, role) do update set status = 'confirmed';
end $function$;

CREATE OR REPLACE FUNCTION public.attach_kid_to_team (
  p_player_id     uuid,
  p_team_id       uuid,
  p_jersey_number text DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); new_id uuid; was_new boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_super_admin() and not is_team_coach(p_team_id) then
    raise exception 'Only a coach or admin of this team can add players';
  end if;
  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (p_player_id, p_team_id, nullif(trim(coalesce(p_jersey_number, '')), ''), uid)
  on conflict (player_id, team_id) do update
    set jersey_number = excluded.jersey_number, left_at = null
  returning id, (xmax = 0) into new_id, was_new;
  update tags tg set name = case when split_part(p.name, ' ', 1) like '#%'
    then split_part(p.name, ' ', 1)
    else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(p_jersey_number), ''), '') end
  from players p
  where tg.player_id = p_player_id and tg.team_id = p_team_id and tg.category = 'players' and p.id = p_player_id;
  if was_new then
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_player_id),
      'kid_added_to_team', uid, p_player_id, p_team_id, 'team', p_team_id
    );
  end if;
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.authorize_photo_view (
  p_player_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  p   players%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into p from players where id = p_player_id;
  if not found then
    raise exception 'Player not found';
  end if;
  if p.photo_path is null then
    raise exception 'No photo set';
  end if;

  -- Doors 1-3: super admin / linked parent / member of a team the kid is on.
  if is_super_admin()
     or exists (
          select 1 from parent_player_links ppl
          where ppl.player_id = p_player_id
            and ppl.parent_user_id = uid)
     or exists (
          select 1 from player_teams pt
          where pt.player_id = p_player_id
            and is_team_member(pt.team_id))
  then
    return p.photo_path;
  end if;

  -- Door 4 (VIEWER SEAM): friends-and-family — stubbed false until player_viewers ships.
  if false then
    return p.photo_path;
  end if;

  raise exception 'Not allowed to view this photo';
end;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_reel_playback (
  p_reel_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); r highlight_reels%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if r.storage_path is null then raise exception 'Reel has no file yet'; end if;
  if r.deleted_at is not null then raise exception 'This reel was deleted'; end if;
  if is_super_admin() or r.created_by_user_id = uid or is_team_coach(r.team_id) then return r.storage_path; end if;
  if exists (select 1 from shares s
       where s.content_type = 'reel' and s.content_id = r.id
         and ( is_super_admin() or s.shared_by_user_id = uid
            or (s.audience='team'    and is_team_member(s.team_id))
            or (s.audience='coaches' and is_team_coach(s.team_id))
            or (s.audience='player'  and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid)))
     ) then return r.storage_path; end if;
  raise exception 'Not allowed to view this reel';
end $function$;

CREATE OR REPLACE FUNCTION public.authorize_team_logo_view (
  p_team_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare lp text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select logo_path into lp from teams where id = p_team_id;
  if lp is null then raise exception 'No logo set'; end if;
  if is_super_admin()
     or is_team_member(p_team_id)
     or exists (select 1 from player_teams pt
                where pt.team_id = p_team_id and is_linked_parent(pt.player_id))
  then
    return lp;
  end if;
  raise exception 'Not allowed to view this logo';
end $function$;

CREATE OR REPLACE FUNCTION public.authorize_video_playback (
  p_video_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); v videos%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if v.deleted_at is not null then raise exception 'This video was deleted'; end if;
  if is_super_admin()
     or v.uploaded_by_user_id = uid
     or (v.visibility in ('team','public_link') and is_team_member(v.team_id))
     or (v.visibility = 'coaches_only'          and is_team_coach(v.team_id))
  then return v.url; end if;
  -- Tagger with an active grant on this video.
  if can_tag_video(p_video_id) then return v.url; end if;
  if v.player_id is not null and exists (select 1 from parent_player_links ppl
       where ppl.player_id = v.player_id and ppl.parent_user_id = uid) then return v.url; end if;
  if v.game_id is not null and exists (select 1 from game_lineups gl
       join parent_player_links ppl on ppl.player_id = gl.player_id
       where gl.game_id = v.game_id and ppl.parent_user_id = uid) then return v.url; end if;
  if exists (select 1 from shares s
       where ( (s.content_type = 'video' and s.content_id = v.id)
            or (s.content_type = 'clip'  and s.content_id in (select c.id from clips c where c.video_id = v.id))
            or (s.content_type = 'game'  and v.game_id is not null and s.content_id = v.game_id) )
         and ( is_super_admin() or s.shared_by_user_id = uid
            or (s.audience='team'    and is_team_member(s.team_id))
            or (s.audience='coaches' and is_team_coach(s.team_id))
            or (s.audience='player'  and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid)))
     ) then return v.url; end if;
  raise exception 'Not allowed to view this video';
end $function$;

CREATE OR REPLACE FUNCTION public.can_delete_team_content (
  p_team_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select is_super_admin() or is_team_admin(p_team_id) or has_team_permission(p_team_id, 'delete_content');
$function$;

CREATE OR REPLACE FUNCTION public.can_link_player (
  p_player uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select public.is_super_admin()
      or exists (select 1 from public.players p
                 where p.id = p_player
                   and ((p.team_id is not null and public.is_team_coach(p.team_id))
                        or public.is_linked_parent(p.id)));
$function$;

CREATE OR REPLACE FUNCTION public.can_read_team_tag (
  p_team     uuid,
  p_category text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from video_tagging_rights r join videos v on v.id = r.video_id
    where v.team_id = p_team and r.granted_to_user_id = auth.uid()
      and r.can_tag and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
      and (p_category is distinct from 'players' or r.names_hidden = false)
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_tag_game (
  p_game uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from video_tagging_rights r join videos v on v.id = r.video_id
    where v.game_id = p_game and r.granted_to_user_id = auth.uid()
      and r.can_tag and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_tag_video (
  p_video uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from video_tagging_rights r
    where r.video_id = p_video
      and r.granted_to_user_id = auth.uid()
      and r.can_tag = true
      and r.status = 'active'
      and (r.expires_at is null or r.expires_at > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.cancel_tagging_job (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update tagging_jobs set status='canceled'
   where id=p_job and requester_user_id=auth.uid() and status <> 'complete';
  if not found then raise exception 'Cannot cancel this job.'; end if;
  perform _revoke_job_grants(p_job);
end $function$;

CREATE OR REPLACE FUNCTION public.claim_or_link_guardian (
  p_code text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); p_id uuid; n int; has_seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;

  perform 1 from players where id = p_id for update;

  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
    select count(*) into n from parent_player_links where player_id = p_id;
    select exists (
      select 1 from player_guardian_seats
       where player_id = p_id and granted_to_user_id = uid and revoked_at is null
    ) into has_seat;
    if n >= 4 and not has_seat then
      raise exception 'This player already has the maximum of 4 guardians';
    end if;
    insert into parent_player_links (parent_user_id, player_id, relationship)
    values (uid, p_id, case when n = 0 then 'parent' else 'guardian' end);
    update player_guardian_codes set last_used_at = now() where player_id = p_id;
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt where pt.player_id = p_id
  on conflict (team_id, user_id, role) do nothing;

  return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_roster_spot (
  p_code      text,
  p_player_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id into t_id from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;
  if not exists (select 1 from player_teams where team_id = t_id and player_id = p_player_id) then
    raise exception 'That player is not on this team';
  end if;

  perform 1 from players where id = p_player_id for update;

  if exists (select 1 from parent_player_links where player_id = p_player_id) then
    raise exception 'This player is already claimed — ask their family for their invite code to be added.';
  end if;

  insert into parent_player_links (parent_user_id, player_id, relationship)
  values (uid, p_player_id, 'parent');

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;

  return p_player_id;
end $function$;

CREATE OR REPLACE FUNCTION public.clear_my_phone()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_phone text;
begin
  select phone_number into v_phone from public.user_profiles where user_id = auth.uid();
  update public.user_profiles set phone_number = null, phone_verified_at = null where user_id = auth.uid();
  if v_phone is not null then
    insert into public.sms_opt_outs(phone_number, opted_out_at) values (v_phone, now())
    on conflict (phone_number) do update set opted_out_at = now(), opted_back_in_at = null;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_team_member_permission (
  p_team_id    uuid,
  p_user_id    uuid,
  p_permission public.team_permission
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  delete from team_member_permissions
  where team_id = p_team_id and user_id = p_user_id and permission = p_permission;
end; $function$;

CREATE OR REPLACE FUNCTION public.clear_team_player_permission (
  p_team_id    uuid,
  p_player_id  uuid,
  p_permission public.team_permission
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  delete from team_player_permissions
  where team_id = p_team_id and player_id = p_player_id and permission = p_permission;
end; $function$;

CREATE OR REPLACE FUNCTION public.clip_involves_my_kid (
  p_clip uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from clip_tags ct join tags t on t.id = ct.tag_id
    where ct.clip_id = p_clip
      and t.category = 'players' and t.player_id is not null
      and is_linked_parent(t.player_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.clip_is_pure_negative (
  p_clip uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (select 1 from clip_tags ct join tags t on t.id=ct.tag_id
                 where ct.clip_id=p_clip and t.tag_polarity='negative')
     and not exists (select 1 from clip_tags ct join tags t on t.id=ct.tag_id
                     where ct.clip_id=p_clip and t.tag_polarity='positive');
$function$;

CREATE OR REPLACE FUNCTION public.coaches_pin_status()
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare req boolean; has boolean;
begin
  select exists (
    select 1 from team_memberships tm
    join teams t on t.id = tm.team_id
    where tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach','coach') and tm.status = 'confirmed'
      and t.require_coaches_pin = true
  ) into req;
  select coaches_pin_hash is not null into has from user_profiles where user_id = auth.uid();
  return json_build_object('required', coalesce(req, false), 'has_pin', coalesce(has, false));
end $function$;

CREATE OR REPLACE FUNCTION public.create_kid (
  name text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(name, ''));
  new_id uuid;
  c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if clean_name = '' then raise exception 'Kid name is required'; end if;

  insert into players (name, team_id, user_id) values (clean_name, null, null) returning id into new_id;
  insert into parent_player_links (parent_user_id, player_id, relationship) values (uid, new_id, 'parent');

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_practice_series (
  p_team_id       uuid,
  p_event_type    text,
  p_title         text,
  p_first_date    date,
  p_until_date    date,
  p_weekdays      integer[],
  p_start_time    time without time zone,
  p_arrival_time  time without time zone,
  p_end_time      time without time zone,
  p_tz            text,
  p_venue_name    text,
  p_venue_address text,
  p_uniform       text,
  p_notes         text
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  v_series uuid := gen_random_uuid();
  v_count int := 0;
  d date;
begin
  perform set_config('app.suppress_event_notify', '1', true);  -- txn-local: no per-occurrence blasts
  if p_event_type not in ('practice','team_event') then
    raise exception 'Only practices and team events can repeat.';
  end if;
  if p_until_date < p_first_date then
    raise exception 'The end date must be on or after the first date.';
  end if;
  if p_until_date - p_first_date > 400 then
    raise exception 'That recurrence spans too long — keep it under about 13 months.';
  end if;
  if p_weekdays is null or array_length(p_weekdays, 1) is null then
    raise exception 'Pick at least one day of the week.';
  end if;

  for d in
    select gs::date from generate_series(p_first_date, p_until_date, interval '1 day') gs
    where extract(dow from gs)::int = any (p_weekdays)
  loop
    insert into public.events (
      team_id, event_type, title, local_date, starts_at, arrival_at, ends_at,
      event_timezone, time_status, venue_name, venue_address, uniform, notes, series_id, created_by
    ) values (
      p_team_id, p_event_type, p_title, d,
      case when p_start_time   is not null then ((d::text || ' ' || p_start_time)::timestamp   at time zone p_tz) end,
      case when p_arrival_time is not null then ((d::text || ' ' || p_arrival_time)::timestamp at time zone p_tz) end,
      case when p_end_time     is not null then ((d::text || ' ' || p_end_time)::timestamp     at time zone p_tz) end,
      p_tz,
      case when p_start_time is not null then 'confirmed' else 'tbd' end,
      p_venue_name, p_venue_address, p_uniform, p_notes, v_series, auth.uid()
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_roster_placeholder (
  p_team_id uuid,
  p_name    text,
  p_jersey  text DEFAULT NULL::text
)
  RETURNS TABLE (
    player_id     uuid,
    guardian_code text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
#variable_conflict use_column
declare uid uuid := auth.uid(); new_id uuid; c text; v_name text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can add roster spots'; end if;

  v_name := coalesce(nullif(trim(p_name), ''), '#' || nullif(trim(p_jersey), ''));
  if v_name is null then raise exception 'A name or jersey number is required'; end if;

  insert into players (name, team_id, jersey_number)
  values (v_name, p_team_id, nullif(trim(p_jersey), ''))
  returning id into new_id;

  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (new_id, p_team_id, nullif(trim(p_jersey), ''), uid)
  on conflict (player_id, team_id) do nothing;

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return query select new_id, c;
end $function$;

CREATE OR REPLACE FUNCTION public.create_tagging_job (
  p_game_id        uuid,
  p_tagger_user_id uuid,
  p_due_at         timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_instructions   text                     DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_uid uuid := auth.uid(); v_team uuid; v_job uuid; v_hide boolean; v_exp timestamptz;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select team_id into v_team from games where id = p_game_id;
  if v_team is null then raise exception 'game not found'; end if;
  if not (is_super_admin() or is_team_coach(v_team)) then raise exception 'not authorized'; end if;
  if p_tagger_user_id = v_uid then raise exception 'You can''t assign a job to yourself.'; end if;
  if not exists (select 1 from tagger_links where owner_user_id = v_uid and tagger_user_id = p_tagger_user_id) then
    raise exception 'Add this tagger to My Taggers first.';
  end if;

  v_hide := not exists (
    select 1 from team_memberships where team_id = v_team and user_id = p_tagger_user_id and status = 'confirmed'
  );
  v_exp := coalesce(p_due_at, now() + interval '30 days') + interval '14 days';

  insert into tagging_jobs (game_id, team_id, requester_user_id, tagger_user_id, status, instructions, due_at)
    values (p_game_id, v_team, v_uid, p_tagger_user_id, 'new', p_instructions, p_due_at)
    returning id into v_job;

  insert into video_tagging_rights (video_id, granted_to_user_id, granted_by_user_id, can_tag, names_hidden, status, expires_at)
    select v.id, p_tagger_user_id, v_uid, true, v_hide, 'active', v_exp
    from videos v
    where v.game_id = p_game_id
      and not exists (
        select 1 from video_tagging_rights r
        where r.video_id = v.id and r.granted_to_user_id = p_tagger_user_id and r.status = 'active'
      );
  return v_job;
end $function$;

CREATE OR REPLACE FUNCTION public.deactivate_my_account()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  insert into user_profiles (user_id, deactivated_at, updated_at)
  values (auth.uid(), now(), now())
  on conflict (user_id) do update set deactivated_at = now(), updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.delete_game (
  p_game_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare t uuid; ev uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select team_id, event_id into t, ev from games where id = p_game_id and deleted_at is null;
  if t is null then raise exception 'Game not found'; end if;
  if not can_delete_team_content(t) then
    raise exception 'Only a team admin (or someone granted Delete content) can delete a game';
  end if;
  update games  set deleted_at = now() where id = p_game_id;
  update videos set deleted_at = now() where game_id = p_game_id and deleted_at is null;
  -- Delete everywhere: also soft-delete the linked schedule/calendar event.
  if ev is not null then
    update events set deleted_at = now() where id = ev and deleted_at is null;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.effective_user_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT COALESCE(
    (SELECT acting_as_user_id FROM super_admins WHERE user_id = auth.uid()),
    auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_event_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_kind text;
begin
  if coalesce(current_setting('app.suppress_event_notify', true), '') = '1' then return null; end if;
  if tg_op = 'INSERT' then
    if new.status = 'canceled' then return null; end if;
    v_kind := 'created';
  else
    if new.status = 'canceled' and old.status is distinct from 'canceled' then v_kind := 'canceled';
    elsif new.status = 'completed' and old.status is distinct from 'completed' then v_kind := 'completed';
    elsif new.starts_at is distinct from old.starts_at or new.local_date is distinct from old.local_date or new.time_status is distinct from old.time_status then v_kind := 'time_changed';
    elsif new.venue_name is distinct from old.venue_name or new.venue_address is distinct from old.venue_address then v_kind := 'venue_changed';
    else return null;
    end if;
  end if;
  insert into public.notification_outbox (event_id, team_id, change_kind, actor_user_id, event_version, dispatch_after)
  values (new.id, new.team_id, v_kind, auth.uid(), new.version, now() + interval '90 seconds')
  on conflict (event_id, change_kind) where processed_at is null
  do update set actor_user_id = excluded.actor_user_id, event_version = excluded.event_version, dispatch_after = now() + interval '90 seconds';
  return null;
exception when others then return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_message_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.kind = 'announcement' and new.parent_id is null and new.deleted_at is null then
    -- push/SMS delivery pipeline (unchanged)
    insert into public.notification_outbox (source, message_id, team_id, change_kind, actor_user_id, dispatch_after)
    values ('message', new.id, new.team_id, 'custom', new.author_user_id, now());

    -- in-app bell feed: one row per team recipient (author excluded by resolver)
    insert into public.notifications (recipient_user_id, type, actor_user_id, team_id, entity_type, entity_id)
    select r.recipient_user_id, 'team_message', new.author_user_id, new.team_id, 'message', new.id
    from public.resolve_team_recipients(new.team_id, new.author_user_id) r;
  end if;
  return null;
exception when others then
  return null;  -- never block posting on a notification hiccup
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_snack_reminders()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into public.notification_outbox (event_id, team_id, change_kind, target_user_id, source, dispatch_after)
  select e.id, e.team_id, 'snack_reminder', s.claimed_by_user_id, 'snack', now()
  from public.events e
  join public.event_snack_signups s on s.event_id = e.id
  where e.status = 'scheduled' and e.starts_at is not null and e.snacks_enabled
    and e.starts_at between now() and now() + interval '24 hours'
    and not exists (select 1 from public.schedule_notifications n
                    where n.event_id = e.id and n.recipient_user_id = s.claimed_by_user_id and n.change_kind = 'snack_reminder')
    and not exists (select 1 from public.notification_outbox o
                    where o.event_id = e.id and o.change_kind = 'snack_reminder' and o.processed_at is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_player_tag()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into tags (name, category, scope, team_id, player_id, sort_order)
  select case when split_part(p.name, ' ', 1) like '#%'
              then split_part(p.name, ' ', 1)
              else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(NEW.jersey_number), ''), '') end,
         'players', 'team', NEW.team_id, NEW.player_id,
         coalesce((select max(sort_order) + 1 from tags
                   where team_id = NEW.team_id and category = 'players'), 0)
  from players p
  where p.id = NEW.player_id
  on conflict do nothing;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_user_profile()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.extend_job_grants_to_new_video()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into video_tagging_rights (video_id, granted_to_user_id, granted_by_user_id, can_tag, names_hidden, status, expires_at)
    select new.id, j.tagger_user_id, j.requester_user_id, true,
           not exists (select 1 from team_memberships m where m.team_id = j.team_id and m.user_id = j.tagger_user_id and m.status='confirmed'),
           'active', coalesce(j.due_at, now() + interval '30 days') + interval '14 days'
    from tagging_jobs j
    where j.game_id = new.game_id
      and j.status in ('new','in_progress','review','changes_requested')
      and j.tagger_user_id is not null
      and not exists (
        select 1 from video_tagging_rights r
        where r.video_id = new.id and r.granted_to_user_id = j.tagger_user_id and r.status='active'
      );
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.game_stat_lines_touch_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gen_join_code (
  len integer DEFAULT 6
)
  RETURNS text
  LANGUAGE sql
  SET search_path TO 'public'
  AS $function$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, len);
$function$;

CREATE OR REPLACE FUNCTION public.generate_tagger_code()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_code text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from user_profiles where tagger_code = v_code);
  end loop;
  update user_profiles set tagger_code = v_code where user_id = v_uid;
  return v_code;
end $function$;

CREATE OR REPLACE FUNCTION public.get_game_lineup_editor (
  p_game_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); t uuid; result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then raise exception 'Only a team coach can edit the lineup'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', x.player_id, 'label', x.label, 'in_lineup', x.in_lineup) order by x.label), '[]'::jsonb)
  into result
  from (
    select p.id as player_id,
           case when split_part(p.name, ' ', 1) like '#%' then p.name
                else p.name || coalesce(' #' || nullif(trim(pt.jersey_number), ''), '') end as label,
           exists (select 1 from game_lineups gl where gl.game_id = p_game_id and gl.player_id = p.id) as in_lineup
    from players p
    join player_teams pt on pt.player_id = p.id and pt.team_id = t
    where pt.left_at is null
       or exists (select 1 from game_lineups gl where gl.game_id = p_game_id and gl.player_id = p.id)
  ) x;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_tagger_code()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select tagger_code from user_profiles where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_notifications()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'actor_name', coalesce((select up.display_name from user_profiles up where up.user_id = n.actor_user_id), 'Someone'),
    'player_name', split_part(coalesce(p.name, ''), ' ', 1),
    'team_name', t.name,
    'team_id', n.team_id,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'target_player_id', n.target_player_id,
    'created_at', n.created_at,
    'read_at', n.read_at
  ) order by n.created_at desc), '[]'::jsonb)
  into result
  from notifications n
  left join players p on p.id = n.target_player_id
  left join teams t on t.id = n.team_id
  where n.recipient_user_id = uid;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.get_purge_secret()
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select decrypted_secret from vault.decrypted_secrets where name = 'purge_secret' limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_display_name (
  p_user_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  shared boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  shared :=
    uid = p_user_id
    or is_super_admin()
    or exists (
      select 1
      from parent_player_links a
      join parent_player_links b on b.player_id = a.player_id
      where a.parent_user_id = uid
        and b.parent_user_id = p_user_id
    )
    or exists (
      select 1
      from team_memberships a
      join team_memberships b on b.team_id = a.team_id
      where a.user_id = uid
        and b.user_id = p_user_id
        and a.status = 'confirmed'
        and b.status = 'confirmed'
    )
    or exists (
      select 1
      from parent_player_links ppl
      join player_teams pt on pt.player_id = ppl.player_id
      join team_memberships tm on tm.team_id = pt.team_id
      where ppl.parent_user_id = uid
        and tm.user_id = p_user_id
        and tm.status = 'confirmed'
    );

  if not shared then
    return null;
  end if;

  return (select display_name from user_profiles where user_id = p_user_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.grab_play (
  p_source uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_new uuid; v_doc jsonb; v_sport text; v_name text; v_tags text[]; v_side text;
begin
  select doc, sport, name, tags, side into v_doc, v_sport, v_name, v_tags, v_side
  from public.library_plays where id = p_source and visibility = 'community';
  if not found then raise exception 'Play not found or not public.'; end if;
  insert into public.library_plays (owner_user_id, sport, name, doc, tags, side, visibility)
  values (auth.uid(), v_sport, v_name, v_doc, v_tags, v_side, 'private')
  returning id into v_new;
  update public.library_plays set save_count = save_count + 1 where id = p_source;
  return v_new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_guardian_seat (
  p_player_id       uuid,
  p_user_id         uuid,
  p_source          text DEFAULT 'comp'::text,
  p_external_txn_id text DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); seat_id uuid;
begin
  if uid is not null and not is_super_admin() then
    raise exception 'Not allowed to grant a guardian seat';
  end if;

  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'No such player';
  end if;

  if exists (select 1 from parent_player_links
              where player_id = p_player_id and parent_user_id = p_user_id) then
    raise exception 'That person is already a guardian of this player';
  end if;

  insert into player_guardian_seats
    (player_id, granted_to_user_id, source, external_txn_id, granted_by_user_id)
  values
    (p_player_id, p_user_id, p_source, p_external_txn_id, uid)
  on conflict (player_id, granted_to_user_id) where revoked_at is null
  do nothing
  returning id into seat_id;

  if seat_id is null then
    select id into seat_id from player_guardian_seats
     where player_id = p_player_id and granted_to_user_id = p_user_id and revoked_at is null;
  end if;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'grant_guardian_seat', p_user_id, 'player_guardian_seats', seat_id,
          jsonb_build_object('player_id', p_player_id, 'source', p_source,
                             'external_txn_id', p_external_txn_id));

  return seat_id;
end $function$;

CREATE OR REPLACE FUNCTION public.has_team_permission (
  p_team_id    uuid,
  p_permission public.team_permission
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_top   membership_role;
  v_allowed boolean;
BEGIN
  -- Not logged in.
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Super admin gets everything.
  IF is_super_admin() THEN
    RETURN true;
  END IF;

  -- Find the HIGHEST-ranked role this user holds on the team
  -- (admin > head_coach > coach > parent > player > follower).
  SELECT role INTO v_top
  FROM team_memberships
  WHERE team_id = p_team_id
    AND user_id = v_uid
    AND status = 'confirmed'
  ORDER BY CASE role
    WHEN 'admin'      THEN 6
    WHEN 'head_coach' THEN 5
    WHEN 'coach'      THEN 4
    WHEN 'parent'     THEN 3
    WHEN 'player'     THEN 2
    WHEN 'follower'   THEN 1
    ELSE 0
  END DESC
  LIMIT 1;

  -- Not a member of this team.
  IF v_top IS NULL THEN
    RETURN false;
  END IF;

  -- Coach-level roles win outright — all 8 permissions.
  IF v_top IN ('admin', 'head_coach', 'coach') THEN
    RETURN true;
  END IF;

  -- Non-coach: per-person override → team default → code default.
  SELECT allowed INTO v_allowed
  FROM team_member_permissions
  WHERE team_id = p_team_id AND user_id = v_uid AND permission = p_permission;
  IF found THEN
    RETURN v_allowed;
  END IF;

  SELECT allowed INTO v_allowed
  FROM team_permission_defaults
  WHERE team_id = p_team_id AND permission = p_permission;
  IF found THEN
    RETURN v_allowed;
  END IF;

  RETURN CASE p_permission
    WHEN 'delete_content' THEN false
    WHEN 'manage_roster'  THEN false
    ELSE true
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_game_events (
  p_team_id uuid,
  p_rows    jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  r jsonb;
  v_event uuid;
  v_opp text;
  v_title text;
  n int := 0;
begin
  perform set_config('app.suppress_event_notify', '1', true);  -- txn-local: silent import
  for r in select value from jsonb_array_elements(p_rows) loop
    v_opp := nullif(trim(r->>'opponent'), '');
    v_title := case when v_opp is not null then 'vs ' || v_opp else null end;
    insert into public.events (team_id, event_type, title, local_date, starts_at, time_status, home_away, venue_name, event_timezone, created_by)
    values (
      p_team_id, 'game', v_title, (r->>'date')::date,
      case when coalesce(r->>'starts_at','') <> '' then (r->>'starts_at')::timestamptz end,
      coalesce(nullif(r->>'time_status',''), 'tbd'),
      nullif(r->>'home_away', ''),
      nullif(trim(r->>'venue_name'), ''),
      coalesce(nullif(r->>'tz',''), 'America/Chicago'),
      auth.uid()
    ) returning id into v_event;
    insert into public.games (team_id, title, opponent, game_date, event_id)
    values (p_team_id, coalesce(v_title, 'Game'), v_opp, (r->>'date')::date, v_event);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_family_film_parent (
  p_game_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from game_lineups gl
    join games g  on g.id = gl.game_id
    join teams tm on tm.id = g.team_id
    where gl.game_id = p_game_id
      and tm.parent_film_visible
      and is_linked_parent(gl.player_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_lineup_parent (
  p_game_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from game_lineups gl
    where gl.game_id = p_game_id and is_linked_parent(gl.player_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_linked_parent (
  p_player_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from parent_player_links
    where player_id = p_player_id
      and parent_user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_primary_guardian (
  p_player_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists(
    select 1 from parent_player_links ppl
    where ppl.player_id = p_player_id and ppl.parent_user_id = auth.uid()
      and ppl.created_at = (select min(created_at) from parent_player_links where player_id = p_player_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.is_tagging_job_party (
  p_job uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from tagging_jobs j
    where j.id = p_job and (j.requester_user_id = auth.uid() or j.tagger_user_id = auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_team_admin (
  check_team_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from team_memberships
    where team_id = check_team_id and user_id = auth.uid()
      and status = 'confirmed' and role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_team_coach (
  check_team_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = check_team_id
      AND user_id = auth.uid()
      AND status = 'confirmed'
      AND role IN ('admin','head_coach','coach')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_team_member (
  t uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = t
      AND user_id = auth.uid()
      AND status = 'confirmed'
  );
$function$;

CREATE OR REPLACE FUNCTION public.join_team_with_code (
  p_code      text,
  p_player_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_player_id) then
    raise exception 'You are not a guardian of this player';
  end if;
  select id into t_id from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (p_player_id, t_id, uid)
  on conflict (player_id, team_id) do update set left_at = null;
  update players set team_id = t_id where id = p_player_id and team_id is null;

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;
  return t_id;
end $function$;

CREATE OR REPLACE FUNCTION public.kid_guardians (
  p_player_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); primary_uid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()
          or is_team_coach((select team_id from players where id = p_player_id))) then
    raise exception 'Not allowed';
  end if;
  select parent_user_id into primary_uid from parent_player_links
    where player_id = p_player_id order by created_at limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', ppl.parent_user_id,
             'name', coalesce(up.display_name, 'Guardian'),
             'relationship', ppl.relationship,
             'is_you', ppl.parent_user_id = uid,
             'is_primary', ppl.parent_user_id = primary_uid
           ) order by (ppl.parent_user_id = primary_uid) desc, ppl.created_at)
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    where ppl.player_id = p_player_id
  ), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.kid_team_audience (
  p_player_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()
          or is_team_coach((select team_id from players where id = p_player_id))) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'team_id', pt.team_id,
               'team_name', coalesce(te.name, 'Team'),
               'member_count', (
                 select count(distinct tm2.user_id)
                 from team_memberships tm2
                 where tm2.team_id = pt.team_id and tm2.status = 'confirmed'
               ),
               'coaches', coalesce((
                 select jsonb_agg(c order by c->>'name')
                 from (
                   select distinct on (tm.user_id)
                          jsonb_build_object(
                            'user_id', tm.user_id,
                            'name', coalesce(up.display_name, 'Coach'),
                            'role', tm.role,
                            'is_you', tm.user_id = uid
                          ) as c
                   from team_memberships tm
                   left join user_profiles up on up.user_id = tm.user_id
                   where tm.team_id = pt.team_id
                     and tm.status = 'confirmed'
                     and tm.role in ('admin','head_coach','coach')
                   order by tm.user_id,
                            case tm.role
                              when 'admin' then 1
                              when 'head_coach' then 2
                              else 3
                            end
                 ) d
               ), '[]'::jsonb)
             )
             order by coalesce(te.name, 'Team')
           )
    from player_teams pt
    left join teams te on te.id = pt.team_id
    where pt.player_id = p_player_id
      and pt.left_at is null
  ), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.leave_team (
  p_player_id uuid,
  p_team_id   uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to leave this team';
  end if;
  update player_teams set left_at = now()
  where player_id = p_player_id and team_id = p_team_id and left_at is null;
end $function$;

CREATE OR REPLACE FUNCTION public.link_players (
  p_keep  uuid,
  p_merge uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare keep_lin uuid; merge_lin uuid;
begin
  if p_keep = p_merge then raise exception 'Cannot link a player to itself'; end if;
  if not public.can_link_player(p_keep) or not public.can_link_player(p_merge) then
    raise exception 'Not authorized to link these players';
  end if;
  select coalesce(player_lineage_id, id) into keep_lin  from public.players where id = p_keep;
  select coalesce(player_lineage_id, id) into merge_lin from public.players where id = p_merge;
  if keep_lin is null or merge_lin is null then raise exception 'Player not found'; end if;
  if keep_lin = merge_lin then return; end if;
  update public.players set player_lineage_id = keep_lin where player_lineage_id = merge_lin;
end $function$;

CREATE OR REPLACE FUNCTION public.list_deleted_content (
  p_team_id uuid
)
  RETURNS TABLE (
    kind       text,
    id         uuid,
    title      text,
    deleted_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_admin(p_team_id)) then
    raise exception 'Only a team admin can view deleted content';
  end if;
  return query
    select 'game'::text, g.id, g.title, g.deleted_at from games g
      where g.team_id = p_team_id and g.deleted_at is not null and g.deleted_at > now() - interval '30 days'
    union all
    select 'video'::text, v.id, v.label, v.deleted_at from videos v
      where v.team_id = p_team_id and v.game_id is null
        and v.deleted_at is not null and v.deleted_at > now() - interval '30 days'
    union all
    select 'reel'::text, hr.id, hr.name, hr.deleted_at from highlight_reels hr
      where hr.team_id = p_team_id and hr.deleted_at is not null and hr.deleted_at > now() - interval '30 days'
    order by 4 desc;
end $function$;

CREATE OR REPLACE FUNCTION public.list_job_messages (
  p_job uuid
)
  RETURNS TABLE (
    id          uuid,
    body        text,
    author_name text,
    is_mine     boolean,
    created_at  timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select m.id, m.body, coalesce(nullif(trim(up.display_name), ''), 'User'),
         (m.author_user_id = auth.uid()), m.created_at
  from tagging_job_messages m left join user_profiles up on up.user_id = m.author_user_id
  where m.job_id = p_job
    and exists (select 1 from tagging_jobs j
                where j.id = p_job and (j.requester_user_id = auth.uid() or j.tagger_user_id = auth.uid()))
  order by m.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_taggers()
  RETURNS TABLE (
    tagger_user_id uuid,
    display_name   text,
    linked_at      timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select tl.tagger_user_id, coalesce(nullif(trim(up.display_name), ''), 'Tagger'), tl.created_at
  from tagger_links tl left join user_profiles up on up.user_id = tl.tagger_user_id
  where tl.owner_user_id = auth.uid()
  order by 2;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_tagging_jobs()
  RETURNS TABLE (
    id                  uuid,
    game_id             uuid,
    team_id             uuid,
    status              public.tagging_job_status,
    role                text,
    counterpart_name    text,
    game_title          text,
    team_name           text,
    instructions        text,
    due_at              timestamp with time zone,
    requested_at        timestamp with time zone,
    tagger_completed_at timestamp with time zone,
    finalized_at        timestamp with time zone,
    released_at         timestamp with time zone,
    revisions           integer,
    video_count         integer
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select j.id, j.game_id, j.team_id, j.status,
    case when j.requester_user_id = auth.uid() then 'owner' else 'tagger' end as role,
    coalesce(nullif(trim(cp.display_name), ''), '—') as counterpart_name,
    coalesce(g.title, 'Game') as game_title,
    coalesce(tm.name, '') as team_name,
    j.instructions, j.due_at, j.requested_at, j.tagger_completed_at, j.finalized_at, j.released_at, j.revisions,
    (select count(*)::int from videos v where v.game_id = j.game_id) as video_count
  from tagging_jobs j
  left join games g  on g.id  = j.game_id
  left join teams tm on tm.id = j.team_id
  left join user_profiles cp on cp.user_id =
    (case when j.requester_user_id = auth.uid() then j.tagger_user_id else j.requester_user_id end)
  where j.requester_user_id = auth.uid() or j.tagger_user_id = auth.uid()
  order by (case j.status when 'changes_requested' then 0 when 'in_progress' then 1
                          when 'new' then 2 when 'review' then 3 else 9 end),
           j.due_at nulls last, j.requested_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.list_player_guardians (
  p_team_id   uuid,
  p_player_id uuid
)
  RETURNS TABLE (
    user_id      uuid,
    display_name text,
    email        text,
    relationship text,
    team_role    public.membership_role
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or exists (
    select 1 from team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach') and tm.status = 'confirmed'
  )) then
    raise exception 'not authorized';
  end if;
  -- Don't leak guardians of a player who isn't actually on this team.
  if not exists (
    select 1 from player_teams pt
    where pt.player_id = p_player_id and pt.team_id = p_team_id and pt.left_at is null
  ) then
    raise exception 'player not on this team';
  end if;
  return query
    select ppl.parent_user_id,
           coalesce(nullif(trim(up.display_name), ''), 'Guardian') as display_name,
           au.email::text as email,
           ppl.relationship,
           (select tm.role from team_memberships tm
             where tm.team_id = p_team_id and tm.user_id = ppl.parent_user_id
             order by (case tm.role when 'admin' then 0 when 'head_coach' then 1
                                    when 'coach' then 2 when 'parent' then 3 else 4 end)
             limit 1) as team_role
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    left join auth.users au on au.id = ppl.parent_user_id
    where ppl.player_id = p_player_id
    order by 2;
end $function$;

CREATE OR REPLACE FUNCTION public.list_team_staff (
  p_team_id uuid
)
  RETURNS TABLE (
    user_id      uuid,
    display_name text,
    role         public.membership_role
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_member(p_team_id)) then raise exception 'not authorized'; end if;
  return query
    select tm.user_id, coalesce(nullif(trim(up.display_name), ''), 'Coach') as display_name, tm.role
    from team_memberships tm
    left join user_profiles up on up.user_id = tm.user_id
    where tm.team_id = p_team_id and tm.role in ('admin','head_coach','coach')
    order by (case tm.role when 'admin' then 0 when 'head_coach' then 1 else 2 end), 2;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read (
  p_id uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  update notifications set read_at = now() where id = p_id and recipient_user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.mark_notifications_seen()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  update notifications set seen_at = now() where recipient_user_id = auth.uid() and seen_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.merge_players (
  p_keep uuid,
  p_dup  uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); keep_tag uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_keep = p_dup then raise exception 'Cannot merge a player with itself'; end if;

  if not (
    is_super_admin()
    or (is_linked_parent(p_keep) and is_linked_parent(p_dup))
    or exists (
      select 1 from player_teams a
      join player_teams b on b.team_id = a.team_id
      where a.player_id = p_keep and b.player_id = p_dup and is_team_coach(a.team_id)
    )
  ) then
    raise exception 'Not allowed to merge these players';
  end if;

  -- lock both rows in a stable order to avoid concurrent-merge deadlocks
  perform 1 from players where id = least(p_keep, p_dup) for update;
  perform 1 from players where id = greatest(p_keep, p_dup) for update;

  -- simple repoints (only player_id in the key)
  update videos set player_id = p_keep where player_id = p_dup;
  update shares set target_player_id = p_keep where target_player_id = p_dup;

  -- game_lineups PK(game_id, player_id): move rows the keeper isn't already in
  update game_lineups gl set player_id = p_keep
    where gl.player_id = p_dup
      and not exists (select 1 from game_lineups k where k.game_id = gl.game_id and k.player_id = p_keep);
  delete from game_lineups where player_id = p_dup;

  -- player_teams UNIQUE(player_id, team_id)
  update player_teams pt set player_id = p_keep
    where pt.player_id = p_dup
      and not exists (select 1 from player_teams k where k.team_id = pt.team_id and k.player_id = p_keep);
  delete from player_teams where player_id = p_dup;

  -- parent_player_links UNIQUE(parent_user_id, player_id): union guardians
  update parent_player_links l set player_id = p_keep
    where l.player_id = p_dup
      and not exists (select 1 from parent_player_links k where k.parent_user_id = l.parent_user_id and k.player_id = p_keep);
  delete from parent_player_links where player_id = p_dup;

  -- team_player_permissions PK(team_id, player_id, permission)
  update team_player_permissions tpp set player_id = p_keep
    where tpp.player_id = p_dup
      and not exists (select 1 from team_player_permissions k
                      where k.team_id = tpp.team_id and k.player_id = p_keep and k.permission = tpp.permission);
  delete from team_player_permissions where player_id = p_dup;

  -- STATS: merge the player tags so clip_tags land under one tag.
  select id into keep_tag from tags where player_id = p_keep and category = 'players' limit 1;
  if keep_tag is not null then
    update clip_tags ct set tag_id = keep_tag
      from tags t
      where ct.tag_id = t.id and t.player_id = p_dup and t.category = 'players'
        and not exists (select 1 from clip_tags k
                        where k.clip_id = ct.clip_id and k.tag_id = keep_tag and k.bundle_number = ct.bundle_number);
    delete from clip_tags ct using tags t
      where ct.tag_id = t.id and t.player_id = p_dup and t.category = 'players';  -- leftover conflicts
    delete from tags where player_id = p_dup and category = 'players';
  else
    update tags set player_id = p_keep where player_id = p_dup and category = 'players';
  end if;

  -- lineage: keep the keeper's; adopt the dup's if the keeper has none
  update players k set player_lineage_id = d.player_lineage_id
    from players d
    where k.id = p_keep and d.id = p_dup
      and k.player_lineage_id is null and d.player_lineage_id is not null;

  -- delete the dup (cascades player_guardian_codes + followers)
  delete from players where id = p_dup;

  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'merge_players', 'players', p_keep, jsonb_build_object('kept', p_keep, 'merged', p_dup));
end $function$;

CREATE OR REPLACE FUNCTION public.notifications_unseen_count()
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select count(*)::int from notifications where recipient_user_id = auth.uid() and seen_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_share()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.team_id is null then
    return new;
  end if;

  if new.audience = 'team' then
    perform notify_users(
      array(select distinct tm.user_id from team_memberships tm
            where tm.team_id = new.team_id and tm.status = 'confirmed'),
      'share_to_team', new.shared_by_user_id, new.target_player_id, new.team_id,
      new.content_type::text, new.content_id
    );
  elsif new.audience = 'coaches' then
    perform notify_users(
      array(select distinct tm.user_id from team_memberships tm
            where tm.team_id = new.team_id and tm.status = 'confirmed'
              and tm.role in ('admin','head_coach','coach')),
      'share_to_coaches', new.shared_by_user_id, new.target_player_id, new.team_id,
      new.content_type::text, new.content_id
    );
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.notify_on_share_comment()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  s_team uuid; s_type text; s_id uuid; s_player uuid;
begin
  select s.team_id, s.content_type::text, s.content_id, s.target_player_id
    into s_team, s_type, s_id, s_player
  from shares s where s.id = new.share_id;

  if s_team is null then
    return new;
  end if;

  perform notify_users(
    array(select distinct tm.user_id from team_memberships tm
          where tm.team_id = s_team and tm.status = 'confirmed'
            and tm.role in ('admin','head_coach','coach')),
    'new_comment', new.author_user_id, s_player, s_team, s_type, s_id
  );
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.notify_users (
  p_recipients    uuid[],
  p_type          text,
  p_actor         uuid,
  p_target_player uuid,
  p_team          uuid,
  p_entity_type   text,
  p_entity_id     uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into notifications (recipient_user_id, type, actor_user_id, target_player_id, team_id, entity_type, entity_id)
  select r, p_type, p_actor, p_target_player, p_team, p_entity_type, p_entity_id
  from unnest(p_recipients) r
  where r is not null and r is distinct from p_actor;
end $function$;

CREATE OR REPLACE FUNCTION public.owner_finalize_job (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare j tagging_jobs;
begin
  update tagging_jobs set status='complete', finalized_at=now()
   where id=p_job and requester_user_id=auth.uid() and status in ('review','changes_requested')
   returning * into j;
  if not found then raise exception 'Cannot finalize this job.'; end if;
  update videos set tagging_complete=true where game_id=j.game_id;
  perform _revoke_job_grants(p_job);
end $function$;

CREATE OR REPLACE FUNCTION public.owner_request_changes (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update tagging_jobs set status='changes_requested', revisions=revisions+1
   where id=p_job and requester_user_id=auth.uid() and status='review';
  if not found then raise exception 'Cannot request changes on this job.'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.post_to_wall (
  p_content_type     public.share_content,
  p_content_id       uuid,
  p_audience         public.share_audience,
  p_target_player_id uuid,
  p_team_id          uuid                  DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  new_id uuid;
  team_scoped boolean := (p_target_player_id is null);
  goes_on_wall boolean := false;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_audience = 'player' then
    if p_target_player_id is null then
      raise exception 'A target player is required for an inbox send';
    end if;
    if not (
      is_super_admin()
      or exists (select 1 from parent_player_links ppl
                 where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid)
      or exists (select 1 from player_teams pt
                 where pt.player_id = p_target_player_id and is_team_coach(pt.team_id))
      or exists (select 1 from player_teams pt
                 join team_memberships tm on tm.team_id = pt.team_id
                 where pt.player_id = p_target_player_id
                   and tm.user_id = uid and tm.status = 'confirmed' and tm.role = 'player')
    ) then
      raise exception 'Not allowed: cannot send to this player''s inbox';
    end if;

    goes_on_wall := is_super_admin()
      or exists (select 1 from parent_player_links ppl
                 where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid);

  elsif p_audience = 'coaches' then
    if p_team_id is null then
      raise exception 'A team is required to post to the coaches board';
    end if;
    if p_target_player_id is not null then
      raise exception 'Coaches board posts are team-scoped and cannot target a player';
    end if;
    if not (is_super_admin() or is_team_coach(p_team_id)) then
      raise exception 'Not allowed: not a coach of this team';
    end if;

  elsif p_audience = 'team' and team_scoped then
    if p_team_id is null then
      raise exception 'A team is required to post to a team wall';
    end if;
    if not (is_super_admin() or is_team_coach(p_team_id)) then
      raise exception 'Not allowed: not a coach of this team';
    end if;

  elsif p_audience = 'public' and team_scoped then
    if p_team_id is null then
      raise exception 'A team is required for a team public post';
    end if;
    if not (is_super_admin() or is_team_coach(p_team_id)) then
      raise exception 'Not allowed: not a coach of this team';
    end if;

  else
    if not is_super_admin() and not exists (
      select 1 from parent_player_links ppl
      where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid
    ) then
      raise exception 'Not allowed: not a linked parent of this player';
    end if;
  end if;

  if p_audience = 'team' and not team_scoped then
    if p_team_id is null then
      raise exception 'A team is required to post to a team audience';
    end if;
    if not exists (select 1 from player_teams pt
                   where pt.player_id = p_target_player_id and pt.team_id = p_team_id) then
      raise exception 'Player is not on the specified team';
    end if;
  end if;

  select id into new_id
  from shares
  where content_type      = p_content_type
    and content_id        = p_content_id
    and audience          = p_audience
    and target_player_id  is not distinct from p_target_player_id
    and shared_by_user_id = uid
    and team_id           is not distinct from p_team_id;
  if new_id is not null then
    return new_id;
  end if;

  insert into shares (content_type, content_id, audience, target_player_id, shared_by_user_id, team_id, on_wall)
  values (p_content_type, p_content_id, p_audience, p_target_player_id, uid, p_team_id, goes_on_wall)
  returning id into new_id;

  if p_audience = 'player' then
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_target_player_id),
      'share_to_kid', uid, p_target_player_id, p_team_id, p_content_type::text, p_content_id
    );
  end if;

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.preview_guardian_code (
  p_code text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); p_id uuid; nm text; n int; mine boolean; seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;
  select split_part(name, ' ', 1) into nm from players where id = p_id;
  select count(*) into n from parent_player_links where player_id = p_id;
  select exists (select 1 from parent_player_links where player_id = p_id and parent_user_id = uid) into mine;
  select exists (
    select 1 from player_guardian_seats
     where player_id = p_id and granted_to_user_id = uid and revoked_at is null
  ) into seat;
  return jsonb_build_object(
    'player_id', p_id,
    'first_name', nm,
    'guardian_count', n,
    'already_mine', mine,
    'has_seat', seat,
    'full', n >= 4,
    'can_buy_seat', (n >= 4 and not mine and not seat)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.preview_roster_by_code (
  p_code text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); t_id uuid; t_name text; players jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id, name into t_id, t_name from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', p.id,
           'first_name', split_part(p.name, ' ', 1),
           'jersey', pt.jersey_number,
           'claimed', exists (select 1 from parent_player_links l where l.player_id = p.id)
         ) order by p.name), '[]'::jsonb)
    into players
    from player_teams pt
    join players p on p.id = pt.player_id
    where pt.team_id = t_id;

  return jsonb_build_object('team_id', t_id, 'team_name', t_name, 'players', players);
end $function$;

CREATE OR REPLACE FUNCTION public.publish_reel (
  p_reel_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- OWNERSHIP CHECK — the caller must own the reel (or be super admin). This
  -- replaces post_to_wall's linked-parent-of-target-player check.
  if not is_super_admin() and not exists (
    select 1 from highlight_reels hr
    where hr.id = p_reel_id
      and hr.created_by_user_id = uid
  ) then
    raise exception 'Not allowed: you do not own this reel';
  end if;

  -- Get-or-create THIS caller's own public wall row for this reel (idempotent
  -- repost). target_player_id and team_id are always null for a public reel.
  select id into new_id
  from shares
  where content_type      = 'reel'
    and content_id        = p_reel_id
    and audience          = 'public'
    and shared_by_user_id = uid
    and target_player_id is null
    and team_id is null;
  if new_id is not null then
    return new_id;
  end if;

  insert into shares (content_type, content_id, audience, shared_by_user_id, target_player_id, team_id)
  values ('reel', p_reel_id, 'public', uid, null, null)
  returning id into new_id;

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_my_account()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  update user_profiles set deactivated_at = null, updated_at = now()
  where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.redeem_coach_code (
  p_code text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_team uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select id into v_team from teams where upper(coach_code) = upper(trim(p_code)) and coach_code is not null;
  if v_team is null then raise exception 'That coach code did not match any team.'; end if;
  insert into team_memberships (team_id, user_id, role, status)
    values (v_team, v_uid, 'coach', 'confirmed')
    on conflict (team_id, user_id, role) do update set status = 'confirmed';
  return v_team;
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_tagger_code (
  p_code text
)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_uid uuid := auth.uid(); v_tagger uuid; v_name text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select up.user_id, coalesce(nullif(trim(up.display_name), ''), 'Tagger')
    into v_tagger, v_name
    from user_profiles up where upper(up.tagger_code) = upper(trim(p_code));
  if v_tagger is null then raise exception 'That tagger code did not match anyone.'; end if;
  if v_tagger = v_uid then raise exception 'That is your own tagger code.'; end if;
  insert into tagger_links (owner_user_id, tagger_user_id)
    values (v_uid, v_tagger) on conflict (owner_user_id, tagger_user_id) do nothing;
  return json_build_object('tagger_user_id', v_tagger, 'display_name', v_name);
end $function$;

CREATE OR REPLACE FUNCTION public.regenerate_coach_code (
  p_team_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_code text;
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then raise exception 'not authorized'; end if;
  loop
    v_code := upper(substring(md5(gen_random_uuid()::text) for 6));
    exit when not exists (select 1 from teams where coach_code = v_code);
  end loop;
  update teams set coach_code = v_code where id = p_team_id;
  return v_code;
end $function$;

CREATE OR REPLACE FUNCTION public.regenerate_guardian_code (
  p_player_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()) then
    raise exception 'Only a guardian can reset this code';
  end if;
  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  update player_guardian_codes set code = c, last_used_at = null where player_id = p_player_id;
  if not found then
    insert into player_guardian_codes (player_id, code) values (p_player_id, c);
  end if;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_guardian_code', 'players', p_player_id, jsonb_build_object('player_id', p_player_id));
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.regenerate_team_code (
  p_team_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can reset the team code'; end if;
  loop c := gen_join_code(6); exit when not exists (select 1 from teams where join_code = c); end loop;
  update teams set join_code = c where id = p_team_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_team_code', 'teams', p_team_id, jsonb_build_object('team_id', p_team_id));
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.release_stale_tagging_jobs()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare n integer;
begin
  update tagging_jobs set released_at=now()
   where status='review' and released_at is null
     and tagger_completed_at is not null
     and tagger_completed_at < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.remove_guardian (
  p_player_id        uuid,
  p_guardian_user_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); caller_rel text; target_rel text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select relationship into caller_rel from parent_player_links where player_id = p_player_id and parent_user_id = uid;
  select relationship into target_rel from parent_player_links where player_id = p_player_id and parent_user_id = p_guardian_user_id;
  if target_rel is null then raise exception 'That person is not a guardian of this player'; end if;

  if not (p_guardian_user_id = uid
          or (caller_rel = 'parent' and target_rel <> 'parent')) then
    raise exception 'Only the primary guardian can remove another guardian';
  end if;

  delete from parent_player_links where player_id = p_player_id and parent_user_id = p_guardian_user_id;

  -- drop their 'parent' membership on this kid's team(s) if they no longer guardian
  -- any kid there.
  delete from team_memberships tm
  where tm.user_id = p_guardian_user_id
    and tm.role = 'parent'
    and tm.team_id in (select team_id from player_teams where player_id = p_player_id)
    and not exists (
      select 1 from parent_player_links ppl2
      join player_teams pt2 on pt2.player_id = ppl2.player_id
      where ppl2.parent_user_id = p_guardian_user_id and pt2.team_id = tm.team_id
    );

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'remove_guardian', p_guardian_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'removed_user_id', p_guardian_user_id));
end $function$;

CREATE OR REPLACE FUNCTION public.remove_roster_placeholder (
  p_player_id uuid,
  p_team_id   uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Only a team coach can remove roster spots';
  end if;

  if exists (select 1 from parent_player_links where player_id = p_player_id)
     or exists (select 1 from videos where player_id = p_player_id)
     or exists (select 1 from game_lineups where player_id = p_player_id)
     or exists (select 1 from clip_tags ct join tags t on t.id = ct.tag_id
                where t.player_id = p_player_id) then
    update player_teams set left_at = now()
    where player_id = p_player_id and team_id = p_team_id and left_at is null;
    return 'left';
  end if;

  delete from player_teams where player_id = p_player_id and team_id = p_team_id;
  if not exists (select 1 from player_teams where player_id = p_player_id) then
    delete from tags where player_id = p_player_id and category = 'players';
    delete from players where id = p_player_id;
    return 'deleted';
  end if;
  return 'detached';
end $function$;

CREATE OR REPLACE FUNCTION public.remove_team_coach (
  p_team_id uuid,
  p_user_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_admin(p_team_id)) then raise exception 'not authorized'; end if;
  delete from team_memberships
   where team_id = p_team_id and user_id = p_user_id and role in ('coach','head_coach');
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_any_code (
  p_code text
)
  RETURNS json
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare c text := upper(trim(coalesce(p_code, ''))); v_team uuid; v_tname text; v_player uuid; v_pname text;
begin
  if c = '' then return json_build_object('type', null); end if;

  -- 1) Team JOIN code → join the team (roster claim)
  select id, name into v_team, v_tname from teams where upper(join_code) = c limit 1;
  if v_team is not null then
    return json_build_object('type', 'team', 'team_id', v_team, 'team_name', v_tname);
  end if;

  -- 2) Team COACH code → join as coach
  select id, name into v_team, v_tname from teams where coach_code is not null and upper(coach_code) = c limit 1;
  if v_team is not null then
    return json_build_object('type', 'coach', 'team_id', v_team, 'team_name', v_tname);
  end if;

  -- 3) Player GUARDIAN code → become a guardian of that kid
  select p.id, p.name into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c limit 1;
  if v_player is not null then
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  return json_build_object('type', null);
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_event_recipients (
  p_event_id uuid,
  p_exclude  uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    recipient_user_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select distinct uid from (
    select tm.user_id as uid
      from public.events e
      join public.team_memberships tm on tm.team_id = e.team_id and tm.status = 'confirmed'
      where e.id = p_event_id
    union
    select ppl.parent_user_id as uid
      from public.events e
      join public.players p on p.team_id = e.team_id
      join public.parent_player_links ppl on ppl.player_id = p.id and ppl.receives_logistics_alerts
      where e.id = p_event_id
  ) r
  where uid is not null and (p_exclude is null or uid <> p_exclude);
$function$;

CREATE OR REPLACE FUNCTION public.resolve_event_sms_recipients (
  p_event_id uuid,
  p_exclude  uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    recipient_user_id uuid,
    phone             text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select r.recipient_user_id, up.phone_number
  from public.resolve_event_recipients(p_event_id, p_exclude) r
  join public.user_profiles up on up.user_id = r.recipient_user_id
  where up.phone_number is not null
    and up.phone_verified_at is not null
    and up.phone_consent_at is not null
    and not exists (
      select 1 from public.sms_opt_outs o
      where o.phone_number = up.phone_number and o.opted_back_in_at is null
    );
$function$;

CREATE OR REPLACE FUNCTION public.resolve_shared_content (
  p_share_id uuid
)
  RETURNS TABLE (
    content_type     public.share_content,
    content_id       uuid,
    title            text,
    storage_path     text,
    duration_seconds numeric,
    start_time       numeric,
    end_time         numeric,
    thumbnail_path   text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); s shares%rowtype; entitled boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into s from shares where id = p_share_id;
  if not found then raise exception 'Share not found'; end if;
  entitled :=
       is_super_admin()
    or s.shared_by_user_id = uid
    or (s.audience = 'public'  and s.visible = true and s.hidden_by_family = false)
    or (s.audience = 'team'    and is_team_member(s.team_id))
    or (s.audience = 'coaches' and is_team_coach(s.team_id))
    or (s.audience = 'player'  and exists (select 1 from parent_player_links ppl
          where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid));
  if not entitled then raise exception 'Not allowed to view this share'; end if;
  if s.content_type = 'reel' then
    return query select 'reel'::share_content, hr.id, hr.name, hr.storage_path,
        hr.duration_seconds, null::numeric, null::numeric, hr.thumbnail_path
      from highlight_reels hr where hr.id = s.content_id and hr.deleted_at is null;
  elsif s.content_type = 'video' then
    return query select 'video'::share_content, v.id, v.label, v.url,
        null::numeric, null::numeric, null::numeric, v.thumbnail_path
      from videos v where v.id = s.content_id and v.deleted_at is null;
  elsif s.content_type = 'clip' then
    return query select 'clip'::share_content, c.id, v.label, v.url,
        null::numeric, c.start_time, c.end_time, v.thumbnail_path
      from clips c join videos v on v.id = c.video_id
      where c.id = s.content_id and v.deleted_at is null;
  elsif s.content_type = 'game' then
    return query select 'game'::share_content, g.id, g.title, null::text,
        null::numeric, null::numeric, null::numeric,
        (select v.thumbnail_path from videos v
         where v.game_id = g.id and v.thumbnail_path is not null and v.deleted_at is null
         order by v.sort_order nulls last limit 1)
      from games g where g.id = s.content_id and g.deleted_at is null;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_shared_game (
  p_share_id uuid
)
  RETURNS TABLE (
    video_id     uuid,
    title        text,
    storage_path text,
    sort_order   integer
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select
    v.id          as video_id,
    v.label       as title,
    v.url         as storage_path,
    v.sort_order  as sort_order
  from shares s
  join games  g on g.id = s.content_id
  join videos v on v.game_id = g.id
  where s.id = p_share_id
    and s.content_type = 'game'
    and s.hidden_by_family is not true
    and v.upload_status = 'ready'
  order by v.sort_order asc;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_team_coaches (
  p_team_id uuid
)
  RETURNS TABLE (
    recipient_user_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select distinct tm.user_id from public.team_memberships tm
  where tm.team_id = p_team_id and tm.status = 'confirmed' and tm.role in ('admin','head_coach','coach');
$function$;

CREATE OR REPLACE FUNCTION public.resolve_team_recipients (
  p_team_id uuid,
  p_exclude uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    recipient_user_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select distinct uid from (
    select tm.user_id as uid from public.team_memberships tm
      where tm.team_id = p_team_id and tm.status = 'confirmed'
    union
    select ppl.parent_user_id as uid from public.players p
      join public.parent_player_links ppl on ppl.player_id = p.id
      where p.team_id = p_team_id
  ) r
  where uid is not null and (p_exclude is null or uid <> p_exclude);
$function$;

CREATE OR REPLACE FUNCTION public.restore_game (
  p_game_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare t uuid; ev uuid;
begin
  select team_id, event_id into t, ev from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_super_admin() or is_team_admin(t)) then raise exception 'Only a team admin can restore'; end if;
  update games  set deleted_at = null where id = p_game_id;
  update videos set deleted_at = null where game_id = p_game_id;
  if ev is not null then
    update events set deleted_at = null where id = ev;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_reel (
  p_reel_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare r highlight_reels%rowtype;
begin
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if not (is_super_admin() or (r.team_id is null and r.created_by_user_id = auth.uid()) or (r.team_id is not null and is_team_admin(r.team_id)))
    then raise exception 'Not allowed to restore this reel'; end if;
  update highlight_reels set deleted_at = null where id = p_reel_id;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_video (
  p_video_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v videos%rowtype;
begin
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if not (is_super_admin() or (v.team_id is null and v.uploaded_by_user_id = auth.uid()) or (v.team_id is not null and is_team_admin(v.team_id)))
    then raise exception 'Not allowed to restore this video'; end if;
  update videos set deleted_at = null where id = p_video_id;
end $function$;

CREATE OR REPLACE FUNCTION public.revoke_guardian_seat_on_unlink()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update public.player_guardian_seats
     set revoked_at = now()
   where player_id = old.player_id
     and granted_to_user_id = old.parent_user_id
     and revoked_at is null;
  return old;
end $function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_all (
  q text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public'
  AS $function$
declare raw text := trim(coalesce(q, '')); pat text; result jsonb;
begin
  if length(raw) < 2 then
    return jsonb_build_object('players','[]'::jsonb,'teams','[]'::jsonb,'games','[]'::jsonb,'reels','[]'::jsonb);
  end if;
  pat := '%' || raw || '%';

  select jsonb_build_object(
    'players', (select coalesce(jsonb_agg(x order by (x->>'name')), '[]'::jsonb) from (
      select distinct jsonb_build_object('id', p.id, 'name', p.name) as x
      from players p
      where p.name ilike pat
         or exists (select 1 from player_teams pt where pt.player_id = p.id and pt.jersey_number = raw)
      limit 6
    ) s),
    'teams', (select coalesce(jsonb_agg(x order by (x->>'name')), '[]'::jsonb) from (
      select jsonb_build_object('id', t.id, 'name', t.name, 'logo_path', t.logo_path) as x
      from teams t where t.name ilike pat limit 6
    ) s),
    'games', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', g.id, 'title', g.title, 'opponent', g.opponent,
                                'game_date', g.game_date, 'team_id', g.team_id) as x
      from games g where g.title ilike pat or g.opponent ilike pat
      order by g.game_date desc nulls last limit 6
    ) s),
    'reels', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'name', r.name, 'storage_path', r.storage_path) as x
      from highlight_reels r where r.name ilike pat
      order by r.created_at desc limit 6
    ) s)
  ) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.set_coaches_pin (
  p_pin text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  update user_profiles
    set coaches_pin_hash = crypt(p_pin, gen_salt('bf'))
    where user_id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_game_lineup (
  p_game_id    uuid,
  p_player_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then raise exception 'Only a team coach can edit the lineup'; end if;

  delete from game_lineups
  where game_id = p_game_id and player_id <> all(coalesce(p_player_ids, '{}'::uuid[]));

  insert into game_lineups (game_id, player_id, added_by_user_id)
  select p_game_id, pid, uid
  from unnest(coalesce(p_player_ids, '{}'::uuid[])) as pid
  where exists (select 1 from player_teams pt where pt.player_id = pid and pt.team_id = t)
  on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.set_kid_photo (
  player_id  uuid,
  photo_path text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_super_admin() and not exists (
    select 1 from parent_player_links ppl
    where ppl.player_id = set_kid_photo.player_id
      and ppl.parent_user_id = uid
  ) then
    raise exception 'Not allowed to edit this player';
  end if;
  update players
    set photo_path = set_kid_photo.photo_path
    where id = set_kid_photo.player_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_display_name (
  p_name text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into user_profiles (user_id, display_name, updated_at)
  values (uid, p_name, now())
  on conflict (user_id)
  do update set display_name = excluded.display_name,
                updated_at   = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_share_note (
  p_share_id uuid,
  p_note     text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update shares set note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_share_id and shared_by_user_id = uid;
  if not found then raise exception 'Not allowed to edit this note'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_share_on_wall (
  p_share_id uuid,
  p_on_wall  boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  tgt uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select target_player_id into tgt
  from shares
  where id = p_share_id and audience = 'player';
  if tgt is null then
    raise exception 'Not a player share, or share not found';
  end if;

  if not (
    is_super_admin()
    or exists (select 1 from parent_player_links ppl
               where ppl.player_id = tgt and ppl.parent_user_id = uid)
  ) then
    raise exception 'Not allowed: only the kid''s family can change the wall';
  end if;

  update shares set on_wall = p_on_wall where id = p_share_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_team_coaches_pin_required (
  p_team_id  uuid,
  p_required boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not exists (
    select 1 from team_memberships
    where team_id = p_team_id and user_id = auth.uid()
      and role in ('admin','head_coach') and status = 'confirmed'
  ) then
    raise exception 'Only a team admin or head coach can change this';
  end if;
  update teams set require_coaches_pin = p_required where id = p_team_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_team_default_permission (
  p_team_id    uuid,
  p_permission public.team_permission,
  p_allowed    boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  insert into team_permission_defaults (team_id, permission, allowed, updated_by_user_id, updated_at)
  values (p_team_id, p_permission, p_allowed, auth.uid(), now())
  on conflict (team_id, permission) do update
    set allowed = excluded.allowed,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_team_member_permission (
  p_team_id    uuid,
  p_user_id    uuid,
  p_permission public.team_permission,
  p_allowed    boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  insert into team_member_permissions (team_id, user_id, permission, allowed, updated_by_user_id, updated_at)
  values (p_team_id, p_user_id, p_permission, p_allowed, auth.uid(), now())
  on conflict (team_id, user_id, permission) do update
    set allowed = excluded.allowed,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_team_player_permission (
  p_team_id    uuid,
  p_player_id  uuid,
  p_permission public.team_permission,
  p_allowed    boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then
    raise exception 'Only a coach or admin of this team can change permissions';
  end if;
  insert into team_player_permissions (team_id, player_id, permission, allowed, updated_by_user_id, updated_at)
  values (p_team_id, p_player_id, p_permission, p_allowed, auth.uid(), now())
  on conflict (team_id, player_id, permission) do update
    set allowed = excluded.allowed,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at;
end; $function$;

CREATE OR REPLACE FUNCTION public.sms_target (
  p_user_id uuid
)
  RETURNS TABLE (
    recipient_user_id uuid,
    phone             text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select up.user_id, up.phone_number
  from public.user_profiles up
  where up.user_id = p_user_id
    and up.phone_number is not null and up.phone_verified_at is not null and up.phone_consent_at is not null
    and not exists (select 1 from public.sms_opt_outs o where o.phone_number = up.phone_number and o.opted_back_in_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_game_lineup()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into game_lineups (game_id, player_id, added_by_user_id)
  select NEW.id, pt.player_id, auth.uid()
  from player_teams pt
  where pt.team_id = NEW.team_id and pt.left_at is null
  on conflict do nothing;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.soft_delete_reel (
  p_reel_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare r highlight_reels%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if not (
       is_super_admin()
    or (r.team_id is null and r.created_by_user_id = auth.uid())
    or (r.team_id is not null and can_delete_team_content(r.team_id))
  ) then raise exception 'Not allowed to delete this reel'; end if;
  update highlight_reels set deleted_at = now() where id = p_reel_id and deleted_at is null;
end $function$;

CREATE OR REPLACE FUNCTION public.soft_delete_video (
  p_video_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v videos%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if not (
       is_super_admin()
    or (v.team_id is null and v.uploaded_by_user_id = auth.uid())
    or (v.team_id is not null and can_delete_team_content(v.team_id))
  ) then raise exception 'Not allowed to delete this video'; end if;
  update videos set deleted_at = now() where id = p_video_id and deleted_at is null;
end $function$;

CREATE OR REPLACE FUNCTION public.storage_set_owner_from_auth()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.owner is null and auth.uid() is not null then
    new.owner := auth.uid();
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.suggest_duplicate_players (
  p_team_id uuid
)
  RETURNS TABLE (
    keep_id   uuid,
    keep_name text,
    dup_id    uuid,
    dup_name  text,
    sim       real
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not (is_team_coach(p_team_id) or is_super_admin()) then raise exception 'Not allowed'; end if;
  return query
    select pa.id, pa.name, pb.id, pb.name, similarity(pa.name, pb.name) as sim
    from player_teams ta
    join players pa on pa.id = ta.player_id
    join player_teams tb on tb.team_id = ta.team_id
    join players pb on pb.id = tb.player_id
    where ta.team_id = p_team_id
      and pa.id < pb.id
      and ( similarity(pa.name, pb.name) > 0.3
            or lower(split_part(pa.name, ' ', 1)) = lower(split_part(pb.name, ' ', 1)) )
    order by sim desc;
end $function$;

CREATE OR REPLACE FUNCTION public.sync_lineup_from_clip_tag()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_player uuid;
  v_game uuid;
begin
  -- Only player-category tags that carry a real player_id create a lineup row.
  select t.player_id into v_player
  from tags t
  where t.id = NEW.tag_id and t.category = 'players' and t.player_id is not null;
  if v_player is null then return NEW; end if;

  -- The tagged clip's video must belong to a game.
  select v.game_id into v_game
  from clips c join videos v on v.id = c.video_id
  where c.id = NEW.clip_id;
  if v_game is null then return NEW; end if;

  insert into game_lineups (game_id, player_id)
  values (v_game, v_player)
  on conflict (game_id, player_id) do nothing;

  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.tagger_complete_job (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update tagging_jobs set status='review', tagger_completed_at=now()
   where id=p_job and tagger_user_id=auth.uid() and status in ('in_progress','changes_requested');
  if not found then raise exception 'Cannot mark this job complete.'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.tagger_decline_job (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update tagging_jobs set status='declined'
   where id=p_job and tagger_user_id=auth.uid() and status='new';
  if not found then raise exception 'Cannot decline this job.'; end if;
  perform _revoke_job_grants(p_job);
end $function$;

CREATE OR REPLACE FUNCTION public.tagger_player_tags (
  p_team uuid
)
  RETURNS TABLE (
    tag_id uuid,
    label  text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not exists (
    select 1 from video_tagging_rights r join videos v on v.id = r.video_id
    where v.team_id = p_team and r.granted_to_user_id = auth.uid()
      and r.can_tag and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
      and r.names_hidden
  ) then raise exception 'not authorized'; end if;
  return query
    select t.id,
           coalesce(nullif('#' || nullif(trim(p.jersey_number::text), ''), '#'),
                    'Player ' || upper(substr(t.id::text, 1, 4))) as label
    from tags t left join players p on p.id = t.player_id
    where t.team_id = p_team and t.category = 'players';
end $function$;

CREATE OR REPLACE FUNCTION public.tagger_start_job (
  p_job uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update tagging_jobs set status='in_progress'
   where id=p_job and tagger_user_id=auth.uid() and status='new';
  if not found then raise exception 'Cannot start this job.'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_tagging_job()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$ begin new.updated_at := now(); return new; end $function$;

CREATE OR REPLACE FUNCTION public.unlink_player (
  p_player uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not public.can_link_player(p_player) then raise exception 'Not authorized'; end if;
  update public.players set player_lineage_id = id where id = p_player;
end $function$;

CREATE OR REPLACE FUNCTION public.update_kid (
  player_id  uuid,
  name       text,
  grad_class text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(name, ''));
  clean_grad text := nullif(trim(coalesce(grad_class, '')), '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if clean_name = '' then raise exception 'Kid name is required'; end if;
  if not is_super_admin() and not exists (
    select 1 from parent_player_links ppl
    where ppl.player_id = update_kid.player_id
      and ppl.parent_user_id = uid
  ) then
    raise exception 'Not allowed to edit this player';
  end if;
  update players
    set name = clean_name,
        grad_class = clean_grad
    where id = update_kid.player_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_kid_profile (
  p_player_id  uuid,
  p_name       text DEFAULT NULL::text,
  p_jersey     text DEFAULT NULL::text,
  p_grad_class text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from players where id = p_player_id;
  if not (is_linked_parent(p_player_id) or is_super_admin() or (t is not null and is_team_coach(t))) then
    raise exception 'Not allowed to edit this player';
  end if;
  update players set
    name          = coalesce(nullif(trim(p_name), ''), name),
    jersey_number = case when p_jersey is null then jersey_number else nullif(trim(p_jersey), '') end,
    grad_class    = case when p_grad_class is null then grad_class else nullif(trim(p_grad_class), '') end
  where id = p_player_id;
  update tags tg set name = case when split_part(p.name, ' ', 1) like '#%'
    then split_part(p.name, ' ', 1)
    else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(
      (select pt.jersey_number from player_teams pt where pt.player_id = tg.player_id and pt.team_id = tg.team_id limit 1)
    ), ''), '') end
  from players p
  where tg.player_id = p_player_id and tg.category = 'players' and p.id = p_player_id;
end $function$;

CREATE OR REPLACE FUNCTION public.update_series_forward (
  p_series_id     uuid,
  p_from_date     date,
  p_title         text,
  p_start_time    time without time zone,
  p_arrival_time  time without time zone,
  p_end_time      time without time zone,
  p_tz            text,
  p_venue_name    text,
  p_venue_address text,
  p_uniform       text,
  p_notes         text
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  v_count int;
begin
  update public.events e set
    title = p_title,
    starts_at   = case when p_start_time   is not null then ((e.local_date::text || ' ' || p_start_time)::timestamp   at time zone p_tz) end,
    arrival_at  = case when p_arrival_time is not null then ((e.local_date::text || ' ' || p_arrival_time)::timestamp at time zone p_tz) end,
    ends_at     = case when p_end_time     is not null then ((e.local_date::text || ' ' || p_end_time)::timestamp     at time zone p_tz) end,
    time_status = case when p_start_time is not null then 'confirmed' else 'tbd' end,
    venue_name = p_venue_name,
    venue_address = p_venue_address,
    uniform = p_uniform,
    notes = p_notes,
    event_timezone = p_tz
  where e.series_id = p_series_id
    and e.local_date >= p_from_date
    and e.status = 'scheduled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_coaches_pin (
  p_pin text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
declare h text;
begin
  select coaches_pin_hash into h from user_profiles where user_id = auth.uid();
  if h is null then return false; end if;
  return h = crypt(p_pin, h);
end $function$;

ALTER TABLE "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."clips"
  ADD CONSTRAINT "clips_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."clip_football"
  ADD CONSTRAINT "clip_football_clip_id_fkey" FOREIGN KEY (clip_id) REFERENCES public.clips(id) ON DELETE CASCADE;

ALTER TABLE "public"."clip_tags"
  ADD CONSTRAINT "clip_tags_clip_id_fkey" FOREIGN KEY (clip_id) REFERENCES public.clips(id) ON DELETE CASCADE;

ALTER TABLE "public"."content_reports"
  ADD CONSTRAINT "content_reports_reporter_user_id_fkey" FOREIGN KEY (reporter_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."content_reports"
  ADD CONSTRAINT "content_reports_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."device_push_tokens"
  ADD CONSTRAINT "device_push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_attendance"
  ADD CONSTRAINT "event_attendance_responder_user_id_fkey" FOREIGN KEY (responder_user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."event_snack_signups"
  ADD CONSTRAINT "event_snack_signups_claimed_by_user_id_fkey" FOREIGN KEY (claimed_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."event_attendance"
  ADD CONSTRAINT "event_attendance_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_snack_signups"
  ADD CONSTRAINT "event_snack_signups_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."followers"
  ADD CONSTRAINT "followers_approved_by_user_id_fkey" FOREIGN KEY (approved_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."followers"
  ADD CONSTRAINT "followers_follower_user_id_fkey" FOREIGN KEY (follower_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."followers"
  ADD CONSTRAINT "followers_follower_user_id_scope_team_id_player_id_key" UNIQUE (follower_user_id, scope, team_id, player_id);

ALTER TABLE "public"."game_lineups"
  ADD CONSTRAINT "game_lineups_added_by_user_id_fkey" FOREIGN KEY (added_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."game_stat_lines"
  ADD CONSTRAINT "game_stat_lines_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

ALTER TABLE "public"."game_lineups"
  ADD CONSTRAINT "game_lineups_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE RESTRICT;

ALTER TABLE "public"."game_stat_lines"
  ADD CONSTRAINT "game_stat_lines_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."highlight_reels"
  ADD CONSTRAINT "highlight_reels_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."install_receipts"
  ADD CONSTRAINT "install_receipts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."installs"
  ADD CONSTRAINT "installs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."install_plays"
  ADD CONSTRAINT "install_plays_install_id_fkey" FOREIGN KEY (install_id) REFERENCES public.installs(id) ON DELETE CASCADE;

ALTER TABLE "public"."install_receipts"
  ADD CONSTRAINT "install_receipts_install_id_fkey" FOREIGN KEY (install_id) REFERENCES public.installs(id) ON DELETE CASCADE;

ALTER TABLE "public"."library_plays"
  ADD CONSTRAINT "library_plays_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE "public"."notification_outbox"
  ADD CONSTRAINT "notification_outbox_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."notification_outbox"
  ADD CONSTRAINT "notification_outbox_message_id_fkey" FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."parent_player_links"
  ADD CONSTRAINT "parent_player_links_parent_user_id_fkey" FOREIGN KEY (parent_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."phone_verifications"
  ADD CONSTRAINT "phone_verifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."play_clips"
  ADD CONSTRAINT "play_clips_clip_id_fkey" FOREIGN KEY (clip_id) REFERENCES public.clips(id) ON DELETE CASCADE;

ALTER TABLE "public"."play_clips"
  ADD CONSTRAINT "play_clips_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."play_versions"
  ADD CONSTRAINT "play_versions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."install_plays"
  ADD CONSTRAINT "install_plays_play_id_play_version_fkey" FOREIGN KEY (play_id, play_version) REFERENCES public.play_versions(play_id, VERSION) ON DELETE RESTRICT;

ALTER TABLE "public"."play_clips"
  ADD CONSTRAINT "play_clips_play_id_play_version_fkey" FOREIGN KEY (play_id, play_version) REFERENCES public.play_versions(play_id, VERSION) ON DELETE CASCADE;

ALTER TABLE "public"."player_guardian_seats"
  ADD CONSTRAINT "player_guardian_seats_granted_by_user_id_fkey" FOREIGN KEY (granted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."player_guardian_seats"
  ADD CONSTRAINT "player_guardian_seats_granted_to_user_id_fkey" FOREIGN KEY (granted_to_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."player_teams"
  ADD CONSTRAINT "player_teams_added_by_user_id_fkey" FOREIGN KEY (added_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."event_attendance"
  ADD CONSTRAINT "event_attendance_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_snack_signups"
  ADD CONSTRAINT "event_snack_signups_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE "public"."followers"
  ADD CONSTRAINT "followers_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_lineups"
  ADD CONSTRAINT "game_lineups_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE "public"."game_stat_lines"
  ADD CONSTRAINT "game_stat_lines_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_target_player_id_fkey" FOREIGN KEY (target_player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."parent_player_links"
  ADD CONSTRAINT "parent_player_links_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE RESTRICT;

ALTER TABLE "public"."player_guardian_codes"
  ADD CONSTRAINT "player_guardian_codes_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."player_guardian_seats"
  ADD CONSTRAINT "player_guardian_seats_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."player_teams"
  ADD CONSTRAINT "player_teams_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."plays"
  ADD CONSTRAINT "plays_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."plays"
  ADD CONSTRAINT "plays_library_play_id_fkey" FOREIGN KEY (library_play_id) REFERENCES public.library_plays(id) ON DELETE SET NULL;

ALTER TABLE "public"."install_receipts"
  ADD CONSTRAINT "install_receipts_play_id_fkey" FOREIGN KEY (play_id) REFERENCES public.plays(id) ON DELETE SET NULL;

ALTER TABLE "public"."play_versions"
  ADD CONSTRAINT "play_versions_play_id_fkey" FOREIGN KEY (play_id) REFERENCES public.plays(id) ON DELETE CASCADE;

ALTER TABLE "public"."reel_tags"
  ADD CONSTRAINT "reel_tags_reel_id_fkey" FOREIGN KEY (reel_id) REFERENCES public.highlight_reels(id) ON DELETE CASCADE;

ALTER TABLE "public"."saved_items"
  ADD CONSTRAINT "saved_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."schedule_import_log"
  ADD CONSTRAINT "schedule_import_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."schedule_notifications"
  ADD CONSTRAINT "schedule_notifications_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."seasons"
  ADD CONSTRAINT "seasons_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE "public"."highlight_reels"
  ADD CONSTRAINT "highlight_reels_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE "public"."players"
  ADD CONSTRAINT "players_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE "public"."share_comments"
  ADD CONSTRAINT "share_comments_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."shares"
  ADD CONSTRAINT "shares_content_audience_player_sharer_team_key" UNIQUE (content_type, content_id, audience, target_player_id, shared_by_user_id, team_id);

ALTER TABLE "public"."content_reports"
  ADD CONSTRAINT "content_reports_share_id_fkey" FOREIGN KEY (share_id) REFERENCES public.shares(id) ON DELETE SET NULL;

ALTER TABLE "public"."saved_items"
  ADD CONSTRAINT "saved_items_share_id_fkey" FOREIGN KEY (share_id) REFERENCES public.shares(id) ON DELETE CASCADE;

ALTER TABLE "public"."share_comments"
  ADD CONSTRAINT "share_comments_share_id_fkey" FOREIGN KEY (share_id) REFERENCES public.shares(id) ON DELETE CASCADE;

ALTER TABLE "public"."shares"
  ADD CONSTRAINT "shares_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE "public"."shares"
  ADD CONSTRAINT "shares_shared_by_user_id_fkey" FOREIGN KEY (shared_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."shares"
  ADD CONSTRAINT "shares_target_player_id_fkey" FOREIGN KEY (target_player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."super_admins"
  ADD CONSTRAINT "super_admins_acting_as_user_id_fkey" FOREIGN KEY (acting_as_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."super_admins"
  ADD CONSTRAINT "super_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagger_links"
  ADD CONSTRAINT "tagger_links_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagger_links"
  ADD CONSTRAINT "tagger_links_tagger_user_id_fkey" FOREIGN KEY (tagger_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagging_job_messages"
  ADD CONSTRAINT "tagging_job_messages_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagging_jobs"
  ADD CONSTRAINT "tagging_jobs_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagging_job_messages"
  ADD CONSTRAINT "tagging_job_messages_job_id_fkey" FOREIGN KEY (job_id) REFERENCES public.tagging_jobs(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagging_jobs"
  ADD CONSTRAINT "tagging_jobs_requester_user_id_fkey" FOREIGN KEY (requester_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagging_jobs"
  ADD CONSTRAINT "tagging_jobs_tagger_user_id_fkey" FOREIGN KEY (tagger_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."tags"
  ADD CONSTRAINT "tags_check" CHECK ((((scope = 'global'::public.tag_scope) AND (team_id IS NULL)) OR ((scope = 'team'::public.tag_scope) AND (team_id IS NOT NULL))));

ALTER TABLE "public"."clip_tags"
  ADD CONSTRAINT "clip_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

ALTER TABLE "public"."reel_tags"
  ADD CONSTRAINT "reel_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

ALTER TABLE "public"."tags"
  ADD CONSTRAINT "tags_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE "public"."team_hidden_tags"
  ADD CONSTRAINT "team_hidden_tags_hidden_by_fkey" FOREIGN KEY (hidden_by) REFERENCES auth.users(id);

ALTER TABLE "public"."team_hidden_tags"
  ADD CONSTRAINT "team_hidden_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_member_permissions"
  ADD CONSTRAINT "team_member_permissions_pkey" PRIMARY KEY (team_id, user_id, permission);

ALTER TABLE "public"."team_member_permissions"
  ADD CONSTRAINT "team_member_permissions_updated_by_user_id_fkey" FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."team_member_permissions"
  ADD CONSTRAINT "team_member_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_memberships"
  ADD CONSTRAINT "team_memberships_invited_by_user_id_fkey" FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."team_memberships"
  ADD CONSTRAINT "team_memberships_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_memberships"
  ADD CONSTRAINT "team_memberships_team_id_user_id_role_key" UNIQUE (team_id, user_id, ROLE);

ALTER TABLE "public"."team_memberships"
  ADD CONSTRAINT "team_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_permission_defaults"
  ADD CONSTRAINT "team_permission_defaults_pkey" PRIMARY KEY (team_id, permission);

ALTER TABLE "public"."team_permission_defaults"
  ADD CONSTRAINT "team_permission_defaults_updated_by_user_id_fkey" FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."team_player_permissions"
  ADD CONSTRAINT "team_player_permissions_pkey" PRIMARY KEY (team_id, player_id, permission);

ALTER TABLE "public"."team_player_permissions"
  ADD CONSTRAINT "team_player_permissions_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_player_permissions"
  ADD CONSTRAINT "team_player_permissions_updated_by_user_id_fkey" FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."teams"
  ADD CONSTRAINT "teams_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."clips"
  ADD CONSTRAINT "clips_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."followers"
  ADD CONSTRAINT "followers_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."highlight_reels"
  ADD CONSTRAINT "highlight_reels_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."installs"
  ADD CONSTRAINT "installs_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."play_clips"
  ADD CONSTRAINT "play_clips_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."player_teams"
  ADD CONSTRAINT "player_teams_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."players"
  ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."plays"
  ADD CONSTRAINT "plays_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."seasons"
  ADD CONSTRAINT "seasons_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."shares"
  ADD CONSTRAINT "shares_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."tagging_jobs"
  ADD CONSTRAINT "tagging_jobs_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."tags"
  ADD CONSTRAINT "tags_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_hidden_tags"
  ADD CONSTRAINT "team_hidden_tags_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_member_permissions"
  ADD CONSTRAINT "team_member_permissions_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_memberships"
  ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_permission_defaults"
  ADD CONSTRAINT "team_permission_defaults_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_player_permissions"
  ADD CONSTRAINT "team_player_permissions_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."tournaments"
  ADD CONSTRAINT "tournaments_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_tournament_id_fkey" FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE SET NULL;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_tournament_id_fkey" FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE SET NULL;

ALTER TABLE "public"."tournaments"
  ADD CONSTRAINT "tournaments_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_blocks"
  ADD CONSTRAINT "user_blocks_blocked_user_id_fkey" FOREIGN KEY (blocked_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_blocks"
  ADD CONSTRAINT "user_blocks_blocker_user_id_fkey" FOREIGN KEY (blocker_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."video_tagging_rights"
  ADD CONSTRAINT "video_tagging_rights_granted_by_user_id_fkey" FOREIGN KEY (granted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."video_tagging_rights"
  ADD CONSTRAINT "video_tagging_rights_granted_to_user_id_fkey" FOREIGN KEY (granted_to_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."videos"
  ADD CONSTRAINT "videos_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."clips"
  ADD CONSTRAINT "clips_video_id_fkey" FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

ALTER TABLE "public"."video_tagging_rights"
  ADD CONSTRAINT "video_tagging_rights_video_id_fkey" FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

ALTER TABLE "public"."videos"
  ADD CONSTRAINT "videos_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE "public"."videos"
  ADD CONSTRAINT "videos_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE "public"."videos"
  ADD CONSTRAINT "videos_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."videos"
  ADD CONSTRAINT "videos_uploaded_by_user_id_fkey" FOREIGN KEY (uploaded_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE VIEW "public"."stat_events" WITH (security_invoker=on) AS  WITH bundle_player AS (
         SELECT ct.clip_id,
            ct.bundle_number,
            t.name AS player_name,
            t.player_id
           FROM (public.clip_tags ct
             JOIN public.tags t ON ((t.id = ct.tag_id)))
          WHERE ((ct.bundle_number >= 1) AND (t.category = 'players'::text))
        ), bundle_stat AS (
         SELECT DISTINCT ct.clip_id,
            ct.bundle_number,
            t.stat_primitive,
            t.stat_side
           FROM (public.clip_tags ct
             JOIN public.tags t ON ((t.id = ct.tag_id)))
          WHERE ((ct.bundle_number >= 1) AND (t.stat_primitive IS NOT NULL))
        )
 SELECT bs.clip_id,
    bs.bundle_number,
    bp.player_name,
    bs.stat_primitive,
    bs.stat_side,
    (bp.player_name IS NULL) AS is_team_stat,
    bp.player_id
   FROM (bundle_stat bs
     LEFT JOIN bundle_player bp ON (((bp.clip_id = bs.clip_id) AND (bp.bundle_number = bs.bundle_number))));

CREATE VIEW "public"."game_box_score" WITH (security_invoker=on) AS  SELECT v.game_id,
    COALESCE(se.player_name, 'TEAM'::text) AS player,
    se.stat_side,
    count(*) FILTER (WHERE (se.stat_primitive = 'made_2'::text)) AS fgm_2,
    count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_2'::text, 'missed_2'::text]))) AS fga_2,
    count(*) FILTER (WHERE (se.stat_primitive = 'made_3'::text)) AS fgm_3,
    count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_3'::text, 'missed_3'::text]))) AS fga_3,
    count(*) FILTER (WHERE (se.stat_primitive = 'made_ft'::text)) AS ftm,
    count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_ft'::text, 'missed_ft'::text]))) AS fta,
    (((count(*) FILTER (WHERE (se.stat_primitive = 'made_2'::text)) * 2) + (count(*) FILTER (WHERE (se.stat_primitive = 'made_3'::text)) * 3)) + count(*) FILTER (WHERE (se.stat_primitive = 'made_ft'::text))) AS pts,
    count(*) FILTER (WHERE (se.stat_primitive = 'off_reb'::text)) AS oreb,
    count(*) FILTER (WHERE (se.stat_primitive = 'def_reb'::text)) AS dreb,
    count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['off_reb'::text, 'def_reb'::text]))) AS reb,
    count(*) FILTER (WHERE (se.stat_primitive = 'assist'::text)) AS ast,
    count(*) FILTER (WHERE (se.stat_primitive = 'steal'::text)) AS stl,
    count(*) FILTER (WHERE (se.stat_primitive = 'block'::text)) AS blk,
    count(*) FILTER (WHERE (se.stat_primitive = 'turnover'::text)) AS tov,
    count(*) FILTER (WHERE (se.stat_primitive = 'foul'::text)) AS pf,
    count(*) FILTER (WHERE (se.stat_primitive = 'technical'::text)) AS tf,
    se.player_id
   FROM ((public.stat_events se
     JOIN public.clips c ON ((c.id = se.clip_id)))
     JOIN public.videos v ON ((v.id = c.video_id)))
  WHERE (v.game_id IS NOT NULL)
  GROUP BY v.game_id, se.player_id, COALESCE(se.player_name, 'TEAM'::text), se.stat_side;

CREATE VIEW "public"."resolved_game_stats" WITH (security_invoker=on) AS  WITH manual AS (
         SELECT gsl.game_id,
            gsl.player_id,
            COALESCE(p.name, 'TEAM'::text) AS player_name,
            gsl.stat_side,
            gsl.fgm,
            gsl.fga,
            gsl.fg3m,
            gsl.fg3a,
            gsl.ftm,
            gsl.fta,
            gsl.oreb,
            gsl.dreb,
            (gsl.oreb + gsl.dreb) AS reb,
            gsl.ast,
            gsl.tov,
            gsl.stl,
            gsl.blk,
            gsl.pf,
            gsl.tf,
            (((2 * (gsl.fgm - gsl.fg3m)) + (3 * gsl.fg3m)) + gsl.ftm) AS pts,
            'manual'::text AS source
           FROM (public.game_stat_lines gsl
             LEFT JOIN public.players p ON ((p.id = gsl.player_id)))
        ), derived AS (
         SELECT gbs.game_id,
            gbs.player_id,
            gbs.player AS player_name,
            gbs.stat_side,
            (gbs.fgm_2 + gbs.fgm_3) AS fgm,
            (gbs.fga_2 + gbs.fga_3) AS fga,
            gbs.fgm_3 AS fg3m,
            gbs.fga_3 AS fg3a,
            gbs.ftm,
            gbs.fta,
            gbs.oreb,
            gbs.dreb,
            gbs.reb,
            gbs.ast,
            gbs.tov,
            gbs.stl,
            gbs.blk,
            gbs.pf,
            gbs.tf,
            gbs.pts,
            'tagged'::text AS source
           FROM public.game_box_score gbs
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM manual m
                  WHERE ((m.game_id = gbs.game_id) AND (m.stat_side = gbs.stat_side) AND (NOT (m.player_id IS DISTINCT FROM gbs.player_id))))))
        )
 SELECT manual.game_id,
    manual.player_id,
    manual.player_name,
    manual.stat_side,
    manual.fgm,
    manual.fga,
    manual.fg3m,
    manual.fg3a,
    manual.ftm,
    manual.fta,
    manual.oreb,
    manual.dreb,
    manual.reb,
    manual.ast,
    manual.tov,
    manual.stl,
    manual.blk,
    manual.pf,
    manual.tf,
    manual.pts,
    manual.source
   FROM manual
UNION ALL
 SELECT derived.game_id,
    derived.player_id,
    derived.player_name,
    derived.stat_side,
    derived.fgm,
    derived.fga,
    derived.fg3m,
    derived.fg3a,
    derived.ftm,
    derived.fta,
    derived.oreb,
    derived.dreb,
    derived.reb,
    derived.ast,
    derived.tov,
    derived.stl,
    derived.blk,
    derived.pf,
    derived.tf,
    derived.pts,
    derived.source
   FROM derived;

CREATE VIEW "public"."season_player_stats" WITH (security_invoker=on) AS  WITH gs AS (
         SELECT g.id AS game_id,
            g.season_id
           FROM public.games g
          WHERE (g.season_id IS NOT NULL)
        ), ev AS (
         SELECT gs.season_id,
            COALESCE(se.player_name, 'TEAM'::text) AS player,
            se.stat_primitive
           FROM (((public.stat_events se
             JOIN public.clips c ON ((c.id = se.clip_id)))
             JOIN public.videos v ON ((v.id = c.video_id)))
             JOIN gs ON ((gs.game_id = v.game_id)))
          WHERE (se.stat_side = 'own'::text)
        ), agg AS (
         SELECT ev.season_id,
            ev.player,
            count(*) FILTER (WHERE (ev.stat_primitive = ANY (ARRAY['made_2'::text, 'made_3'::text]))) AS fgm,
            count(*) FILTER (WHERE (ev.stat_primitive = ANY (ARRAY['made_2'::text, 'made_3'::text, 'missed_2'::text, 'missed_3'::text]))) AS fga,
            count(*) FILTER (WHERE (ev.stat_primitive = 'made_3'::text)) AS fg3m,
            count(*) FILTER (WHERE (ev.stat_primitive = ANY (ARRAY['made_3'::text, 'missed_3'::text]))) AS fg3a,
            count(*) FILTER (WHERE (ev.stat_primitive = 'made_ft'::text)) AS ftm,
            count(*) FILTER (WHERE (ev.stat_primitive = ANY (ARRAY['made_ft'::text, 'missed_ft'::text]))) AS fta,
            count(*) FILTER (WHERE (ev.stat_primitive = 'off_reb'::text)) AS oreb,
            count(*) FILTER (WHERE (ev.stat_primitive = 'def_reb'::text)) AS dreb,
            count(*) FILTER (WHERE (ev.stat_primitive = 'assist'::text)) AS ast,
            count(*) FILTER (WHERE (ev.stat_primitive = 'turnover'::text)) AS tov,
            count(*) FILTER (WHERE (ev.stat_primitive = 'steal'::text)) AS stl,
            count(*) FILTER (WHERE (ev.stat_primitive = 'block'::text)) AS blk,
            count(*) FILTER (WHERE (ev.stat_primitive = 'foul'::text)) AS pf,
            count(*) FILTER (WHERE (ev.stat_primitive = 'technical'::text)) AS tf,
            (((count(*) FILTER (WHERE (ev.stat_primitive = 'made_2'::text)) * 2) + (count(*) FILTER (WHERE (ev.stat_primitive = 'made_3'::text)) * 3)) + count(*) FILTER (WHERE (ev.stat_primitive = 'made_ft'::text))) AS pts
           FROM ev
          GROUP BY ev.season_id, ev.player
        ), gp AS (
         SELECT gs.season_id,
            p.name AS player,
            count(DISTINCT gl.game_id) AS gp
           FROM ((public.game_lineups gl
             JOIN gs ON ((gs.game_id = gl.game_id)))
             JOIN public.players p ON ((p.id = gl.player_id)))
          GROUP BY gs.season_id, p.name
        )
 SELECT a.season_id,
    a.player,
    gp.gp,
    a.fgm,
    a.fga,
    round(((100.0 * (a.fgm)::numeric) / (NULLIF(a.fga, 0))::numeric), 1) AS fg_pct,
    a.fg3m,
    a.fg3a,
    round(((100.0 * (a.fg3m)::numeric) / (NULLIF(a.fg3a, 0))::numeric), 1) AS fg3_pct,
    a.ftm,
    a.fta,
    round(((100.0 * (a.ftm)::numeric) / (NULLIF(a.fta, 0))::numeric), 1) AS ft_pct,
    a.oreb,
    a.dreb,
    (a.oreb + a.dreb) AS reb,
    round(((1.0 * ((a.oreb + a.dreb))::numeric) / (NULLIF(gp.gp, 0))::numeric), 1) AS reb_avg,
    a.ast,
    a.tov,
    a.stl,
    a.blk,
    a.pf,
    a.tf,
    a.pts,
    round(((1.0 * (a.pts)::numeric) / (NULLIF(gp.gp, 0))::numeric), 1) AS ppg
   FROM (agg a
     LEFT JOIN gp ON (((gp.season_id = a.season_id) AND (gp.player = a.player))));

CREATE VIEW "public"."season_team_stats" WITH (security_invoker=on) AS  SELECT season_id,
    team_id,
        CASE
            WHEN (stat_side = 'own'::text) THEN 'TOTAL'::text
            ELSE 'OPPONENT'::text
        END AS side,
    gp,
    fgm,
    fga,
    fg3m,
    fg3a,
    ftm,
    fta,
    oreb,
    dreb,
    ast,
    tov,
    stl,
    blk,
    pf,
    pts
   FROM ( SELECT g.season_id,
            g.team_id,
            se.stat_side,
            count(DISTINCT g.id) AS gp,
            count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_2'::text, 'made_3'::text]))) AS fgm,
            count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_2'::text, 'made_3'::text, 'missed_2'::text, 'missed_3'::text]))) AS fga,
            count(*) FILTER (WHERE (se.stat_primitive = 'made_3'::text)) AS fg3m,
            count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_3'::text, 'missed_3'::text]))) AS fg3a,
            count(*) FILTER (WHERE (se.stat_primitive = 'made_ft'::text)) AS ftm,
            count(*) FILTER (WHERE (se.stat_primitive = ANY (ARRAY['made_ft'::text, 'missed_ft'::text]))) AS fta,
            count(*) FILTER (WHERE (se.stat_primitive = 'off_reb'::text)) AS oreb,
            count(*) FILTER (WHERE (se.stat_primitive = 'def_reb'::text)) AS dreb,
            count(*) FILTER (WHERE (se.stat_primitive = 'assist'::text)) AS ast,
            count(*) FILTER (WHERE (se.stat_primitive = 'turnover'::text)) AS tov,
            count(*) FILTER (WHERE (se.stat_primitive = 'steal'::text)) AS stl,
            count(*) FILTER (WHERE (se.stat_primitive = 'block'::text)) AS blk,
            count(*) FILTER (WHERE (se.stat_primitive = 'foul'::text)) AS pf,
            (((count(*) FILTER (WHERE (se.stat_primitive = 'made_2'::text)) * 2) + (count(*) FILTER (WHERE (se.stat_primitive = 'made_3'::text)) * 3)) + count(*) FILTER (WHERE (se.stat_primitive = 'made_ft'::text))) AS pts
           FROM (((public.stat_events se
             JOIN public.clips c ON ((c.id = se.clip_id)))
             JOIN public.videos v ON ((v.id = c.video_id)))
             JOIN public.games g ON ((g.id = v.game_id)))
          WHERE (g.season_id IS NOT NULL)
          GROUP BY g.season_id, g.team_id, se.stat_side) x;

CREATE INDEX device_push_tokens_user_idx ON public.device_push_tokens USING btree (user_id);

CREATE INDEX event_attendance_event_idx ON public.event_attendance USING btree (event_id);

CREATE INDEX event_attendance_player_idx ON public.event_attendance USING btree (player_id);

CREATE INDEX event_snack_signups_team_idx ON public.event_snack_signups USING btree (team_id);

CREATE INDEX events_live_by_team_date_idx ON public.events USING btree (team_id, local_date)
  WHERE (deleted_at IS NULL);

CREATE INDEX events_team_date_idx ON public.events USING btree (team_id, local_date);

CREATE INDEX events_team_status_idx ON public.events USING btree (team_id, status);

CREATE INDEX events_tournament_idx ON public.events USING btree (tournament_id)
  WHERE (tournament_id IS NOT NULL);

CREATE UNIQUE INDEX game_stat_lines_player_uniq ON public.game_stat_lines USING btree (game_id, player_id, stat_side)
  WHERE (player_id IS NOT NULL);

CREATE UNIQUE INDEX game_stat_lines_team_uniq ON public.game_stat_lines USING btree (game_id, stat_side)
  WHERE (player_id IS NULL);

CREATE INDEX games_deleted_at_idx ON public.games USING btree (deleted_at)
  WHERE (deleted_at IS NOT NULL);

CREATE INDEX highlight_reels_deleted_at_idx ON public.highlight_reels USING btree (deleted_at)
  WHERE (deleted_at IS NOT NULL);

CREATE INDEX idx_admin_audit_log_actor ON public.admin_audit_log USING btree (actor_user_id);

CREATE INDEX idx_admin_audit_log_created ON public.admin_audit_log USING btree (created_at);

CREATE INDEX idx_admin_audit_log_target ON public.admin_audit_log USING btree (target_user_id);

CREATE INDEX idx_clip_tags_tag ON public.clip_tags USING btree (tag_id);

CREATE INDEX idx_clips_created_by ON public.clips USING btree (created_by_user_id);

CREATE INDEX idx_clips_team ON public.clips USING btree (team_id);

CREATE INDEX idx_clips_video ON public.clips USING btree (video_id);

CREATE INDEX idx_content_reports_status ON public.content_reports USING btree (status);

CREATE INDEX idx_followers_player ON public.followers USING btree (player_id);

CREATE INDEX idx_followers_team ON public.followers USING btree (team_id);

CREATE INDEX idx_followers_user ON public.followers USING btree (follower_user_id);

CREATE INDEX idx_game_lineups_player ON public.game_lineups USING btree (player_id);

CREATE INDEX idx_game_stat_lines_game ON public.game_stat_lines USING btree (game_id);

CREATE INDEX idx_game_stat_lines_player ON public.game_stat_lines USING btree (player_id);

CREATE INDEX idx_games_season ON public.games USING btree (season_id);

CREATE INDEX idx_games_team_date ON public.games USING btree (team_id, game_date);

CREATE INDEX idx_games_team ON public.games USING btree (team_id);

CREATE INDEX idx_games_tournament ON public.games USING btree (tournament_id);

CREATE INDEX idx_highlight_reels_season ON public.highlight_reels USING btree (season_id);

CREATE INDEX idx_highlight_reels_team ON public.highlight_reels USING btree (team_id);

CREATE INDEX idx_memberships_season ON public.team_memberships USING btree (season_id);

CREATE INDEX idx_memberships_team ON public.team_memberships USING btree (team_id);

CREATE INDEX idx_memberships_user ON public.team_memberships USING btree (user_id);

CREATE INDEX idx_notifications_recipient ON public.notifications USING btree (recipient_user_id, created_at DESC);

CREATE INDEX idx_parent_player_parent ON public.parent_player_links USING btree (parent_user_id);

CREATE INDEX idx_parent_player_player ON public.parent_player_links USING btree (player_id);

CREATE INDEX idx_player_teams_player ON public.player_teams USING btree (player_id);

CREATE INDEX idx_player_teams_team ON public.player_teams USING btree (team_id);

CREATE INDEX idx_players_lineage ON public.players USING btree (player_lineage_id);

CREATE INDEX idx_players_season ON public.players USING btree (season_id);

CREATE INDEX idx_players_team ON public.players USING btree (team_id);

CREATE INDEX idx_reel_tags_tag ON public.reel_tags USING btree (tag_id);

CREATE INDEX idx_saved_items_user ON public.saved_items USING btree (user_id);

CREATE INDEX idx_seasons_team ON public.seasons USING btree (team_id);

CREATE INDEX idx_share_comments_share ON public.share_comments USING btree (share_id, created_at);

CREATE INDEX idx_shares_audience ON public.shares USING btree (audience);

CREATE INDEX idx_shares_content ON public.shares USING btree (content_type, content_id);

CREATE INDEX idx_shares_target_player ON public.shares USING btree (target_player_id);

CREATE INDEX idx_tags_team ON public.tags USING btree (team_id);

CREATE INDEX idx_teams_created_by ON public.teams USING btree (created_by_user_id);

CREATE INDEX idx_tmp_team ON public.team_member_permissions USING btree (team_id);

CREATE INDEX idx_tournaments_team ON public.tournaments USING btree (team_id);

CREATE INDEX idx_tpp_team ON public.team_player_permissions USING btree (team_id);

CREATE INDEX idx_video_tagging_rights_user ON public.video_tagging_rights USING btree (granted_to_user_id);

CREATE INDEX idx_video_tagging_rights_video ON public.video_tagging_rights USING btree (video_id);

CREATE INDEX idx_videos_game ON public.videos USING btree (game_id);

CREATE INDEX idx_videos_player ON public.videos USING btree (player_id);

CREATE INDEX idx_videos_season ON public.videos USING btree (season_id);

CREATE INDEX idx_videos_team ON public.videos USING btree (team_id);

CREATE INDEX idx_videos_uploaded_by ON public.videos USING btree (uploaded_by_user_id);

CREATE INDEX install_plays_install_idx ON public.install_plays USING btree (install_id);

CREATE INDEX install_plays_play_idx ON public.install_plays USING btree (play_id, play_version);

CREATE INDEX install_receipts_install_idx ON public.install_receipts USING btree (install_id);

CREATE INDEX install_receipts_user_idx ON public.install_receipts USING btree (user_id);

CREATE INDEX installs_team_idx ON public.installs USING btree (team_id);

CREATE INDEX library_plays_community_idx ON public.library_plays USING btree (sport, save_count DESC)
  WHERE (visibility = 'community'::text);

CREATE INDEX library_plays_owner_idx ON public.library_plays USING btree (owner_user_id);

CREATE INDEX library_plays_tags_idx ON public.library_plays USING gin (tags);

CREATE INDEX messages_event_idx ON public.messages USING btree (event_id)
  WHERE (event_id IS NOT NULL);

CREATE INDEX messages_parent_idx ON public.messages USING btree (parent_id)
  WHERE (parent_id IS NOT NULL);

CREATE INDEX messages_team_created_idx ON public.messages USING btree (team_id, created_at DESC);

CREATE INDEX notification_outbox_due_idx ON public.notification_outbox USING btree (dispatch_after)
  WHERE (processed_at IS NULL);

CREATE UNIQUE INDEX notification_outbox_one_pending ON public.notification_outbox USING btree (event_id, change_kind)
  WHERE (processed_at IS NULL);

CREATE INDEX play_clips_clip_idx ON public.play_clips USING btree (clip_id);

CREATE INDEX play_clips_play_idx ON public.play_clips USING btree (play_id, play_version);

CREATE INDEX play_clips_team_idx ON public.play_clips USING btree (team_id);

CREATE INDEX play_versions_play_idx ON public.play_versions USING btree (play_id);

CREATE UNIQUE INDEX player_guardian_seats_live_key ON public.player_guardian_seats USING btree (player_id, granted_to_user_id)
  WHERE (revoked_at IS NULL);

CREATE INDEX player_guardian_seats_player_idx ON public.player_guardian_seats USING btree (player_id)
  WHERE (revoked_at IS NULL);

CREATE INDEX plays_library_idx ON public.plays USING btree (library_play_id);

CREATE INDEX plays_tags_idx ON public.plays USING gin (tags);

CREATE INDEX plays_team_idx ON public.plays USING btree (team_id);

CREATE INDEX schedule_import_log_user_day_idx ON public.schedule_import_log USING btree (user_id, created_at);

CREATE INDEX schedule_notifications_due_idx ON public.schedule_notifications USING btree (send_after)
  WHERE (status = 'queued'::text);

CREATE INDEX schedule_notifications_event_idx ON public.schedule_notifications USING btree (event_id);

CREATE INDEX tagging_job_messages_idx ON public.tagging_job_messages USING btree (job_id, created_at);

CREATE INDEX tagging_jobs_game_idx ON public.tagging_jobs USING btree (game_id);

CREATE INDEX tagging_jobs_requester_idx ON public.tagging_jobs USING btree (requester_user_id, status);

CREATE INDEX tagging_jobs_tagger_idx ON public.tagging_jobs USING btree (tagger_user_id, status);

CREATE INDEX team_hidden_tags_team_idx ON public.team_hidden_tags USING btree (team_id);

CREATE UNIQUE INDEX teams_ics_token_key ON public.teams USING btree (ics_token);

CREATE UNIQUE INDEX teams_join_code_key ON public.teams USING btree (join_code)
  WHERE (join_code IS NOT NULL);

CREATE UNIQUE INDEX uq_tags_team_player ON public.tags USING btree (team_id, player_id)
  WHERE ((category = 'players'::text) AND (player_id IS NOT NULL));

CREATE INDEX videos_deleted_at_idx ON public.videos USING btree (deleted_at)
  WHERE (deleted_at IS NOT NULL);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_user_profile();

CREATE TRIGGER trg_sync_lineup_from_clip_tag
  AFTER INSERT ON public.clip_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lineup_from_clip_tag();

CREATE TRIGGER events_enqueue_notification
  AFTER INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_event_notification();

CREATE TRIGGER events_touch
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_event();

CREATE TRIGGER trg_game_stat_lines_updated_at
  BEFORE UPDATE ON public.game_stat_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.game_stat_lines_touch_updated_at();

CREATE TRIGGER on_games_insert
  AFTER INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_game_lineup();

CREATE TRIGGER messages_enqueue_notification
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_message_notification();

CREATE TRIGGER trg_revoke_guardian_seat
  AFTER DELETE ON public.parent_player_links
  FOR EACH ROW
  EXECUTE FUNCTION public.revoke_guardian_seat_on_unlink();

CREATE TRIGGER on_player_teams_insert
  AFTER INSERT ON public.player_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_player_tag();

CREATE TRIGGER on_share_comment_insert
  AFTER INSERT ON public.share_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_share_comment();

CREATE TRIGGER on_share_insert
  AFTER INSERT ON public.shares
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_share();

CREATE TRIGGER trg_touch_tagging_job
  BEFORE UPDATE ON public.tagging_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_tagging_job();

CREATE TRIGGER trg_assign_team_accent
  BEFORE INSERT ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_team_accent();

CREATE TRIGGER trg_extend_job_grants
  AFTER INSERT ON public.videos
  FOR EACH ROW
  WHEN ((new.game_id IS NOT NULL))
  EXECUTE FUNCTION public.extend_job_grants_to_new_video();

CREATE TRIGGER set_owner_from_auth
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.storage_set_owner_from_auth();

CREATE POLICY "audit_insert_authenticated" ON "public"."admin_audit_log"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "audit_read_superadmin" ON "public"."admin_audit_log"
  FOR SELECT
  TO PUBLIC
  USING (public.is_super_admin());

CREATE POLICY "clip_football_delete" ON "public"."clip_football"
  FOR DELETE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = clip_football.clip_id) AND (public.is_super_admin() OR (c.created_by_user_id = auth.uid()) OR public.is_team_coach(c.team_id))))));

CREATE POLICY "clip_football_insert" ON "public"."clip_football"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = clip_football.clip_id) AND (public.is_super_admin() OR public.is_team_member(c.team_id) OR ((c.team_id IS NULL) AND (c.created_by_user_id = auth.uid())))))));

CREATE POLICY "clip_football_read" ON "public"."clip_football"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.clips c
  WHERE
    ((c.id = clip_football.clip_id) AND (public.is_super_admin() OR (c.created_by_user_id = auth.uid()) OR ((c.visibility = 'team'::public.content_visibility) AND
    public.is_team_member(c.team_id)) OR ((c.visibility = 'public_link'::public.content_visibility) AND public.is_team_member(c.team_id)) OR
    ((c.visibility = 'coaches_only'::public.content_visibility) AND public.is_team_coach(c.team_id)))))));

CREATE POLICY "clip_football_update" ON "public"."clip_football"
  FOR UPDATE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = clip_football.clip_id) AND (public.is_super_admin() OR (c.created_by_user_id = auth.uid()) OR public.is_team_coach(c.team_id))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = clip_football.clip_id) AND (public.is_super_admin() OR (c.created_by_user_id = auth.uid()) OR public.is_team_coach(c.team_id))))));

CREATE POLICY "clip_tags_delete" ON "public"."clip_tags"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = clip_tags.clip_id) AND ((c.created_by_user_id = auth.uid()) OR public.is_team_coach(c.team_id)))))));

CREATE POLICY "clip_tags_insert" ON "public"."clip_tags"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = clip_tags.clip_id) AND ((c.created_by_user_id = auth.uid()) OR public.is_team_member(c.team_id)))))));

CREATE POLICY "clip_tags_read" ON "public"."clip_tags"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.clips c
  WHERE
    ((c.id = clip_tags.clip_id) AND ((c.created_by_user_id = auth.uid()) OR ((c.visibility = ANY (ARRAY['team'::public.content_visibility,
    'public_link'::public.content_visibility])) AND public.is_team_member(c.team_id)) OR
    ((c.visibility = 'coaches_only'::public.content_visibility) AND public.is_team_coach(c.team_id))))))));

CREATE POLICY "clips_delete" ON "public"."clips"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "clips_insert" ON "public"."clips"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR public.is_team_member(team_id) OR ((team_id IS NULL) AND (created_by_user_id = auth.uid())) OR public.can_tag_video(video_id)));

CREATE POLICY "clips_read" ON "public"."clips"
  FOR SELECT
  TO PUBLIC
  USING
    ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR ((visibility = 'team'::public.content_visibility) AND public.is_team_member(team_id)) OR ((visibility =
    'public_link'::public.content_visibility) AND public.is_team_member(team_id)) OR ((visibility = 'coaches_only'::public.content_visibility) AND public.is_team_coach(team_id)) OR
    ((visibility = ANY (ARRAY['team'::public.content_visibility, 'public_link'::public.content_visibility])) AND (EXISTS ( SELECT 1
   FROM public.videos v
  WHERE ((v.id = clips.video_id) AND (v.game_id IS
    NOT NULL) AND public.is_family_film_parent(v.game_id)))) AND (public.clip_involves_my_kid(id) OR (NOT public.clip_is_pure_negative(id))))));

CREATE POLICY "clips_update" ON "public"."clips"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id)))
  WITH CHECK ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "content_reports_insert" ON "public"."content_reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((reporter_user_id = auth.uid()));

CREATE POLICY "content_reports_select_own" ON "public"."content_reports"
  FOR SELECT
  TO "authenticated"
  USING ((reporter_user_id = auth.uid()));

CREATE POLICY "device_push_tokens_delete" ON "public"."device_push_tokens"
  FOR DELETE
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "device_push_tokens_insert" ON "public"."device_push_tokens"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "device_push_tokens_select" ON "public"."device_push_tokens"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "device_push_tokens_update" ON "public"."device_push_tokens"
  FOR UPDATE
  TO "authenticated"
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "att_select" ON "public"."event_attendance"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_attendance.event_id) AND public.is_team_member(e.team_id)))));

CREATE POLICY "att_write" ON "public"."event_attendance"
  FOR ALL
  TO PUBLIC
  USING (((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_attendance.event_id) AND public.is_team_coach(e.team_id)))) OR (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = event_attendance.player_id) AND (ppl.parent_user_id = public.effective_user_id()))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_attendance.event_id) AND public.is_team_coach(e.team_id)))) OR (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = event_attendance.player_id) AND (ppl.parent_user_id = public.effective_user_id()))))));

CREATE POLICY "snack_delete" ON "public"."event_snack_signups"
  FOR DELETE
  TO "authenticated"
  USING (((claimed_by_user_id = auth.uid()) OR public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "snack_insert" ON "public"."event_snack_signups"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_team_member(team_id) AND (claimed_by_user_id = auth.uid())));

CREATE POLICY "snack_read" ON "public"."event_snack_signups"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "events_insert" ON "public"."events"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "events_select" ON "public"."events"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "events_update" ON "public"."events"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_team_coach(team_id) OR public.is_super_admin()))
  WITH CHECK ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "followers_delete" ON "public"."followers"
  FOR DELETE
  TO PUBLIC
  USING
    ((public.is_super_admin() OR (follower_user_id = auth.uid()) OR ((scope = 'team'::public.follower_scope) AND public.is_team_coach(team_id)) OR ((scope =
    'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = followers.player_id) AND public.is_team_coach(p.team_id))))) OR ((scope = 'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = followers.player_id) AND (ppl.parent_user_id = auth.uid())))))));

CREATE POLICY "followers_insert" ON "public"."followers"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (follower_user_id = auth.uid())));

CREATE POLICY "followers_read" ON "public"."followers"
  FOR SELECT
  TO PUBLIC
  USING
    ((public.is_super_admin() OR (follower_user_id = auth.uid()) OR ((scope = 'team'::public.follower_scope) AND public.is_team_coach(team_id)) OR ((scope =
    'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = followers.player_id) AND public.is_team_coach(p.team_id))))) OR ((scope = 'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = followers.player_id) AND (ppl.parent_user_id = auth.uid())))))));

CREATE POLICY "followers_update" ON "public"."followers"
  FOR UPDATE
  TO PUBLIC
  USING
    ((public.is_super_admin() OR ((scope = 'team'::public.follower_scope) AND public.is_team_coach(team_id)) OR ((scope = 'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = followers.player_id) AND public.is_team_coach(p.team_id))))) OR ((scope = 'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = followers.player_id) AND (ppl.parent_user_id = auth.uid())))))))
  WITH
    CHECK
    ((public.is_super_admin() OR ((scope = 'team'::public.follower_scope) AND public.is_team_coach(team_id)) OR ((scope = 'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = followers.player_id) AND public.is_team_coach(p.team_id))))) OR ((scope = 'player'::public.follower_scope) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = followers.player_id) AND (ppl.parent_user_id = auth.uid())))))));

CREATE POLICY "game_lineups_delete" ON "public"."game_lineups"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_lineups.game_id) AND public.is_team_coach(g.team_id))))));

CREATE POLICY "game_lineups_insert" ON "public"."game_lineups"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_lineups.game_id) AND public.is_team_coach(g.team_id))))));

CREATE POLICY "game_lineups_read" ON "public"."game_lineups"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_lineups.game_id) AND public.is_team_member(g.team_id)))) OR (public.is_linked_parent(player_id) AND public.is_family_film_parent(game_id))));

CREATE POLICY "game_stat_lines_delete" ON "public"."game_stat_lines"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_stat_lines.game_id) AND public.is_team_coach(g.team_id))))));

CREATE POLICY "game_stat_lines_insert" ON "public"."game_stat_lines"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_stat_lines.game_id) AND public.is_team_coach(g.team_id))))));

CREATE POLICY "game_stat_lines_read" ON "public"."game_stat_lines"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_stat_lines.game_id) AND public.is_team_member(g.team_id))))));

CREATE POLICY "game_stat_lines_update" ON "public"."game_stat_lines"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_stat_lines.game_id) AND public.is_team_coach(g.team_id))))))
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.games g
  WHERE ((g.id = game_stat_lines.game_id) AND public.is_team_coach(g.team_id))))));

CREATE POLICY "games_delete" ON "public"."games"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "games_insert" ON "public"."games"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "games_read" ON "public"."games"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_team_member(team_id) OR public.is_super_admin() OR public.is_lineup_parent(id) OR public.can_tag_game(id)));

CREATE POLICY "games_update" ON "public"."games"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_team_coach(team_id) OR public.is_super_admin()))
  WITH CHECK ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "highlight_reels_delete" ON "public"."highlight_reels"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "highlight_reels_insert" ON "public"."highlight_reels"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_member(team_id)));

CREATE POLICY "highlight_reels_read" ON "public"."highlight_reels"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id) OR (EXISTS ( SELECT 1
   FROM public.shares s
  WHERE
    ((s.content_type = 'reel'::public.share_content) AND (s.content_id = highlight_reels.id) AND s.visible AND ((s.shared_by_user_id = auth.uid()) OR ((s.audience =
    'team'::public.share_audience) AND public.is_team_member(s.team_id)) OR ((s.audience = 'coaches'::public.share_audience) AND public.is_team_coach(s.team_id)) OR
    ((s.audience = 'player'::public.share_audience) AND (EXISTS ( SELECT 1
           FROM public.parent_player_links ppl
          WHERE ((ppl.player_id = s.target_player_id) AND (ppl.parent_user_id = auth.uid())))))))))));

CREATE POLICY "highlight_reels_update" ON "public"."highlight_reels"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id)))
  WITH CHECK ((public.is_super_admin() OR (created_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "install_plays_coach_all" ON "public"."install_plays"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.installs i
  WHERE ((i.id = install_plays.install_id) AND (public.is_super_admin() OR public.is_team_coach(i.team_id))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.installs i
  WHERE ((i.id = install_plays.install_id) AND public.is_team_coach(i.team_id)))));

CREATE POLICY "install_plays_member_read" ON "public"."install_plays"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.installs i
  WHERE (i.id = install_plays.install_id))));

CREATE POLICY "install_receipts_insert" ON "public"."install_receipts"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.installs i
  WHERE (i.id = install_receipts.install_id)))));

CREATE POLICY "install_receipts_read" ON "public"."install_receipts"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.installs i
  WHERE ((i.id = install_receipts.install_id) AND public.is_team_coach(i.team_id))))));

CREATE POLICY "installs_coach_all" ON "public"."installs"
  FOR ALL
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id)))
  WITH CHECK (public.is_team_coach(team_id));

CREATE POLICY "installs_member_read" ON "public"."installs"
  FOR SELECT
  TO PUBLIC
  USING (((status = 'published'::text) AND public.is_team_member(team_id)));

CREATE POLICY "library_plays_all" ON "public"."library_plays"
  FOR ALL
  TO PUBLIC
  USING (((owner_user_id = auth.uid()) OR public.is_super_admin()))
  WITH CHECK ((owner_user_id = auth.uid()));

CREATE POLICY "library_plays_community_read" ON "public"."library_plays"
  FOR SELECT
  TO "authenticated"
  USING ((visibility = 'community'::text));

CREATE POLICY "messages_insert" ON "public"."messages"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((author_user_id = auth.uid()) AND public.is_team_member(team_id) AND ((kind = 'chat'::text) OR public.is_team_coach(team_id))));

CREATE POLICY "messages_read" ON "public"."messages"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "messages_update" ON "public"."messages"
  FOR UPDATE
  TO "authenticated"
  USING (((author_user_id = auth.uid()) OR public.is_team_coach(team_id) OR public.is_super_admin()))
  WITH CHECK (((author_user_id = auth.uid()) OR public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "notifications_delete" ON "public"."notifications"
  FOR DELETE
  TO PUBLIC
  USING ((recipient_user_id = auth.uid()));

CREATE POLICY "notifications_read" ON "public"."notifications"
  FOR SELECT
  TO PUBLIC
  USING (((recipient_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "parent_player_links_delete" ON "public"."parent_player_links"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = parent_player_links.player_id) AND public.is_team_coach(p.team_id))))));

CREATE POLICY "parent_player_links_insert" ON "public"."parent_player_links"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = parent_player_links.player_id) AND public.is_team_coach(p.team_id))))));

CREATE POLICY "parent_player_links_read" ON "public"."parent_player_links"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (parent_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = parent_player_links.player_id) AND public.is_team_coach(p.team_id))))));

CREATE POLICY "parent_player_links_update" ON "public"."parent_player_links"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (parent_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = parent_player_links.player_id) AND public.is_team_coach(p.team_id))))))
  WITH CHECK ((public.is_super_admin() OR (parent_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.players p
  WHERE ((p.id = parent_player_links.player_id) AND public.is_team_coach(p.team_id))))));

CREATE POLICY "play_clips_coach_all" ON "public"."play_clips"
  FOR ALL
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id)))
  WITH CHECK ((public.is_team_coach(team_id) AND (EXISTS ( SELECT 1
   FROM public.clips c
  WHERE ((c.id = play_clips.clip_id) AND (c.team_id = c.team_id))))));

CREATE POLICY "play_clips_member_read" ON "public"."play_clips"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(team_id)));

CREATE POLICY "play_versions_coach_insert" ON "public"."play_versions"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.plays p
  WHERE ((p.id = play_versions.play_id) AND public.is_team_coach(p.team_id)))));

CREATE POLICY "play_versions_coach_read" ON "public"."play_versions"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.plays p
  WHERE ((p.id = play_versions.play_id) AND public.is_team_coach(p.team_id)))) OR (EXISTS ( SELECT 1
   FROM public.install_plays ip
  WHERE ((ip.play_id = play_versions.play_id) AND (ip.play_version = play_versions.version))))));

CREATE POLICY "player_guardian_codes_read" ON "public"."player_guardian_codes"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_linked_parent(player_id)));

CREATE POLICY "player_guardian_seats_read" ON "public"."player_guardian_seats"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (granted_to_user_id = ( SELECT auth.uid() AS uid)) OR public.is_linked_parent(player_id)));

CREATE POLICY "player_teams_read" ON "public"."player_teams"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(team_id) OR public.is_linked_parent(player_id)));

CREATE POLICY "players_delete" ON "public"."players"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "players_insert" ON "public"."players"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "players_read" ON "public"."players"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(team_id) OR public.is_linked_parent(id)));

CREATE POLICY "players_update" ON "public"."players"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_team_coach(team_id) OR public.is_super_admin()))
  WITH CHECK ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "plays_coach_all" ON "public"."plays"
  FOR ALL
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id)))
  WITH CHECK (public.is_team_coach(team_id));

CREATE POLICY "plays_member_read" ON "public"."plays"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.install_plays ip
  WHERE (ip.play_id = plays.id))));

CREATE POLICY "reel_tags_delete" ON "public"."reel_tags"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.highlight_reels hr
  WHERE ((hr.id = reel_tags.reel_id) AND (hr.created_by_user_id = auth.uid()))))));

CREATE POLICY "reel_tags_insert" ON "public"."reel_tags"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.highlight_reels hr
  WHERE ((hr.id = reel_tags.reel_id) AND (hr.created_by_user_id = auth.uid()))))));

CREATE POLICY "reel_tags_read" ON "public"."reel_tags"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.highlight_reels hr
  WHERE ((hr.id = reel_tags.reel_id) AND (hr.created_by_user_id = auth.uid()))))));

CREATE POLICY "saved_items_rw" ON "public"."saved_items"
  FOR ALL
  TO PUBLIC
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "schedule_notifications_read" ON "public"."schedule_notifications"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_team_coach(team_id) OR public.is_super_admin()));

CREATE POLICY "seasons_delete" ON "public"."seasons"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id)));

CREATE POLICY "seasons_insert" ON "public"."seasons"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR public.is_team_coach(team_id)));

CREATE POLICY "seasons_read" ON "public"."seasons"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(team_id)));

CREATE POLICY "seasons_update" ON "public"."seasons"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id)))
  WITH CHECK ((public.is_super_admin() OR public.is_team_coach(team_id)));

CREATE POLICY "share_comments_delete" ON "public"."share_comments"
  FOR DELETE
  TO PUBLIC
  USING (((author_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "share_comments_insert" ON "public"."share_comments"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((author_user_id = auth.uid()) AND (public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.shares s
  WHERE ((s.id = share_comments.share_id) AND public.is_team_coach(s.team_id)))))));

CREATE POLICY "share_comments_read" ON "public"."share_comments"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.shares s
  WHERE ((s.id = share_comments.share_id) AND public.is_team_coach(s.team_id))))));

CREATE POLICY "share_comments_update" ON "public"."share_comments"
  FOR UPDATE
  TO PUBLIC
  USING ((author_user_id = auth.uid()))
  WITH CHECK ((author_user_id = auth.uid()));

CREATE POLICY "shares_delete" ON "public"."shares"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (shared_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "shares_insert" ON "public"."shares"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR public.is_team_coach(team_id) OR ((shared_by_user_id = auth.uid()) AND public.is_team_member(team_id))));

CREATE POLICY "shares_read" ON "public"."shares"
  FOR SELECT
  TO PUBLIC
  USING
    ((public.is_super_admin() OR (shared_by_user_id = auth.uid()) OR ((audience = 'team'::public.share_audience) AND public.is_team_member(team_id)) OR ((audience =
    'coaches'::public.share_audience) AND public.is_team_coach(team_id)) OR ((audience = 'player'::public.share_audience) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = shares.target_player_id) AND (ppl.parent_user_id = auth.uid())))) AND ((on_wall = true) OR public.is_primary_guardian(target_player_id)))));

CREATE POLICY "shares_update" ON "public"."shares"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (shared_by_user_id = auth.uid()) OR public.is_team_coach(team_id) OR ((audience = 'player'::public.share_audience) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = shares.target_player_id) AND (ppl.parent_user_id = auth.uid())))))))
  WITH CHECK ((public.is_super_admin() OR (shared_by_user_id = auth.uid()) OR public.is_team_coach(team_id) OR ((audience = 'player'::public.share_audience) AND (EXISTS ( SELECT 1
   FROM public.parent_player_links ppl
  WHERE ((ppl.player_id = shares.target_player_id) AND (ppl.parent_user_id = auth.uid())))))));

CREATE POLICY "super_admins_full_access" ON "public"."super_admins"
  FOR ALL
  TO PUBLIC
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "tagger_links_delete" ON "public"."tagger_links"
  FOR DELETE
  TO "authenticated"
  USING (((owner_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "tagger_links_read" ON "public"."tagger_links"
  FOR SELECT
  TO "authenticated"
  USING (((owner_user_id = auth.uid()) OR (tagger_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "tagging_job_messages_insert" ON "public"."tagging_job_messages"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((author_user_id = auth.uid()) AND public.is_tagging_job_party(job_id)));

CREATE POLICY "tagging_job_messages_read" ON "public"."tagging_job_messages"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_tagging_job_party(job_id) OR public.is_super_admin()));

CREATE POLICY "tagging_jobs_delete" ON "public"."tagging_jobs"
  FOR DELETE
  TO "authenticated"
  USING (((requester_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "tagging_jobs_insert" ON "public"."tagging_jobs"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((requester_user_id = auth.uid()) AND public.is_team_coach(team_id)));

CREATE POLICY "tagging_jobs_read" ON "public"."tagging_jobs"
  FOR SELECT
  TO "authenticated"
  USING (((requester_user_id = auth.uid()) OR (tagger_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "tagging_jobs_update" ON "public"."tagging_jobs"
  FOR UPDATE
  TO "authenticated"
  USING (((requester_user_id = auth.uid()) OR (tagger_user_id = auth.uid()) OR public.is_super_admin()))
  WITH CHECK (((requester_user_id = auth.uid()) OR (tagger_user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "tags_delete" ON "public"."tags"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "tags_insert" ON "public"."tags"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((((scope = 'team'::public.tag_scope) AND public.is_team_member(team_id)) OR public.is_super_admin()));

CREATE POLICY "tags_read" ON "public"."tags"
  FOR SELECT
  TO PUBLIC
  USING (((scope = 'global'::public.tag_scope) OR public.is_team_member(team_id) OR public.is_super_admin() OR public.can_read_team_tag(team_id, category)));

CREATE POLICY "tags_update" ON "public"."tags"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_team_member(team_id) OR public.is_super_admin()))
  WITH CHECK ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "team_hidden_tags_delete" ON "public"."team_hidden_tags"
  FOR DELETE
  TO "authenticated"
  USING ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "team_hidden_tags_insert" ON "public"."team_hidden_tags"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_team_member(team_id));

CREATE POLICY "team_hidden_tags_read" ON "public"."team_hidden_tags"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_team_member(team_id) OR public.is_super_admin()));

CREATE POLICY "tmp_read" ON "public"."team_member_permissions"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id) OR (user_id = auth.uid())));

CREATE POLICY "tm_delete" ON "public"."team_memberships"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id) OR (user_id = auth.uid())));

CREATE POLICY "tm_insert" ON "public"."team_memberships"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR public.is_team_coach(team_id) OR (EXISTS ( SELECT 1
   FROM public.teams t
  WHERE ((t.id = team_memberships.team_id) AND (t.created_by_user_id = auth.uid()))))));

CREATE POLICY "tm_read" ON "public"."team_memberships"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (user_id = auth.uid()) OR public.is_team_member(team_id)));

CREATE POLICY "tm_update" ON "public"."team_memberships"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id)))
  WITH CHECK ((public.is_super_admin() OR public.is_team_coach(team_id)));

CREATE POLICY "tpd_read" ON "public"."team_permission_defaults"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(team_id)));

CREATE POLICY "tpp_read" ON "public"."team_player_permissions"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(team_id) OR public.is_linked_parent(player_id)));

CREATE POLICY "teams_delete" ON "public"."teams"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(id) OR (created_by_user_id = auth.uid())));

CREATE POLICY "teams_insert" ON "public"."teams"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "teams_read" ON "public"."teams"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(id) OR (created_by_user_id = auth.uid())));

CREATE POLICY "teams_update" ON "public"."teams"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_coach(id) OR (created_by_user_id = auth.uid())))
  WITH CHECK ((public.is_super_admin() OR public.is_team_coach(id) OR (created_by_user_id = auth.uid())));

CREATE POLICY "tournaments_insert" ON "public"."tournaments"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR public.is_team_member(team_id)));

CREATE POLICY "tournaments_read" ON "public"."tournaments"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR public.is_team_member(team_id)));

CREATE POLICY "user_blocks_delete_own" ON "public"."user_blocks"
  FOR DELETE
  TO "authenticated"
  USING ((blocker_user_id = auth.uid()));

CREATE POLICY "user_blocks_insert" ON "public"."user_blocks"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((blocker_user_id = auth.uid()));

CREATE POLICY "user_blocks_select_mine" ON "public"."user_blocks"
  FOR SELECT
  TO "authenticated"
  USING (((blocker_user_id = auth.uid()) OR (blocked_user_id = auth.uid())));

CREATE POLICY "user_profiles_select_own" ON "public"."user_profiles"
  FOR SELECT
  TO PUBLIC
  USING (((user_id = auth.uid()) OR public.is_super_admin()));

CREATE POLICY "video_tagging_rights_delete" ON "public"."video_tagging_rights"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.videos v
  WHERE ((v.id = video_tagging_rights.video_id) AND public.is_team_coach(v.team_id))))));

CREATE POLICY "video_tagging_rights_insert" ON "public"."video_tagging_rights"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.videos v
  WHERE ((v.id = video_tagging_rights.video_id) AND public.is_team_coach(v.team_id))))));

CREATE POLICY "video_tagging_rights_read" ON "public"."video_tagging_rights"
  FOR SELECT
  TO PUBLIC
  USING ((public.is_super_admin() OR (granted_to_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.videos v
  WHERE ((v.id = video_tagging_rights.video_id) AND public.is_team_coach(v.team_id))))));

CREATE POLICY "video_tagging_rights_update" ON "public"."video_tagging_rights"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.videos v
  WHERE ((v.id = video_tagging_rights.video_id) AND public.is_team_coach(v.team_id))))))
  WITH CHECK ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.videos v
  WHERE ((v.id = video_tagging_rights.video_id) AND public.is_team_coach(v.team_id))))));

CREATE POLICY "videos_delete" ON "public"."videos"
  FOR DELETE
  TO PUBLIC
  USING ((public.is_super_admin() OR (uploaded_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "videos_insert" ON "public"."videos"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((public.is_super_admin() OR ((team_id IS NOT NULL) AND public.is_team_member(team_id)) OR ((team_id IS NULL) AND (uploaded_by_user_id = auth.uid()))));

CREATE POLICY "videos_read" ON "public"."videos"
  FOR SELECT
  TO PUBLIC
  USING
    ((public.is_super_admin() OR (uploaded_by_user_id = auth.uid()) OR ((visibility = 'team'::public.content_visibility) AND public.is_team_member(team_id)) OR ((visibility =
    'public_link'::public.content_visibility) AND public.is_team_member(team_id)) OR ((visibility = 'coaches_only'::public.content_visibility) AND public.is_team_coach(team_id)) OR
    ((game_id IS NOT NULL) AND public.is_family_film_parent(game_id)) OR public.can_tag_video(id)));

CREATE POLICY "videos_update" ON "public"."videos"
  FOR UPDATE
  TO PUBLIC
  USING ((public.is_super_admin() OR (uploaded_by_user_id = auth.uid()) OR public.is_team_coach(team_id)))
  WITH CHECK ((public.is_super_admin() OR (uploaded_by_user_id = auth.uid()) OR public.is_team_coach(team_id)));

CREATE POLICY "videos_authenticated_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((bucket_id = 'Videos'::text));

CREATE POLICY "videos_authenticated_select" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'Videos'::text) AND (OWNER = auth.uid())));

CREATE POLICY "videos_authenticated_update" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'Videos'::text) AND (OWNER = auth.uid())))
  WITH CHECK (((bucket_id = 'Videos'::text) AND (owner = auth.uid())));

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

COMMENT ON COLUMN "public"."tags"."sport" IS 'Sport this tag belongs to (matches teams.sport / the app SPORTS values). NULL = universal (shown for every sport), e.g. the ★ Highlight / POE specials and team player tags. Global tags are filtered in the tagger by (sport is null OR sport = the content team''s sport).';

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pg_net" IS 'Async HTTP';

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';

COMMENT ON TYPE "public"."membership_role" IS 'admin/head_coach/coach/parent/follower are live. player is RESERVED and UNUSED - kids are not app users; never grant access via it.';

GRANT EXECUTE ON FUNCTION "public"."_revoke_job_grants"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."accept_terms"(integer) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."am_i_super_admin"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."assign_team_accent"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."assign_team_coach"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."attach_kid_to_team"(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."attach_kid_to_team"(uuid, uuid, text) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."authorize_photo_view"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."authorize_reel_playback"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."authorize_team_logo_view"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."authorize_video_playback"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_delete_team_content"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_link_player"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_read_team_tag"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_tag_game"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_tag_video"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_tagging_job"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."claim_or_link_guardian"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."claim_roster_spot"(text, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."clear_my_phone"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."clear_team_member_permission"(uuid, uuid, public.team_permission) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."clear_team_member_permission"(uuid, uuid, public.team_permission) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."clear_team_player_permission"(uuid, uuid, public.team_permission) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."clear_team_player_permission"(uuid, uuid, public.team_permission) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."clip_involves_my_kid"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."clip_is_pure_negative"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."coaches_pin_status"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_kid"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_kid"(text) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE
  ON FUNCTION
    "public"."create_practice_series"(uuid, text, text, date, date, integer[], time WITHOUT time zone, time WITHOUT time zone, time WITHOUT time zone, text, text, text, text, text)
  TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_roster_placeholder"(uuid, text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_tagging_job"(uuid, uuid, timestamp WITH time zone, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."deactivate_my_account"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_game"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."effective_user_id"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enqueue_event_notification"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enqueue_message_notification"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enqueue_snack_reminders"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."ensure_player_tag"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."ensure_user_profile"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."extend_job_grants_to_new_video"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."game_stat_lines_touch_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."gen_join_code"(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."gen_join_code"(integer) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."generate_tagger_code"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_game_lineup_editor"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_my_tagger_code"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_notifications"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_purge_secret"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_purge_secret"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_user_display_name"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_user_display_name"(uuid) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."grab_play"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."grant_guardian_seat"(uuid, uuid, text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."has_team_permission"(uuid, public.team_permission) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."has_team_permission"(uuid, public.team_permission) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."import_game_events"(uuid, jsonb) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_family_film_parent"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_lineup_parent"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_linked_parent"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_primary_guardian"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_super_admin"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_tagging_job_party"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_team_admin"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_team_coach"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_team_member"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_team_with_code"(text, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."kid_guardians"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."kid_team_audience"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."leave_team"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."link_players"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_deleted_content"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_job_messages"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_my_taggers"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_my_tagging_jobs"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_player_guardians"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_team_staff"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_notification_read"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_notifications_seen"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."merge_players"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."notifications_unseen_count"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."notify_on_share"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."notify_on_share_comment"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."notify_users"(uuid[], text, uuid, uuid, uuid, text, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."owner_finalize_job"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."owner_request_changes"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."post_to_wall"(public.share_content, uuid, public.share_audience, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."post_to_wall"(public.share_content, uuid, public.share_audience, uuid, uuid) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."preview_guardian_code"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."preview_roster_by_code"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."publish_reel"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."publish_reel"(uuid) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."reactivate_my_account"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."redeem_coach_code"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."redeem_tagger_code"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."regenerate_coach_code"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."regenerate_guardian_code"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."regenerate_team_code"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."release_stale_tagging_jobs"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."remove_guardian"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."remove_roster_placeholder"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."remove_team_coach"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_any_code"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_recipients"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_event_sms_recipients"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_shared_content"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."resolve_shared_content"(uuid) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_shared_game"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_team_coaches"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_team_recipients"(uuid, uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."restore_game"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."restore_reel"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."restore_video"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_guardian_seat_on_unlink"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."search_all"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_coaches_pin"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_game_lineup"(uuid, uuid[]) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_kid_photo"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_kid_photo"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_my_display_name"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_my_display_name"(text) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_share_note"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_share_on_wall"(uuid, boolean) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_team_coaches_pin_required"(uuid, boolean) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_team_default_permission"(uuid, public.team_permission, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_team_default_permission"(uuid, public.team_permission, boolean) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_team_member_permission"(uuid, uuid, public.team_permission, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_team_member_permission"(uuid, uuid, public.team_permission, boolean) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_team_player_permission"(uuid, uuid, public.team_permission, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_team_player_permission"(uuid, uuid, public.team_permission, boolean) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."sms_target"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."snapshot_game_lineup"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."soft_delete_reel"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."soft_delete_video"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."storage_set_owner_from_auth"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."suggest_duplicate_players"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_lineup_from_clip_tag"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."tagger_complete_job"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."tagger_decline_job"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."tagger_player_tags"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."tagger_start_job"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."touch_event"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."touch_tagging_job"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."unlink_player"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_kid"(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_kid"(uuid, text, text) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_kid_profile"(uuid, text, text, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE
  ON FUNCTION "public"."update_series_forward"(uuid, date, text, time WITHOUT time zone, time WITHOUT time zone, time WITHOUT time zone, text, text, text, text, text)
  TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."verify_coaches_pin"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_audit_log" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clip_football" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clip_tags" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clips" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."content_reports" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."device_push_tokens" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_attendance" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_snack_signups" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."followers" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_lineups" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_stat_lines" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."games" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."highlight_reels" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."install_plays" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."install_receipts" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."installs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."library_plays" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."messages" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notification_outbox" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."parent_player_links" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."phone_verifications" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."play_clips" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."play_versions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_guardian_codes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_guardian_seats" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_teams" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."players" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plays" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reel_tags" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."saved_items" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedule_import_log" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedule_notifications" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."seasons" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."share_comments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shares" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sms_opt_outs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."super_admins" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tagger_links" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tagging_job_messages" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tagging_jobs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tags" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_hidden_tags" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_member_permissions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_memberships" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_permission_defaults" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_player_permissions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."teams" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tournaments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_blocks" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."video_tagging_rights" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."videos" TO "anon", "authenticated", "postgres", "service_role";

GRANT USAGE ON TYPE "public"."content_visibility" TO "postgres";

GRANT USAGE ON TYPE "public"."follower_scope" TO "postgres";

GRANT USAGE ON TYPE "public"."follower_status" TO "postgres";

GRANT USAGE ON TYPE "public"."grant_status" TO "postgres";

GRANT USAGE ON TYPE "public"."membership_role" TO "postgres";

GRANT USAGE ON TYPE "public"."membership_status" TO "postgres";

GRANT USAGE ON TYPE "public"."reel_status" TO "postgres";

GRANT USAGE ON TYPE "public"."season_status" TO "postgres";

GRANT USAGE ON TYPE "public"."share_audience" TO "postgres";

GRANT USAGE ON TYPE "public"."share_content" TO "postgres";

GRANT USAGE ON TYPE "public"."tag_scope" TO "postgres";

GRANT USAGE ON TYPE "public"."tagging_job_status" TO "postgres";

GRANT USAGE ON TYPE "public"."team_permission" TO "postgres";

GRANT USAGE ON TYPE "public"."upload_status" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_box_score" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."resolved_game_stats" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."season_player_stats" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."season_team_stats" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stat_events" TO "anon", "authenticated", "postgres", "service_role";

SELECT cron.schedule_in_database('process-notifications', '* * * * *', '
  select net.http_post(
    url := ''https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/process-notifications'',
    headers := ''{"Content-Type":"application/json"}''::jsonb,
    body := ''{}''::jsonb
  );
', 'postgres', NULL, true);

SELECT cron.schedule_in_database('purge-deleted-daily', '0 4 * * *', '
  select net.http_post(
    url     := ''https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/purge-deleted'',
    headers := jsonb_build_object(
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''purge_secret''),
      ''Content-Type'',  ''application/json''
    )
  );
  ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('snack-reminders', '0 * * * *', ' select public.enqueue_snack_reminders(); ', 'postgres', NULL, true);

