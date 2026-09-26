-- C.5 step 0 — SCHEMA RECONCILIATION (forward-only). PREREQUISITE for C.5 steps 1-5.
--
-- WHY THIS EXISTS
--   Four migrations were applied to production but the repository's copies are a
--   DIFFERENT VERSION than what production actually ran:
--       harden_join_codes                              (ledger 20260904032839)
--       harden_resolve_any_code                        (ledger 20260904034029)
--       phase3_roster_based_access                     (ledger 20260904035833)
--       phase4a_membership_end_date_and_history_paths  (ledger 20260904134222)
--   A from-scratch replay of supabase/migrations/ therefore reaches a state where
--   EIGHT objects differ from production -- and they are precisely the objects C.5
--   hardens. Any adversarial test run on that state could produce a false pass.
--
-- WHAT THIS DOES -- AND DELIBERATELY DOES NOT DO
--   Forward-only. It does NOT rewrite the four historical migrations (Adam, 2026-09-25:
--   "Do not rewrite already-applied historical migrations merely to make them resemble
--   production"). It normalizes the eight affected objects to the definitions PRODUCTION
--   CURRENTLY HAS, verbatim, as read from pg_get_functiondef on the live database.
--
--   Applied to production this is a NO-OP by construction: every definition below is
--   byte-identical to what is already there (verified by md5 of pg_proc.prosrc against
--   production for all eight). Its only real effect is on a freshly rebuilt database,
--   where it closes the gap the stale files leave behind.
--
--   NOT A BEHAVIOUR CHANGE. Nothing here is a C.5 security fix; the security changes are
--   steps 1-5. This migration exists solely to make the chain reproducible so that those
--   steps can be tested honestly.
--
-- THE EIGHT OBJECTS
--   is_team_member, is_team_coach            (production includes `left_on IS NULL`)
--   resolve_any_code, preview_roster_by_code, preview_guardian_code, redeem_coach_code
--   regenerate_coach_code, regenerate_team_code
--
-- KNOWN, DOCUMENTED EXCEPTION TO FULL REPRODUCIBILITY
--   Three production migrations are intentionally absent from supabase/migrations/:
--       optimize_sweep, optimize_sweep_cadence, optimize_sweep_only_ready_uploads
--   They require pg_net (net.http_post) and pg_cron (cron.schedule), which are not
--   available in the local stack, and they touch ONLY sweep_stalled_optimizes() and two
--   videos columns -- no C.5 object, no policy, no grant, no code path. Local is knowingly
--   missing them; production has them. This does not affect any C.5 conclusion.

CREATE OR REPLACE FUNCTION public.is_team_coach(check_team_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = check_team_id AND user_id = auth.uid()
      AND status = 'confirmed' AND left_on IS NULL
      AND role IN ('admin','head_coach','coach')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_team_member(t uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = t AND user_id = auth.uid()
      AND status = 'confirmed' AND left_on IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_coach_code(p_team_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_code text;
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then raise exception 'not authorized'; end if;
  loop
    v_code := upper(substring(md5(gen_random_uuid()::text) for 10));
    exit when not exists (select 1 from teams where coach_code = v_code);
  end loop;
  update teams set coach_code = v_code, coach_code_expires_at = now() + interval '30 days' where id = p_team_id;
  return v_code;
end $function$;

CREATE OR REPLACE FUNCTION public.regenerate_team_code(p_team_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can reset the team code'; end if;
  loop c := gen_join_code(8); exit when not exists (select 1 from teams where join_code = c); end loop;
  update teams set join_code = c, join_code_expires_at = now() + interval '90 days' where id = p_team_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_team_code', 'teams', p_team_id, jsonb_build_object('team_id', p_team_id));
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_coach_code(p_code text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_team uuid; v_exp timestamptz; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select id, coach_code_expires_at into v_team, v_exp
    from teams where upper(coach_code) = upper(trim(p_code)) and coach_code is not null;
  if v_team is null then raise exception 'That coach code did not match any team.'; end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'That coach code has expired. Ask a team admin to regenerate it.';
  end if;
  insert into team_memberships (team_id, user_id, role, status)
    values (v_team, v_uid, 'coach', 'confirmed')
    on conflict (team_id, user_id, role) do update set status = 'confirmed';
  return v_team;
end $function$;

CREATE OR REPLACE FUNCTION public.preview_roster_by_code(p_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); t_id uuid; v_exp timestamptz; t_name text; players jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id, name, join_code_expires_at into t_id, t_name, v_exp from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'This team code has expired. Ask a team coach to regenerate it.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', p.id,
           'first_name', split_part(p.name, ' ', 1),
           'jersey', pt.jersey_number,
           'claimed', exists (select 1 from parent_player_links l where l.player_id = p.id)
         ) order by p.name), '[]'::jsonb)
    into players
    from player_teams pt
    join players p on p.id = pt.player_id
    where pt.team_id = t_id;
  return jsonb_build_object('team_id', t_id, 'team_name', t_name, 'players', players);
end $function$;

CREATE OR REPLACE FUNCTION public.preview_guardian_code(p_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); p_id uuid; v_exp timestamptz; nm text; n int; mine boolean; seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id, expires_at into p_id, v_exp from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'This code has expired. Ask the family to regenerate it.';
  end if;
  select split_part(name, ' ', 1) into nm from players where id = p_id;
  select count(*) into n from parent_player_links where player_id = p_id;
  select exists (select 1 from parent_player_links where player_id = p_id and parent_user_id = uid) into mine;
  select exists (
    select 1 from player_guardian_seats
     where player_id = p_id and granted_to_user_id = uid and revoked_at is null
  ) into seat;
  return jsonb_build_object(
    'player_id', p_id, 'first_name', nm, 'guardian_count', n,
    'already_mine', mine, 'has_seat', seat, 'full', n >= 4,
    'can_buy_seat', (n >= 4 and not mine and not seat)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_any_code(p_code text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c text := upper(trim(coalesce(p_code, ''))); v_team uuid; v_tname text; v_player uuid; v_pname text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if c = '' then return json_build_object('type', null); end if;

  select id, name into v_team, v_tname from teams
   where upper(join_code) = c and (join_code_expires_at is null or join_code_expires_at > now()) limit 1;
  if v_team is not null then
    return json_build_object('type', 'team', 'team_id', v_team, 'team_name', v_tname);
  end if;

  select id, name into v_team, v_tname from teams
   where coach_code is not null and upper(coach_code) = c
     and (coach_code_expires_at is null or coach_code_expires_at > now()) limit 1;
  if v_team is not null then
    return json_build_object('type', 'coach', 'team_id', v_team, 'team_name', v_tname);
  end if;

  select p.id, split_part(p.name, ' ', 1) into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c and (gc.expires_at is null or gc.expires_at > now()) limit 1;
  if v_player is not null then
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  return json_build_object('type', null);
end $function$;

notify pgrst, 'reload schema';
