-- ============================================================
-- Upload rebuild — per-video event metadata (self-describing videos).
--   event_type = Game/Practice/Tournament/Scrimmage/Skills (plain text,
--                validated app-side in lib/core/upload-meta.ts — new types need
--                zero migration).
--   event_date = the USER-FACING event date. Kept separate from videos.created_at,
--                which stays the invisible backend "uploaded_at".
--   sport      = the video's sport (inherited from the team when one is attached,
--                otherwise chosen on the form). Plain text.
-- All nullable, no default: existing videos simply have none set.
-- Additive, idempotent.
-- ============================================================

BEGIN;

alter table videos add column if not exists event_type text;
alter table videos add column if not exists event_date date;
alter table videos add column if not exists sport text;

notify pgrst, 'reload schema';

COMMIT;
