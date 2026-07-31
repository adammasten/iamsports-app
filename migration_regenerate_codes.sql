-- migration_regenerate_codes.sql — revocable join/guardian codes (applied live)
-- Codes are revoked by ROTATION, not by a "revoked" flag: minting a new random
-- code overwrites the old one, so the old code stops working immediately and
-- there's no dead/expired-code state to reason about. Two RPCs mirror the two
-- codes from migration_roster_and_codes.sql:
--   * regenerate_team_code    — coach-gated (team join code on teams.join_code)
--   * regenerate_guardian_code — guardian-gated (player_guardian_codes.code)
-- Both loop gen_join_code(6) until unique, update in place, and audit. The UI:
-- Roster tab "Reset" on the team-code card; kid.tsx "Reset code" on the
-- guardian-code card.

create or replace function public.regenerate_team_code(p_team_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can reset the team code'; end if;
  loop c := gen_join_code(6); exit when not exists (select 1 from teams where join_code = c); end loop;
  update teams set join_code = c where id = p_team_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_team_code', 'teams', p_team_id, jsonb_build_object('team_id', p_team_id));
  return c;
end $$;
grant execute on function public.regenerate_team_code(uuid) to authenticated;


create or replace function public.regenerate_guardian_code(p_player_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()) then
    raise exception 'Only a guardian can reset this code';
  end if;
  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  update player_guardian_codes set code = c where player_id = p_player_id;
  if not found then
    insert into player_guardian_codes (player_id, code) values (p_player_id, c);
  end if;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_guardian_code', 'players', p_player_id, jsonb_build_object('player_id', p_player_id));
  return c;
end $$;
grant execute on function public.regenerate_guardian_code(uuid) to authenticated;
