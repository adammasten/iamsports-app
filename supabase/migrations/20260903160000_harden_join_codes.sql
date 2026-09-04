-- Canonical copy: root migration_harden_join_codes.sql (kept for the live-sync convention).
-- Placed here (timestamp after the baseline) so 'supabase db reset' + future branching replay it.

-- Harden the team/coach/guardian join codes (item #1 of the pre-launch hardening list).
--
-- BEFORE: teams.coach_code, teams.join_code, and player_guardian_codes.code were
-- permanent (never expired), could not be revoked without minting a replacement,
-- and were short enough (6 chars) to brute-force. The coach code is the worst
-- offender — it grants a 'coach' membership, i.e. read access to EVERY kid's film
-- on the team — so a leaked coach code was a permanent, un-killable data leak.
--
-- This is a SECURITY fix, distinct from the guardian PAID-SEAT cap (that "4
-- guardians per kid, 5th+ pays" model already shipped 2026-09-02 via
-- player_guardian_seats and is untouched here). Codes need expiry + rotation +
-- brute-force resistance, NOT a use-counter.
--
-- THREE protections, all database-only (no app change, effective on every build):
--   1. Expiry  — coach 30d, team 90d, guardian 90d; set on every mint/regenerate,
--      backfilled onto existing codes from today. Expired codes fail with a clear
--      "regenerate it" message (never silently).
--   2. Revoke  — revoke_{coach,team,guardian}_code() null the code outright, to kill
--      a leak without minting a replacement (regenerate_* still rotates as before).
--   3. High entropy — new codes are longer (coach 10 hex ~1.1e12, team/guardian
--      8 chars over a 31-char alphabet ~8.5e11), making online brute-force within
--      the expiry window infeasible. Existing short codes are left to auto-expire.
--
-- (A per-attempt rate-limit throttle was considered but deferred: a raised error
-- rolls back its own attempt-log row in PostgREST, and dblink/pg_net autonomous
-- logging isn't available here — so a durable throttle needs the redeem functions
-- to return-status instead of raise, i.e. app changes. Expiry + revoke + entropy
-- close the hole without it; throttle can come later as defense-in-depth.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columns + backfill
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.teams
  add column if not exists coach_code_expires_at timestamptz,
  add column if not exists join_code_expires_at  timestamptz;

alter table public.player_guardian_codes
  add column if not exists expires_at timestamptz;

-- New guardian codes (create_kid / create_roster_placeholder insert without an
-- explicit expires_at) get a 90-day life automatically.
alter table public.player_guardian_codes
  alter column expires_at set default (now() + interval '90 days');

-- Backfill existing codes from today so nothing stays permanent.
update public.teams
   set coach_code_expires_at = now() + interval '30 days'
 where coach_code is not null and coach_code_expires_at is null;
update public.teams
   set join_code_expires_at = now() + interval '90 days'
 where join_code is not null and join_code_expires_at is null;
update public.player_guardian_codes
   set expires_at = now() + interval '90 days'
 where code is not null and expires_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Redeem / preview functions — reject expired codes with a clear message
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a. Coach code → coach membership (read access to every kid) — the priority.
create or replace function public.redeem_coach_code(p_code text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
end
$function$;

-- 2b. Team join code → add guardian's own player + parent membership.
create or replace function public.join_team_with_code(p_code text, p_player_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); t_id uuid; v_exp timestamptz;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_player_id) then
    raise exception 'You are not a guardian of this player';
  end if;
  select id, join_code_expires_at into t_id, v_exp from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'This team code has expired. Ask a team coach to regenerate it.';
  end if;

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (p_player_id, t_id, uid)
  on conflict (player_id, team_id) do update set left_at = null;
  update players set team_id = t_id where id = p_player_id and team_id is null;

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;
  return t_id;
end
$function$;

-- 2c. Team join code → claim an unclaimed roster spot.
create or replace function public.claim_roster_spot(p_code text, p_player_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); t_id uuid; v_exp timestamptz;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id, join_code_expires_at into t_id, v_exp from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'This team code has expired. Ask a team coach to regenerate it.';
  end if;
  if not exists (select 1 from player_teams where team_id = t_id and player_id = p_player_id) then
    raise exception 'That player is not on this team';
  end if;

  perform 1 from players where id = p_player_id for update;

  if exists (select 1 from parent_player_links where player_id = p_player_id) then
    raise exception 'This player is already claimed — ask their family for their invite code to be added.';
  end if;

  insert into parent_player_links (parent_user_id, player_id, relationship)
  values (uid, p_player_id, 'parent');

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;
  return p_player_id;
end
$function$;

-- 2d. Guardian code → become a guardian (keeps the 4-guardian cap + paid-seat
--     check exactly as before; only adds the expiry check).
create or replace function public.claim_or_link_guardian(p_code text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); p_id uuid; v_exp timestamptz; n int; has_seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id, expires_at into p_id, v_exp from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;
  if v_exp is not null and v_exp <= now() then
    raise exception 'This code has expired. Ask the family to regenerate it.';
  end if;

  perform 1 from players where id = p_id for update;

  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
    select count(*) into n from parent_player_links where player_id = p_id;
    select exists (
      select 1 from player_guardian_seats
       where player_id = p_id and granted_to_user_id = uid and revoked_at is null
    ) into has_seat;
    if n >= 4 and not has_seat then
      raise exception 'This player already has the maximum of 4 guardians';
    end if;
    insert into parent_player_links (parent_user_id, player_id, relationship)
    values (uid, p_id, case when n = 0 then 'parent' else 'guardian' end);
    update player_guardian_codes set last_used_at = now() where player_id = p_id;
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt where pt.player_id = p_id
  on conflict (team_id, user_id, role) do nothing;
  return p_id;
end
$function$;

-- 2e. resolve_any_code — onboarding auto-detect. Ignore expired codes so an
--     expired code resolves to "not found" rather than a live match.
create or replace function public.resolve_any_code(p_code text)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare c text := upper(trim(coalesce(p_code, ''))); v_team uuid; v_tname text; v_player uuid; v_pname text;
begin
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

  select p.id, p.name into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c and (gc.expires_at is null or gc.expires_at > now()) limit 1;
  if v_player is not null then
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  return json_build_object('type', null);
end
$function$;

-- 2f. preview_roster_by_code — reject expired codes.
create or replace function public.preview_roster_by_code(p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
end
$function$;

-- 2g. preview_guardian_code — reject expired codes.
create or replace function public.preview_guardian_code(p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    'player_id', p_id,
    'first_name', nm,
    'guardian_count', n,
    'already_mine', mine,
    'has_seat', seat,
    'full', n >= 4,
    'can_buy_seat', (n >= 4 and not mine and not seat)
  );
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Regenerate functions — mint a LONGER code + set a fresh expiry
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.regenerate_coach_code(p_team_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_code text;
begin
  if not (is_super_admin() or is_team_coach(p_team_id)) then raise exception 'not authorized'; end if;
  loop
    v_code := upper(substring(md5(gen_random_uuid()::text) for 10));   -- 10 hex chars
    exit when not exists (select 1 from teams where coach_code = v_code);
  end loop;
  update teams set coach_code = v_code, coach_code_expires_at = now() + interval '30 days' where id = p_team_id;
  return v_code;
end
$function$;

create or replace function public.regenerate_team_code(p_team_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can reset the team code'; end if;
  loop c := gen_join_code(8); exit when not exists (select 1 from teams where join_code = c); end loop;
  update teams set join_code = c, join_code_expires_at = now() + interval '90 days' where id = p_team_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_team_code', 'teams', p_team_id, jsonb_build_object('team_id', p_team_id));
  return c;
end
$function$;

create or replace function public.regenerate_guardian_code(p_player_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()) then
    raise exception 'Only a guardian can reset this code';
  end if;
  loop c := gen_join_code(8); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  update player_guardian_codes
     set code = c, last_used_at = null, expires_at = now() + interval '90 days'
   where player_id = p_player_id;
  if not found then
    insert into player_guardian_codes (player_id, code) values (p_player_id, c);
  end if;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_guardian_code', 'players', p_player_id, jsonb_build_object('player_id', p_player_id));
  return c;
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Revoke functions — kill a leaked code outright (no replacement minted)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.revoke_coach_code(p_team_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_super_admin() or is_team_coach(p_team_id)) then raise exception 'not authorized'; end if;
  update teams set coach_code = null, coach_code_expires_at = null where id = p_team_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'revoke_coach_code', 'teams', p_team_id, jsonb_build_object('team_id', p_team_id));
end
$function$;

create or replace function public.revoke_team_code(p_team_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can revoke the team code'; end if;
  update teams set join_code = null, join_code_expires_at = null where id = p_team_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'revoke_team_code', 'teams', p_team_id, jsonb_build_object('team_id', p_team_id));
end
$function$;

create or replace function public.revoke_guardian_code(p_player_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()) then
    raise exception 'Only a guardian can revoke this code';
  end if;
  update player_guardian_codes set code = null, expires_at = null where player_id = p_player_id;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'revoke_guardian_code', 'players', p_player_id, jsonb_build_object('player_id', p_player_id));
end
$function$;
