-- ============================================================
-- saved_items — "Add to My Film" bookmarks.
--
-- A saved_item is a LIVE BOOKMARK to a share, not a copy. It references the
-- shares row it came from; if the sharer un-shares (deletes the share), the
-- bookmark auto-vanishes via ON DELETE CASCADE — this is the "live-while-shared"
-- model (decided with Adam 2026-07-24), enforced at the DB level. To keep it
-- forever, the user Downloads it instead (off-platform copy).
--
-- Playback entitlement is NOT re-implemented here: viewing a saved item resolves
-- through resolve_shared_content(share_id) + sign-media, which already check the
-- viewer is still entitled. So a bookmark to a share you've lost access to simply
-- stops resolving.
--
-- Idempotent.
-- ============================================================

BEGIN;

create table if not exists saved_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  share_id   uuid not null references shares(id)      on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, share_id)
);
create index if not exists idx_saved_items_user on saved_items(user_id);

alter table saved_items enable row level security;

-- Each user manages ONLY their own saves (select/insert/delete).
drop policy if exists saved_items_rw on saved_items;
create policy saved_items_rw on saved_items
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';

COMMIT;
