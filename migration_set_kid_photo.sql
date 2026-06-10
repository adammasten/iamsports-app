-- ============================================================
-- Kid profile photo — players.photo_path + set_kid_photo RPC.
--
-- Adds a nullable photo_path to players (stores the storage OBJECT KEY, not a
-- URL — the bucket is private; signed URLs are minted at read time). Photos
-- reuse the existing private 'Videos' bucket under a 'kid-photos/<player_id>/'
-- prefix (option A), so no new bucket or storage policies are needed.
--
-- set_kid_photo writes photo_path via SECURITY DEFINER because players_update
-- RLS has no linked-parent branch (same situation as create_kid/update_kid):
-- a parent can't directly UPDATE their teamless kid's row. Authorizes the
-- kid's linked parent (parent_player_links) or a super admin only.
--
-- Idempotent: safe to re-run. authenticated-only.
-- ============================================================

alter table players add column if not exists photo_path text;

create or replace function set_kid_photo(player_id uuid, photo_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
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
$$;

revoke all on function set_kid_photo(uuid, text) from public, anon;
grant execute on function set_kid_photo(uuid, text) to authenticated;
