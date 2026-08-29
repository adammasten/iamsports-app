-- Applied live 2026-08-29 via Supabase MCP (apply_migration).
--
-- Slice 2 of the Family Film Room plan (docs/PARENT_FILM_ROOM_PLAN.md).
-- Auto-populate game_lineups from player tags so is_lineup_parent(game_id) fires
-- for EVERY game a kid is tagged in, not just the sparsely-set manual lineups.
-- Verified: tags.player_id is 100% populated on player tags, so the tag->player
-- resolution is a direct link. game_lineups already has PRIMARY KEY
-- (game_id, player_id) → the upsert is idempotent.
--
-- The trigger is SECURITY DEFINER so the insert bypasses game_lineups RLS (the
-- tagging user — e.g. a future paid tagger — may not hold INSERT on it). It only
-- ADDS rows; it never removes them (a kid staying on a lineup after untagging is
-- harmless and matches the "footage survives" ethos).
-- Backfill result: game_lineups 29 -> 40 rows; lineup coverage now includes all
-- tagged games.

create or replace function public.sync_lineup_from_clip_tag()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player uuid;
  v_game uuid;
begin
  select t.player_id into v_player
  from tags t
  where t.id = NEW.tag_id and t.category = 'players' and t.player_id is not null;
  if v_player is null then return NEW; end if;

  select v.game_id into v_game
  from clips c join videos v on v.id = c.video_id
  where c.id = NEW.clip_id;
  if v_game is null then return NEW; end if;

  insert into game_lineups (game_id, player_id)
  values (v_game, v_player)
  on conflict (game_id, player_id) do nothing;

  return NEW;
end $$;

drop trigger if exists trg_sync_lineup_from_clip_tag on public.clip_tags;
create trigger trg_sync_lineup_from_clip_tag
  after insert on public.clip_tags
  for each row execute function public.sync_lineup_from_clip_tag();

insert into game_lineups (game_id, player_id)
select distinct v.game_id, t.player_id
from clip_tags ct
join tags t  on t.id = ct.tag_id and t.category = 'players' and t.player_id is not null
join clips c on c.id = ct.clip_id
join videos v on v.id = c.video_id and v.game_id is not null
on conflict (game_id, player_id) do nothing;
