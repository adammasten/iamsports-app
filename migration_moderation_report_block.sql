-- ============================================================
-- UGC moderation: content reports + user blocks (App Store Guideline 1.2).
--
-- content_reports — a user flags a piece of content. Reporter sees only their
--   own reports; the developer moderates via the Supabase dashboard (service
--   role bypasses RLS) and takes content down by setting shares.visible = false.
-- user_blocks — a user blocks another. Feeds hide content in EITHER direction
--   (mutual): I don't see people I blocked, and people who blocked me don't see
--   me. See lib/core/moderation.ts + the feed loaders.
--
-- Reactive-only by design — no proactive scanning (18 U.S.C. § 2258A imposes no
-- monitoring duty; the trigger is actual knowledge). Idempotent.
-- ============================================================

BEGIN;

create table if not exists content_reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_user_id  uuid not null references auth.users(id) on delete cascade,
  content_type      text not null,          -- 'game' | 'video' | 'clip' | 'reel'
  content_id        uuid not null,
  share_id          uuid references shares(id) on delete set null,
  reason            text not null,          -- inappropriate | harassment | child_safety | spam | other
  note              text,
  status            text not null default 'pending',  -- pending | actioned | dismissed
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_content_reports_status  on content_reports(status);
create index if not exists idx_content_reports_content on content_reports(content_type, content_id);

alter table content_reports enable row level security;
-- Anyone signed in can file a report (for their own user id); they can read back
-- only their own. Moderation reads happen dashboard-side under the service role.
drop policy if exists content_reports_insert on content_reports;
create policy content_reports_insert on content_reports
  for insert to authenticated with check (reporter_user_id = auth.uid());
drop policy if exists content_reports_select_own on content_reports;
create policy content_reports_select_own on content_reports
  for select to authenticated using (reporter_user_id = auth.uid());

create table if not exists user_blocks (
  blocker_user_id  uuid not null references auth.users(id) on delete cascade,
  blocked_user_id  uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id)
);
create index if not exists idx_user_blocks_blocked on user_blocks(blocked_user_id);

alter table user_blocks enable row level security;
drop policy if exists user_blocks_insert on user_blocks;
create policy user_blocks_insert on user_blocks
  for insert to authenticated with check (blocker_user_id = auth.uid());
-- Read rows on EITHER side of me so the feed can hide mutually-blocked users.
drop policy if exists user_blocks_select_mine on user_blocks;
create policy user_blocks_select_mine on user_blocks
  for select to authenticated using (blocker_user_id = auth.uid() or blocked_user_id = auth.uid());
drop policy if exists user_blocks_delete_own on user_blocks;
create policy user_blocks_delete_own on user_blocks
  for delete to authenticated using (blocker_user_id = auth.uid());

notify pgrst, 'reload schema';

COMMIT;
