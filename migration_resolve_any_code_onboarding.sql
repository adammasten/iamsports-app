-- Onboarding one-box: given ANY code a new user was handed, detect what it is
-- (team join code / coach code / player guardian code) so the UI can route to the
-- right flow. SECURITY DEFINER because a brand-new user has no memberships yet;
-- returns only minimal routing info (the holder already has the code).
-- Applied live via Supabase MCP 2026-08-24.
create or replace function public.resolve_any_code(p_code text)
returns json language plpgsql security definer set search_path to 'public' stable as $$
declare c text := upper(trim(coalesce(p_code, ''))); v_team uuid; v_tname text; v_player uuid; v_pname text;
begin
  if c = '' then return json_build_object('type', null); end if;

  -- 1) Team JOIN code → join the team (roster claim)
  select id, name into v_team, v_tname from teams where upper(join_code) = c limit 1;
  if v_team is not null then
    return json_build_object('type', 'team', 'team_id', v_team, 'team_name', v_tname);
  end if;

  -- 2) Team COACH code → join as coach
  select id, name into v_team, v_tname from teams where coach_code is not null and upper(coach_code) = c limit 1;
  if v_team is not null then
    return json_build_object('type', 'coach', 'team_id', v_team, 'team_name', v_tname);
  end if;

  -- 3) Player GUARDIAN code → become a guardian of that kid
  select p.id, p.name into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c limit 1;
  if v_player is not null then
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  return json_build_object('type', null);
end $$;

grant execute on function public.resolve_any_code(text) to authenticated;
