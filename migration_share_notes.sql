-- migration_share_notes.sql — per-share private commentary. The note is a column
-- ON THE SHARE ROW, so it inherits shares_read RLS automatically: a coaches-
-- audience note is coaches-only, a player-audience note is family-only, a team
-- note is seen by the whole team — with NO new read policy. Same clip shared to
-- three people = three share rows = three independent notes, each readable only
-- by that share's audience. The note can never follow the content to the wrong
-- person because it lives on the share, not the clip.
--
-- Set/edited/cleared by the SHARER only, via set_share_note (also the edit path,
-- invariant 2). Clients call post_to_wall (gets the share id) then set_share_note
-- — no change to post_to_wall's signature. Recipient views read shares.note
-- directly (RLS-scoped) — no change to resolve_shared_content needed.

alter table shares add column if not exists note text;

create or replace function public.set_share_note(p_share_id uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update shares set note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_share_id and shared_by_user_id = uid;
  if not found then raise exception 'Not allowed to edit this note'; end if;
end $$;
grant execute on function public.set_share_note(uuid, text) to authenticated;
