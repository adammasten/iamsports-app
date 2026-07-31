-- migration_roster_membership.sql — Phase A pt2 (applied as roster_membership_and_profile_edit)
-- Parents can fix their kid's profile (misspelled name); guardians auto-become a
-- 'parent' team member on join/claim so they can reach the team's tabs + roster.

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
end $$;
grant execute on function public.update_kid_profile(uuid, text, text, text) to authenticated;


create or replace function public.join_team_with_code(p_code text, p_player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_player_id) then
    raise exception 'You are not a guardian of this player';
  end if;
  select id into t_id from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (p_player_id, t_id, uid) on conflict (player_id, team_id) do nothing;
  update players set team_id = t_id where id = p_player_id and team_id is null;

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;

  return t_id;
end $$;


create or replace function public.claim_or_link_guardian(p_code text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p_id uuid; n int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;

  perform 1 from players where id = p_id for update;

  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
    select count(*) into n from parent_player_links where player_id = p_id;
    if n >= 4 then raise exception 'This player already has the maximum of 4 guardians'; end if;
    insert into parent_player_links (parent_user_id, player_id, relationship)
    values (uid, p_id, case when n = 0 then 'parent' else 'guardian' end);
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt where pt.player_id = p_id
  on conflict (team_id, user_id, role) do nothing;

  return p_id;
end $$;
