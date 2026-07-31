-- migration_player_tag_autoprovision.sql — the identity spine (Phase 1).
-- Every rostered player gets a player tag (category='players') LINKED to their
-- players.id, so "on the roster" == "taggable, attached to the kid's identity"
-- — no more hand-created, unlinked name-string tags. Plays then follow the kid
-- across teams/seasons via tags.player_id (also unblocks the stats GP fix, which
-- can join on tags.player_id instead of fuzzy-matching names).
--
-- Every roster-add funnels through an INSERT into player_teams (verified: all
-- three roster RPCs do it; teamless create_kid does NOT, correctly), so a single
-- AFTER INSERT trigger is the complete, path-independent catch-all. Idempotent
-- via a partial unique index; re-attach (on conflict do update) and merge
-- (update, not insert) don't fire it; coaches/parents live in team_memberships
-- (users), never player_teams, so they never get a player tag.

-- 1. One player tag per (team, player). Partial: legacy null-player_id tags are
--    unaffected, and no duplicate auto-tags can be created.
create unique index if not exists uq_tags_team_player
  on tags (team_id, player_id)
  where category = 'players' and player_id is not null;

-- 2. Provision function — snapshot the player's FIRST name (matches the existing
--    chip convention) and link player_id. SECURITY DEFINER so it succeeds on any
--    path regardless of the caller's RLS.
create or replace function public.ensure_player_tag()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into tags (name, category, scope, team_id, player_id, sort_order)
  select split_part(p.name, ' ', 1), 'players', 'team', NEW.team_id, NEW.player_id,
         coalesce((select max(sort_order) + 1 from tags
                   where team_id = NEW.team_id and category = 'players'), 0)
  from players p
  where p.id = NEW.player_id
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists on_player_teams_insert on player_teams;
create trigger on_player_teams_insert
  after insert on player_teams
  for each row execute function public.ensure_player_tag();

-- 3. Backfill existing roster pairs that lack a linked player tag.
insert into tags (name, category, scope, team_id, player_id, sort_order)
select split_part(p.name, ' ', 1), 'players', 'team', pt.team_id, pt.player_id,
       coalesce((select max(sort_order) + 1 from tags t2
                 where t2.team_id = pt.team_id and t2.category = 'players'), 0)
from player_teams pt
join players p on p.id = pt.player_id
where not exists (
  select 1 from tags t
  where t.category = 'players' and t.player_id = pt.player_id and t.team_id = pt.team_id
)
on conflict do nothing;

-- 4. Keep the linked tag's display name in sync when a player is renamed (the
--    tag name is a snapshot string; without this it would drift). player_id is
--    the real identity link and never drifts — this is display-only upkeep.
create or replace function public.update_kid_profile(
  p_player_id uuid, p_name text default null, p_jersey text default null, p_grad_class text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from players where id = p_player_id;
  if not (is_linked_parent(p_player_id) or is_super_admin() or (t is not null and is_team_coach(t))) then
    raise exception 'Not allowed to edit this player';
  end if;
  update players set
    name          = coalesce(nullif(trim(p_name), ''), name),
    jersey_number = case when p_jersey is null then jersey_number else nullif(trim(p_jersey), '') end,
    grad_class    = case when p_grad_class is null then grad_class else nullif(trim(p_grad_class), '') end
  where id = p_player_id;
  -- Resync linked player tags to the (possibly new) first name.
  update tags set name = split_part(p.name, ' ', 1)
  from players p
  where tags.player_id = p_player_id and tags.category = 'players' and p.id = p_player_id;
end $$;
