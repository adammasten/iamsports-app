-- ============================================================
-- Cascade hardening — protect permanent history from silent deletion.
--
-- Changes ON DELETE CASCADE -> RESTRICT on three foreign keys so that deleting a
-- player/game/team can no longer SILENTLY erase history — the delete is BLOCKED
-- instead, preserving the rows. This is data-loss protection, independent of any
-- feature. It is the standalone "Phase 0" of the leave-team project.
--
-- NOTE ON "game_lineups.team_id": game_lineups has NO team_id column. Its only two
-- FKs are game_id (-> games) and player_id (-> players). Fix 2 below hardens
-- game_id, which is almost certainly what was meant — and because deleting a team
-- cascades teams -> games, a RESTRICT on game_lineups.game_id ALSO blocks team
-- deletion transitively when history exists. (If you did NOT want game deletion
-- blocked, delete the "Fix 2" block before running.)
--
-- WHY RESTRICT, NOT SET NULL: game_lineups.player_id / game_id are NOT NULL and
-- form the PRIMARY KEY, so they can't be nulled; and nulling would erase *which*
-- player/game the row is about — the fact we're preserving. RESTRICT preserves it.
--
-- SCOPE / SAFETY:
--   * ONLY changes delete behavior. Touches NO existing rows, NO column values, NO
--     PRIMARY KEYs, NO RLS/access policies.
--   * game_lineups is currently EMPTY -> Fixes 1 & 2 have ZERO effect today.
--   * parent_player_links HAS rows, but altering a FK's ON DELETE action does not
--     modify rows — existing links are untouched; only future player-deletes change.
--   * The app does not delete players anywhere; the only team-delete is a rollback
--     of a just-created (history-free) team (select-team.tsx:85) -> unaffected today.
--
-- KNOWN FOLLOW-UP (app-level, later): once game_lineups holds rows, the long-press
-- deleteGame in app/(tabs)/index.tsx will error on games-with-history — it needs
-- graceful handling / soft-delete. Not fixed here (DB-level protection only).
--
-- Idempotent: safe to re-run (each FK is found by shape, dropped, re-added).
-- ============================================================

-- Fix 1: game_lineups.player_id  CASCADE -> RESTRICT
do $$ declare cname text; begin
  select c.conname into cname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.game_lineups'::regclass and c.contype = 'f'
     and c.confrelid = 'public.players'::regclass and a.attname = 'player_id'
   limit 1;
  if cname is not null then
    execute format('alter table public.game_lineups drop constraint %I', cname);
  end if;
  alter table public.game_lineups
    add constraint game_lineups_player_id_fkey
    foreign key (player_id) references players(id) on delete restrict;
end $$;

-- Fix 2: game_lineups.game_id  CASCADE -> RESTRICT  (this is the "team_id" item)
do $$ declare cname text; begin
  select c.conname into cname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.game_lineups'::regclass and c.contype = 'f'
     and c.confrelid = 'public.games'::regclass and a.attname = 'game_id'
   limit 1;
  if cname is not null then
    execute format('alter table public.game_lineups drop constraint %I', cname);
  end if;
  alter table public.game_lineups
    add constraint game_lineups_game_id_fkey
    foreign key (game_id) references games(id) on delete restrict;
end $$;

-- Fix 3: parent_player_links.player_id  CASCADE -> RESTRICT
do $$ declare cname text; begin
  select c.conname into cname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.parent_player_links'::regclass and c.contype = 'f'
     and c.confrelid = 'public.players'::regclass and a.attname = 'player_id'
   limit 1;
  if cname is not null then
    execute format('alter table public.parent_player_links drop constraint %I', cname);
  end if;
  alter table public.parent_player_links
    add constraint parent_player_links_player_id_fkey
    foreign key (player_id) references players(id) on delete restrict;
end $$;

-- ============================================================
-- VERIFY (confdeltype should be 'r' = restrict; was 'c' = cascade):
--   select conrelid::regclass as tbl, conname, confdeltype
--   from pg_constraint
--   where contype = 'f'
--     and conrelid in ('public.game_lineups'::regclass, 'public.parent_player_links'::regclass)
--     and confrelid in ('public.players'::regclass, 'public.games'::regclass)
--   order by tbl, conname;
--
-- History intact (row counts unchanged):
--   select count(*) as lineups from game_lineups;          -- currently 0
--   select count(*) as parent_links from parent_player_links;
-- ============================================================
