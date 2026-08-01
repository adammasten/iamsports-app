-- migration_notifications_phase_c.sql — wire two more notification events.
-- guardian_joined: a new co-guardian claims a kid via guardian code → the kid's
--   EXISTING guardians are notified (notify_users skips the new one). (Team-code
--   claim_roster_spot only claims UNCLAIMED players, so there's no one to notify.)
-- kid_added_to_team: a coach/guardian adds a kid to a team → the kid's guardians
--   are notified, but ONLY on a genuinely-new attach (xmax=0), not a jersey update
--   or a reactivation.

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
    -- notify the kid's OTHER guardians that a co-guardian joined
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt where pt.player_id = p_id
  on conflict (team_id, user_id, role) do nothing;

  return p_id;
end $$;

create or replace function public.attach_kid_to_team(p_player_id uuid, p_team_id uuid, p_jersey_number text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); new_id uuid; was_new boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_super_admin() and not is_team_coach(p_team_id) then
    raise exception 'Only a coach or admin of this team can add players';
  end if;
  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (p_player_id, p_team_id, nullif(trim(coalesce(p_jersey_number, '')), ''), uid)
  on conflict (player_id, team_id) do update
    set jersey_number = excluded.jersey_number, left_at = null
  returning id, (xmax = 0) into new_id, was_new;
  update tags tg set name = case when split_part(p.name, ' ', 1) like '#%'
    then split_part(p.name, ' ', 1)
    else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(p_jersey_number), ''), '') end
  from players p
  where tg.player_id = p_player_id and tg.team_id = p_team_id and tg.category = 'players' and p.id = p_player_id;
  if was_new then
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_player_id),
      'kid_added_to_team', uid, p_player_id, p_team_id, 'team', p_team_id
    );
  end if;
  return new_id;
end $$;
