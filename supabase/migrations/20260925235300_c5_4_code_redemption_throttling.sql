-- C.5 step 4 — layered throttling + uniform failures on the code surfaces.
--
-- THRESHOLDS (Adam, 2026-09-25)
--   per-user : 10 failed protected-code attempts in 15 minutes  -> that user is throttled
--   global   : 300 failed protected-code attempts in 60 seconds  -> circuit breaker
--   The goal is NOT normal-user rate limiting. A real family enters a code a handful of
--   times; 10 failures in 15 minutes is far above that and far below automated speed.
--
-- =====================================================================================
-- THE TRANSACTIONAL LIMIT — READ THIS BEFORE CHANGING ANYTHING HERE
-- =====================================================================================
--   A failed attempt can only be COUNTED if the function returns normally. PostgREST runs
--   each RPC in one transaction, so if the function RAISEs, its own INSERT into
--   code_attempts is rolled back with it and the failure is never recorded.
--
--   So each protected surface is handled according to what its CLIENT can tolerate:
--
--   RECORDS FAILURES (converted to a uniform non-raising "not found"):
--     resolve_any_code        already returned {"type": null} for no match
--     preview_roster_by_code  -> returns NULL;  join-team.tsx  does `if (error || !data)`
--     preview_guardian_code   -> returns NULL;  claim-kid.tsx  does `if (error || !data)`
--     redeem_coach_code       -> returns NULL;  join-coach.tsx does `if (error || !data)`
--   All four now answer invalid / expired / nonmatching IDENTICALLY, which both satisfies
--   the generic-response requirement and removes the validity oracle.
--
--   CANNOT RECORD FAILURES (must keep raising):
--     claim_roster_spot        join-team.tsx checks ONLY `if (error)`
--     claim_or_link_guardian   claim-kid.tsx  checks ONLY `if (error)`
--   Returning NULL from these would make the UI report success on a failed claim, which is
--   worse than the throttling gap. They still run the guard on ENTRY (reading failures
--   recorded by the other four) and still record SUCCESSES. Persisting their failures
--   needs an out-of-transaction write: dblink is AVAILABLE but NOT INSTALLED on this
--   project, and installing an extension is out of scope for C.5. Flagged as follow-up.
--
--   This is not a material hole: enumeration happens on the four surfaces that DO record.
--   You cannot reach a claim RPC without already possessing a code that a recording
--   surface would have gated.
--
-- NETWORK IDENTITY
--   Postgres sees only the pooled PostgREST connection, not the caller's address. There is
--   no trustworthy client/IP identifier at this layer, so NO network bucket is implemented
--   and none is faked (Adam, 2026-09-25). If one is ever needed it must be passed from the
--   edge and treated as untrusted input, or enforced at the gateway.
--
-- RETENTION
--   code_attempts grows roughly with code-entry volume and is never read beyond a 15-minute
--   window. It should be pruned periodically, e.g.
--       delete from public.code_attempts where attempted_at < now() - interval '30 days';
--   Deliberately NOT scheduled here: C.5 does not introduce pg_cron for cleanup. Until a
--   sweep exists this table is append-only and must be watched for size.

-- ============================================================
-- 1. The ledger. NO code material of any kind — not the code, not a hash, not a length.
-- ============================================================
create table if not exists public.code_attempts (
  id            bigserial primary key,
  actor_user_id uuid,                    -- auth.uid(); all protected RPCs require auth
  surface       text        not null,    -- which RPC was attempted
  succeeded     boolean     not null,
  attempted_at  timestamptz not null default now()
);

comment on table public.code_attempts is
  'Throttling ledger for the protected code surfaces. Records WHO attempted WHICH surface and WHETHER it succeeded — never any code material, hashed or otherwise. Append-only; see the retention note in migration c5_4.';

-- Bounded index range scans for the two counting windows; no full table scan per attempt.
create index if not exists code_attempts_user_fail_window
  on public.code_attempts (actor_user_id, attempted_at) where not succeeded;
create index if not exists code_attempts_global_fail_window
  on public.code_attempts (attempted_at) where not succeeded;

-- Not client-readable at all: only the SECURITY DEFINER functions below touch it.
alter table public.code_attempts enable row level security;
revoke all on public.code_attempts from anon, authenticated;
revoke all on sequence public.code_attempts_id_seq from anon, authenticated;

-- ============================================================
-- 2. Guard + recorder. Internal only.
-- ============================================================
create or replace function public.code_attempt_guard(p_surface text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user_fails int; v_global_fails int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select count(*) into v_user_fails
    from public.code_attempts
   where actor_user_id = auth.uid()
     and not succeeded
     and attempted_at > now() - interval '15 minutes';
  if v_user_fails >= 10 then
    raise exception 'Too many code attempts. Please wait a few minutes and try again.'
      using errcode = '54000';
  end if;

  -- Circuit breaker: independent of user id, so rotating accounts does not reset it.
  select count(*) into v_global_fails
    from public.code_attempts
   where not succeeded
     and attempted_at > now() - interval '60 seconds';
  if v_global_fails >= 300 then
    raise exception 'Too many code attempts. Please wait a few minutes and try again.'
      using errcode = '54000';
  end if;
end $function$;

create or replace function public.record_code_attempt(p_surface text, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.code_attempts (actor_user_id, surface, succeeded)
  values (auth.uid(), p_surface, p_succeeded);
end $function$;

revoke execute on function public.code_attempt_guard(text)          from public, anon, authenticated;
revoke execute on function public.record_code_attempt(text, boolean) from public, anon, authenticated;

-- ============================================================
-- 3. resolve_any_code — guard + record. Volatility changes STABLE -> VOLATILE because it
--    now writes the ledger. Signature and return shape are unchanged.
-- ============================================================
create or replace function public.resolve_any_code(p_code text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c text := upper(trim(coalesce(p_code, ''))); v_team uuid; v_tname text; v_player uuid; v_pname text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('resolve_any_code');

  if c = '' then
    perform public.record_code_attempt('resolve_any_code', false);
    return json_build_object('type', null);
  end if;

  select id, name into v_team, v_tname from teams
   where upper(join_code) = c and (join_code_expires_at is null or join_code_expires_at > now()) limit 1;
  if v_team is not null then
    perform public.record_code_attempt('resolve_any_code', true);
    return json_build_object('type', 'team', 'team_id', v_team, 'team_name', v_tname);
  end if;

  select id, name into v_team, v_tname from teams
   where coach_code is not null and upper(coach_code) = c
     and (coach_code_expires_at is null or coach_code_expires_at > now()) limit 1;
  if v_team is not null then
    perform public.record_code_attempt('resolve_any_code', true);
    return json_build_object('type', 'coach', 'team_id', v_team, 'team_name', v_tname);
  end if;

  select p.id, split_part(p.name, ' ', 1) into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c and (gc.expires_at is null or gc.expires_at > now()) limit 1;
  if v_player is not null then
    perform public.record_code_attempt('resolve_any_code', true);
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  perform public.record_code_attempt('resolve_any_code', false);
  return json_build_object('type', null);
end $function$;

-- ============================================================
-- 4. preview_roster_by_code — invalid AND expired now both return NULL (uniform).
-- ============================================================
create or replace function public.preview_roster_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); t_id uuid; v_exp timestamptz; t_name text; players jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('preview_roster_by_code');

  select id, name, join_code_expires_at into t_id, t_name, v_exp
    from teams where join_code = upper(trim(p_code));

  -- Uniform failure: unknown code and expired code are indistinguishable from outside.
  if t_id is null or (v_exp is not null and v_exp <= now()) then
    perform public.record_code_attempt('preview_roster_by_code', false);
    return null;
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

  perform public.record_code_attempt('preview_roster_by_code', true);
  return jsonb_build_object('team_id', t_id, 'team_name', t_name, 'players', players);
end $function$;

-- ============================================================
-- 5. preview_guardian_code — invalid AND expired now both return NULL (uniform).
-- ============================================================
create or replace function public.preview_guardian_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); p_id uuid; v_exp timestamptz; nm text; n int; mine boolean; seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('preview_guardian_code');

  select player_id, expires_at into p_id, v_exp
    from player_guardian_codes where code = upper(trim(p_code));

  if p_id is null or (v_exp is not null and v_exp <= now()) then
    perform public.record_code_attempt('preview_guardian_code', false);
    return null;
  end if;

  select split_part(name, ' ', 1) into nm from players where id = p_id;
  select count(*) into n from parent_player_links where player_id = p_id;
  select exists (select 1 from parent_player_links where player_id = p_id and parent_user_id = uid) into mine;
  select exists (
    select 1 from player_guardian_seats
     where player_id = p_id and granted_to_user_id = uid and revoked_at is null
  ) into seat;

  perform public.record_code_attempt('preview_guardian_code', true);
  return jsonb_build_object(
    'player_id', p_id, 'first_name', nm, 'guardian_count', n,
    'already_mine', mine, 'has_seat', seat, 'full', n >= 4,
    'can_buy_seat', (n >= 4 and not mine and not seat)
  );
end $function$;

-- ============================================================
-- 6. redeem_coach_code — invalid AND expired now both return NULL (uniform).
--    join-coach.tsx checks `if (error || !data)`, so NULL surfaces its own message.
-- ============================================================
create or replace function public.redeem_coach_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_team uuid; v_exp timestamptz; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  perform public.code_attempt_guard('redeem_coach_code');

  select id, coach_code_expires_at into v_team, v_exp
    from teams where upper(coach_code) = upper(trim(p_code)) and coach_code is not null;

  if v_team is null or (v_exp is not null and v_exp <= now()) then
    perform public.record_code_attempt('redeem_coach_code', false);
    return null;
  end if;

  insert into team_memberships (team_id, user_id, role, status)
    values (v_team, v_uid, 'coach', 'confirmed')
    on conflict (team_id, user_id, role) do update set status = 'confirmed';

  perform public.record_code_attempt('redeem_coach_code', true);
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (v_uid, 'redeem_coach_code', 'team_memberships', v_team,
          jsonb_build_object('team_id', v_team));
  return v_team;
end $function$;

-- ============================================================
-- 7. claim_roster_spot — guard on entry + record SUCCESS. Keeps raising on failure
--    because join-team.tsx checks only `if (error)`.
-- ============================================================
create or replace function public.claim_roster_spot(p_code text, p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('claim_roster_spot');

  select id into t_id from teams
   where join_code = upper(trim(p_code))
     and (join_code_expires_at is null or join_code_expires_at > now());
  if t_id is null then raise exception 'Invalid team code'; end if;
  if not exists (select 1 from player_teams
                  where team_id = t_id and player_id = p_player_id and left_on is null) then
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

  perform public.record_code_attempt('claim_roster_spot', true);
  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'claim_roster_spot', uid, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'team_id', t_id));
  return p_player_id;
end $function$;

-- ============================================================
-- 8. claim_or_link_guardian — guard on entry + record SUCCESS. Keeps raising.
-- ============================================================
create or replace function public.claim_or_link_guardian(p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); p_id uuid; n int; has_seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('claim_or_link_guardian');

  select player_id into p_id from player_guardian_codes
   where code = upper(trim(p_code)) and (expires_at is null or expires_at > now());
  if p_id is null then raise exception 'Invalid code'; end if;

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
    insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
    values (uid, 'claim_or_link_guardian', uid, 'parent_player_links', p_id,
            jsonb_build_object('player_id', p_id));
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt
   where pt.player_id = p_id and pt.left_on is null
  on conflict (team_id, user_id, role)
  do update set left_on = null, status = 'confirmed';

  perform public.record_code_attempt('claim_or_link_guardian', true);
  return p_id;
end $function$;

notify pgrst, 'reload schema';
