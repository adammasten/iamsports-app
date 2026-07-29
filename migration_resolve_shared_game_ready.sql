-- migration_resolve_shared_game_ready.sql
-- Phase 1 gate (server side): a shared GAME resolves to ALL of its videos via
-- resolve_shared_game (joined on game_id). A video added to a game AFTER the game
-- was shared re-resolves into the share the moment it exists — so the client-side
-- "don't share a non-ready video" block can't cover it. Filter to finalized videos
-- here so an in-flight ('uploading') or aborted ('failed') video never surfaces in
-- a shared game's playlist (which would 404 at sign-media / play a truncated file).
--
-- Only the WHERE clause changes; signature, SECURITY DEFINER, search_path, and the
-- hidden_by_family / content_type guards are preserved verbatim.

create or replace function public.resolve_shared_game(p_share_id uuid)
 returns table(video_id uuid, title text, storage_path text, sort_order integer)
 language sql
 security definer
 set search_path to 'public'
as $function$
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
