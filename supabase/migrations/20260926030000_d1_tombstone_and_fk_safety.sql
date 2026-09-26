-- ============================================================================
-- Slice D1 (part 1 of 2) — TOMBSTONE COLUMNS, CHAIN SAFETY, FK HARDENING
--
-- Plan v2 §8.1 / §8.3. This migration adds no behaviour on its own; it creates the
-- structure that reconcile_players (part 2) depends on, and it makes "never rely on
-- cascade" STRUCTURAL rather than conventional.
--
-- WHY THE FK FLIP MATTERS (plan v2 §8.3)
--   Nine FKs onto players are ON DELETE CASCADE. Five of them carry irreplaceable child
--   history: game_stat_lines, event_attendance, notifications.target_player_id,
--   player_guardian_seats (a PAID seat), followers. Any future code path that deletes a
--   players row silently destroys that history with no error. Convention rots; the database
--   should refuse.
--
-- BUILD 68 COMPATIBILITY
--   Additive only: new nullable columns, new indexes, new helper functions, and FK
--   *semantics* changes that only bite on DELETE. No column is removed or renamed, no RPC
--   signature changes, no policy changes here. Build 68 cannot observe this migration except
--   that a player DELETE which used to silently destroy history now errors -- and the one
--   caller that deletes players (remove_roster_placeholder) is hardened below in the same
--   migration so it never hits that error.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TOMBSTONE COLUMNS (plan v2 §8.1)
-- ----------------------------------------------------------------------------
alter table public.players
  add column if not exists merged_into_id    uuid null references public.players(id),
  add column if not exists merged_at         timestamptz null,
  add column if not exists merged_by_user_id uuid null;

-- A row may not be its own tombstone target.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'players_merged_into_not_self') then
    alter table public.players
      add constraint players_merged_into_not_self
      check (merged_into_id is null or merged_into_id <> id);
  end if;
end $$;

-- The three tombstone fields move together or not at all. A half-written tombstone is the
-- state in which a stale id resolves nowhere, so forbid it structurally.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'players_tombstone_complete') then
    alter table public.players
      add constraint players_tombstone_complete
      check ((merged_into_id is null and merged_at is null)
          or (merged_into_id is not null and merged_at is not null));
  end if;
end $$;

create index if not exists idx_players_merged_into on public.players (merged_into_id)
  where merged_into_id is not null;

comment on column public.players.merged_into_id is
  'Tombstone pointer (Slice D1). NOT NULL means this identity was retired INTO another player. The row is never deleted, so a stale player_id held by a cached client, a deep link, a saved export or a support ticket still resolves via resolve_player_id(). Retired rows are hidden from players_read for everyone but super admin.';

-- ----------------------------------------------------------------------------
-- 2. IDEMPOTENCY KEY FOR CREATION (plan v2 §3.1)
--    players has no created_by_user_id today, so add it. Scoping the uniqueness to the
--    creating user is what stops a caller passing someone else's request id and getting
--    back a player_id they have no business seeing.
-- ----------------------------------------------------------------------------
alter table public.players
  add column if not exists created_by_user_id   uuid null,
  add column if not exists creation_request_id  uuid null;

create unique index if not exists players_creation_request_key
  on public.players (created_by_user_id, creation_request_id)
  where creation_request_id is not null;

-- ----------------------------------------------------------------------------
-- 3. RESOLVE A STALE PLAYER ID TO ITS CANONICAL IDENTITY
--    Chain-safe and cycle-safe. Reconciliation itself never creates a chain (it always
--    repoints onto an already-canonical keeper and refuses a retired keeper), but a stale
--    id held for months may traverse several generations of reconciliation, and a corrupted
--    row must not be able to hang a query. Depth-capped, not recursive-CTE-cycle-dependent.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_player_id(p_player_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cur   uuid := p_player_id;
  v_next  uuid;
  v_hops  int := 0;
begin
  if v_cur is null then return null; end if;
  loop
    select merged_into_id into v_next from players where id = v_cur;
    -- Not found, or canonical: done.
    if v_next is null then return v_cur; end if;
    v_hops := v_hops + 1;
    if v_hops > 32 then
      -- Structurally unreachable (see reconcile_players' no-chain guarantee). If it ever
      -- happens the data is corrupt, and returning a wrong identity is worse than failing.
      raise exception 'resolve_player_id: merge chain deeper than 32 from % -- data corruption', p_player_id
        using errcode = 'data_exception';
    end if;
    v_cur := v_next;
  end loop;
end $function$;

comment on function public.resolve_player_id(uuid) is
  'Maps any player id -- live, or retired by reconciliation -- to its current canonical player id (Slice D1). Depth-capped at 32 so a corrupt cycle raises instead of hanging.';

grant execute on function public.resolve_player_id(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. FK HARDENING — CASCADE/SET NULL -> RESTRICT on every history-bearing reference
--    (plan v2 §8.3, widened by this slice's own programmatic FK inventory)
--
--    Inventory taken from pg_constraint, not from the plan's list. 14 FKs reference
--    players. Treatment:
--
--      HISTORY-BEARING -> RESTRICT (the database refuses to lose it):
--        game_stat_lines, event_attendance, notifications.target_player_id,
--        player_guardian_seats, followers, game_lineups, videos.player_id,
--        shares.target_player_id, tags.player_id, event_snack_signups
--      STRUCTURAL, deleted deliberately by remove_roster_placeholder -> left CASCADE:
--        player_teams, player_guardian_codes, team_player_permissions
--      ALREADY RESTRICT:
--        parent_player_links
--
--    videos/tags/game_lineups/event_snack_signups were SET NULL, which is its own quiet
--    data loss: the row survives but stops being about any child, so a video silently
--    detaches from the kid it was uploaded for. RESTRICT instead.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_tables text[][] := array[
    ['game_stat_lines',        'player_id',        'game_stat_lines_player_id_fkey'],
    ['event_attendance',       'player_id',        'event_attendance_player_id_fkey'],
    ['notifications',          'target_player_id', 'notifications_target_player_id_fkey'],
    ['player_guardian_seats',  'player_id',        'player_guardian_seats_player_id_fkey'],
    ['followers',              'player_id',        'followers_player_id_fkey'],
    ['game_lineups',           'player_id',        'game_lineups_player_id_fkey'],
    ['videos',                 'player_id',        'videos_player_id_fkey'],
    ['shares',                 'target_player_id', 'shares_target_player_id_fkey'],
    ['tags',                   'player_id',        'tags_player_id_fkey'],
    ['event_snack_signups',    'player_id',        'event_snack_signups_player_id_fkey']
  ];
  i int;
begin
  for i in 1 .. array_length(v_tables, 1) loop
    -- Only rewrite when it is not already RESTRICT, so this migration is re-runnable.
    if exists (
      select 1 from pg_constraint c
      where c.conname = v_tables[i][3]
        and c.conrelid = ('public.' || v_tables[i][1])::regclass
        and c.confdeltype <> 'r'
    ) then
      execute format('alter table public.%I drop constraint %I', v_tables[i][1], v_tables[i][3]);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.players(id) on delete restrict',
        v_tables[i][1], v_tables[i][3], v_tables[i][2]);
      raise notice 'D1: % .% -> ON DELETE RESTRICT', v_tables[i][1], v_tables[i][2];
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. players.player_lineage_id HAS NO FK — found by this slice's inventory, not in the plan
--    It is a player-identity-bearing column the database does not protect, and D4/D16 treat
--    it as the recorded "these are the same human" human assertion. Add the FK so a lineage
--    cannot point at a nonexistent player, ON DELETE SET NULL (losing a grouping hint is
--    acceptable; blocking an intentional placeholder delete is not).
--    Verified against live production: 27 rows set, 0 pointing nowhere, so this validates.
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'players_player_lineage_id_fkey') then
    alter table public.players
      add constraint players_player_lineage_id_fkey
      foreign key (player_lineage_id) references public.players(id) on delete set null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6. HARDEN remove_roster_placeholder FOR THE NEW RESTRICT SEMANTICS
--
--    Two defects, both made visible (not caused) by step 4:
--
--    a) Its "does this placeholder have content?" test checks only parent_player_links,
--       videos, game_lineups and clip_tags. It does NOT check event_attendance,
--       game_stat_lines, notifications, followers or player_guardian_seats -- so a
--       placeholder carrying attendance or stats took the DELETE branch and cascaded that
--       history away silently. After step 4 the same call would fail with an FK error,
--       which is better but still wrong. Widened to test every history-bearing table, so
--       such a placeholder now correctly takes the "left the team" branch instead.
--
--    b) player_guardian_codes disappeared by cascade. It is still CASCADE (a code is not
--       history), but the delete is now explicit so the function does not depend on cascade
--       semantics it no longer relies on anywhere else. Same for the player's tags rows,
--       which it already deleted, and its team_player_permissions, which it did not.
--
--    Authority, arguments, return values ('left' | 'detached' | 'deleted') are UNCHANGED,
--    so Build 68's Roster tab behaves identically.
-- ----------------------------------------------------------------------------
create or replace function public.remove_roster_placeholder(p_player_id uuid, p_team_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); d date := current_date;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Only a team coach can remove roster spots';
  end if;

  -- Never hard-delete a child who carries ANY history or family relationship.
  if exists (select 1 from parent_player_links     where player_id = p_player_id)
     or exists (select 1 from videos               where player_id = p_player_id)
     or exists (select 1 from game_lineups         where player_id = p_player_id)
     or exists (select 1 from clip_tags ct join tags t on t.id = ct.tag_id
                 where t.player_id = p_player_id)
     -- added in D1: these were invisible to the old test and were being cascaded away
     or exists (select 1 from event_attendance     where player_id = p_player_id)
     or exists (select 1 from game_stat_lines      where player_id = p_player_id)
     or exists (select 1 from notifications        where target_player_id = p_player_id)
     or exists (select 1 from followers            where player_id = p_player_id)
     or exists (select 1 from player_guardian_seats where player_id = p_player_id)
     or exists (select 1 from shares               where target_player_id = p_player_id)
     or exists (select 1 from event_snack_signups  where player_id = p_player_id)
     -- a retired identity pointing here must keep resolving
     or exists (select 1 from players              where merged_into_id = p_player_id)
  then
    update player_teams set left_on = greatest(d, joined_on)
    where player_id = p_player_id and team_id = p_team_id and left_on is null;
    perform close_orphaned_parent_memberships(p_team_id, d);
    return 'left';
  end if;

  delete from player_teams where player_id = p_player_id and team_id = p_team_id;
  if not exists (select 1 from player_teams where player_id = p_player_id) then
    -- Explicit, ordered cleanup. Nothing here is history; none of it relies on cascade.
    delete from tags                    where player_id = p_player_id and category = 'players';
    delete from team_player_permissions  where player_id = p_player_id;
    delete from player_guardian_codes    where player_id = p_player_id;
    update players set player_lineage_id = null where player_lineage_id = p_player_id;
    delete from players where id = p_player_id;
    return 'deleted';
  end if;
  return 'detached';
end $function$;

notify pgrst, 'reload schema';
