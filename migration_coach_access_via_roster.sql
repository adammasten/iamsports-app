-- =====================================================================
-- Coach access via the roster. APPLIED LIVE via the Supabase MCP
-- (migration: coach_access_via_roster).
--
-- A team gets a COACH code (like join_code, but grants the 'coach' role, which
-- is what gates Coaches' Corner + all coach tools). Managed from the roster's
-- Coaches section; redeemed by a coach via Home -> "Join as coach". A coach can
-- also be a parent of their own kid (claimed separately with the kid's code).
-- =====================================================================

alter table teams add column if not exists coach_code text;

create or replace function regenerate_coach_code(p_team_id uuid)
returns text language plpgsql security definer set search_path = 'public' as $$
declare v_code text;
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then raise exception 'not authorized'; end if;
  loop
    v_code := upper(substring(md5(gen_random_uuid()::text) for 6));
    exit when not exists (select 1 from teams where coach_code = v_code);
  end loop;
  update teams set coach_code = v_code where id = p_team_id;
  return v_code;
end $$;

create or replace function redeem_coach_code(p_code text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_team uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select id into v_team from teams where upper(coach_code) = upper(trim(p_code)) and coach_code is not null;
  if v_team is null then raise exception 'That coach code did not match any team.'; end if;
  insert into team_memberships (team_id, user_id, role, status)
    values (v_team, v_uid, 'coach', 'confirmed')
    on conflict (team_id, user_id, role) do update set status = 'confirmed';
  return v_team;
end $$;

create or replace function list_team_staff(p_team_id uuid)
returns table (user_id uuid, display_name text, role membership_role) language plpgsql security definer set search_path = 'public' as $$
begin
  if not (is_super_admin() or is_team_member(p_team_id)) then raise exception 'not authorized'; end if;
  return query
    select tm.user_id, coalesce(nullif(trim(up.display_name), ''), 'Coach') as display_name, tm.role
    from team_memberships tm
    left join user_profiles up on up.user_id = tm.user_id
    where tm.team_id = p_team_id and tm.role in ('admin','head_coach','coach')
    order by (case tm.role when 'admin' then 0 when 'head_coach' then 1 else 2 end), 2;
end $$;

create or replace function remove_team_coach(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
begin
  if not (is_super_admin() or is_team_admin(p_team_id)) then raise exception 'not authorized'; end if;
  delete from team_memberships
   where team_id = p_team_id and user_id = p_user_id and role in ('coach','head_coach');
end $$;

grant execute on function regenerate_coach_code(uuid) to authenticated;
grant execute on function redeem_coach_code(text) to authenticated;
grant execute on function list_team_staff(uuid) to authenticated;
grant execute on function remove_team_coach(uuid, uuid) to authenticated;
-- =====================================================================
