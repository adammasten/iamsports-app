-- =====================================================================
-- The Vault — community play bank on top of library_plays.
-- APPLIED LIVE via the Supabase MCP (migration: play_vault_core).
-- Publish a personal play to the community (visibility) + copy-on-grab
-- (deep-copies the diagram into the grabber's library, bumps save_count).
-- =====================================================================
alter table public.library_plays add column if not exists visibility text not null default 'private'
  check (visibility in ('private','community'));
alter table public.library_plays add column if not exists save_count int not null default 0;
create index if not exists library_plays_community_idx on public.library_plays (sport, save_count desc) where visibility='community';

drop policy if exists library_plays_community_read on public.library_plays;
create policy library_plays_community_read on public.library_plays
  for select to authenticated using (visibility = 'community');

create or replace function public.grab_play(p_source uuid)
returns uuid language plpgsql security definer set search_path = public as $$
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
$$;
grant execute on function public.grab_play(uuid) to authenticated;
-- =====================================================================
