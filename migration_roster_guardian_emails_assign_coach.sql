-- Roster: let an admin/head_coach see WHO is attached to each player (name + email
-- + their current role on the team) and assign a specific guardian as a coach.
-- Emails live in auth.users (not client-readable), so both are SECURITY DEFINER
-- and gated to admin/head_coach of the team (or super admin).
-- Applied live via Supabase MCP 2026-08-24.

create or replace function public.list_player_guardians(p_team_id uuid, p_player_id uuid)
returns table(user_id uuid, display_name text, email text, relationship text, team_role membership_role)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (is_super_admin() or exists (
    select 1 from team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach') and tm.status = 'confirmed'
  )) then
    raise exception 'not authorized';
  end if;
  -- Don't leak guardians of a player who isn't actually on this team.
  if not exists (
    select 1 from player_teams pt
    where pt.player_id = p_player_id and pt.team_id = p_team_id and pt.left_at is null
  ) then
    raise exception 'player not on this team';
  end if;
  return query
    select ppl.parent_user_id,
           coalesce(nullif(trim(up.display_name), ''), 'Guardian') as display_name,
           au.email::text as email,
           ppl.relationship,
           (select tm.role from team_memberships tm
             where tm.team_id = p_team_id and tm.user_id = ppl.parent_user_id
             order by (case tm.role when 'admin' then 0 when 'head_coach' then 1
                                    when 'coach' then 2 when 'parent' then 3 else 4 end)
             limit 1) as team_role
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    left join auth.users au on au.id = ppl.parent_user_id
    where ppl.player_id = p_player_id
    order by 2;
end $function$;

create or replace function public.assign_team_coach(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (is_super_admin() or exists (
    select 1 from team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach') and tm.status = 'confirmed'
  )) then
    raise exception 'not authorized';
  end if;
  insert into team_memberships (team_id, user_id, role, status)
    values (p_team_id, p_user_id, 'coach', 'confirmed')
    on conflict (team_id, user_id, role) do update set status = 'confirmed';
end $function$;

grant execute on function public.list_player_guardians(uuid, uuid) to authenticated;
grant execute on function public.assign_team_coach(uuid, uuid) to authenticated;
