-- migration_phase1b_tag_name_with_number.sql — disambiguate player tags by
-- jersey number: the tag label becomes "First #N" (e.g. "Conrad #12"), or just
-- "First" when no number is set. Two kids named Ben on one team are now "Ben #10"
-- vs "Ben #23". player_id is still the stable identity link; the label is display.
--
-- Jersey lives on player_teams (per-team), so the label uses THAT team's number.
-- Kept in sync at: provision (trigger), rename (update_kid_profile), and jersey
-- change (attach_kid_to_team). Backfill rebuilds existing labels.

-- Provision: first name + this team's jersey.
create or replace function public.ensure_player_tag()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into tags (name, category, scope, team_id, player_id, sort_order)
  select split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(NEW.jersey_number), ''), ''),
         'players', 'team', NEW.team_id, NEW.player_id,
         coalesce((select max(sort_order) + 1 from tags
                   where team_id = NEW.team_id and category = 'players'), 0)
  from players p
  where p.id = NEW.player_id
  on conflict do nothing;
  return NEW;
end $$;

-- Rename: resync each linked tag to first name + that tag's team jersey.
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
  update tags tg set name = split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(
      (select pt.jersey_number from player_teams pt where pt.player_id = tg.player_id and pt.team_id = tg.team_id limit 1)
    ), ''), '')
  from players p
  where tg.player_id = p_player_id and tg.category = 'players' and p.id = p_player_id;
end $$;

-- Jersey change (coach re-add / set number): resync this team's tag label.
create or replace function public.attach_kid_to_team(p_player_id uuid, p_team_id uuid, p_jersey_number text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_super_admin() and not is_team_coach(p_team_id) then
    raise exception 'Only a coach or admin of this team can add players';
  end if;
  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (p_player_id, p_team_id, nullif(trim(coalesce(p_jersey_number, '')), ''), uid)
  on conflict (player_id, team_id) do update
    set jersey_number = excluded.jersey_number, left_at = null
  returning id into new_id;
  update tags tg set name = split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(p_jersey_number), ''), '')
  from players p
  where tg.player_id = p_player_id and tg.team_id = p_team_id and tg.category = 'players' and p.id = p_player_id;
  return new_id;
end $$;

-- Backfill: rebuild every existing player tag's label as "First #N".
update tags tg set name = split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(
    (select pt.jersey_number from player_teams pt where pt.player_id = tg.player_id and pt.team_id = tg.team_id limit 1)
  ), ''), '')
from players p
where tg.category = 'players' and tg.player_id is not null and p.id = tg.player_id;
