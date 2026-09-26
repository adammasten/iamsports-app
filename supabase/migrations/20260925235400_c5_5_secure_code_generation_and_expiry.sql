-- C.5 step 5 — cryptographically secure code generation, and no NULL-as-permanent expiry.
--
-- WHAT WAS WRONG
--   gen_join_code() built codes from random(), a non-cryptographic PRNG whose stream is
--   predictable from observed output. Team join codes, coach codes and per-player guardian
--   codes are bearer credentials that grant access to a child's film — they must come from
--   a CSPRNG. pgcrypto is already installed, so gen_random_bytes() is available.
--
--   Separately, every expiry check read `(expires_at is null or expires_at > now())`, so a
--   NULL expiry meant "valid forever". Nothing prevented a code being created that way.
--
-- WHAT IS PRESERVED (Adam, 2026-09-25)
--   * The ambiguity-free 31-character alphabet is unchanged: ABCDEFGHJKMNPQRSTUVWXYZ23456789
--     (no I/L/O/0/1 — these get read aloud and typed by parents).
--   * Existing valid codes keep working until they expire or are revoked. NO mass rotation.
--     Live lengths in use are 6, 8 and 10; all remain valid.
--   * gen_join_code(integer) keeps its exact signature, so every caller is unchanged.
--   * ics_token is NOT touched.
--
-- NEW MINIMUM LENGTH
--   gen_join_code clamps to a floor of 8 regardless of what the caller asks for, so
--   create_kid's historical gen_join_code(6) now yields 8 without editing create_kid.
--   31^8 ≈ 8.5e11 combinations, and step 4's throttling makes online guessing impractical.

-- ============================================================
-- 1. CSPRNG generator with unbiased rejection sampling.
--    A plain `byte % 31` would bias the first 8 letters (256 = 8*31 + 8), so bytes >= 248
--    are discarded. Batches of 32 bytes keep the loop cheap.
-- ============================================================
create or replace function public.gen_join_code(len integer default 8)
returns text
language plpgsql
volatile
set search_path to 'public'
as $function$
declare
  k_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 chars, ambiguity-free
  k_n        constant int  := 31;
  k_limit    constant int  := 248;   -- 8 * 31; reject >= this to remove modulo bias
  v_len      int := greatest(coalesce(len, 8), 8);   -- launch floor: never shorter than 8
  v_out      text := '';
  v_bytes    bytea;
  v_b        int;
  i          int;
begin
  while length(v_out) < v_len loop
    v_bytes := extensions.gen_random_bytes(32);
    for i in 0..31 loop
      exit when length(v_out) >= v_len;
      v_b := get_byte(v_bytes, i);
      if v_b < k_limit then
        v_out := v_out || substr(k_alphabet, (v_b % k_n) + 1, 1);
      end if;
    end loop;
  end loop;
  return v_out;
end $function$;

comment on function public.gen_join_code(integer) is
  'CSPRNG code generator (pgcrypto gen_random_bytes) over a 31-char ambiguity-free alphabet, with rejection sampling to remove modulo bias. Minimum length 8 regardless of the argument.';

-- ============================================================
-- 2. Guardian codes must always carry an expiry.
--    create_kid and create_roster_placeholder insert (player_id, code) with no expires_at,
--    so a DEFAULT is required before the CHECK below, or those RPCs would start failing.
-- ============================================================
alter table public.player_guardian_codes
  alter column expires_at set default (now() + interval '90 days');

-- Backfill any legacy row that has a code but no expiry. Live count at authoring time: 0.
-- Uses a 90-day window from now so a legitimate family is never cut off retroactively.
update public.player_guardian_codes
   set expires_at = now() + interval '90 days'
 where code is not null and expires_at is null;

alter table public.player_guardian_codes
  drop constraint if exists player_guardian_codes_expiry_required;
alter table public.player_guardian_codes
  add constraint player_guardian_codes_expiry_required
  check (code is null or expires_at is not null);

-- ============================================================
-- 3. Team join codes and coach codes must always carry an expiry.
--    Live violations at authoring time: 0 for both.
-- ============================================================
update public.teams set join_code_expires_at  = now() + interval '90 days'
 where join_code  is not null and join_code_expires_at  is null;
update public.teams set coach_code_expires_at = now() + interval '30 days'
 where coach_code is not null and coach_code_expires_at is null;

alter table public.teams drop constraint if exists teams_join_code_expiry_required;
alter table public.teams
  add constraint teams_join_code_expiry_required
  check (join_code is null or join_code_expires_at is not null);

alter table public.teams drop constraint if exists teams_coach_code_expiry_required;
alter table public.teams
  add constraint teams_coach_code_expiry_required
  check (coach_code is null or coach_code_expires_at is not null);

-- ============================================================
-- 4. Stop treating NULL expiry as valid in the read paths.
--    With the constraints above a code can no longer HAVE a null expiry, so these branches
--    are unreachable — removing them makes the intent explicit and means a future path that
--    somehow writes a null expiry fails closed instead of minting a permanent credential.
--    resolve_any_code and redeem_coach_code are rewritten here on top of step 4's versions;
--    claim_roster_spot / claim_or_link_guardian keep step 4's bodies and are left alone.
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
   where upper(join_code) = c and join_code_expires_at > now() limit 1;
  if v_team is not null then
    perform public.record_code_attempt('resolve_any_code', true);
    return json_build_object('type', 'team', 'team_id', v_team, 'team_name', v_tname);
  end if;

  select id, name into v_team, v_tname from teams
   where coach_code is not null and upper(coach_code) = c
     and coach_code_expires_at > now() limit 1;
  if v_team is not null then
    perform public.record_code_attempt('resolve_any_code', true);
    return json_build_object('type', 'coach', 'team_id', v_team, 'team_name', v_tname);
  end if;

  select p.id, split_part(p.name, ' ', 1) into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c and gc.expires_at > now() limit 1;
  if v_player is not null then
    perform public.record_code_attempt('resolve_any_code', true);
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  perform public.record_code_attempt('resolve_any_code', false);
  return json_build_object('type', null);
end $function$;

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

  -- NULL expiry no longer counts as valid.
  if v_team is null or v_exp is null or v_exp <= now() then
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

-- Guardian-code revocation sets code = NULL, which the expiry CHECK permits; and
-- revoke_guardian_code also nulls expires_at, so a revoked row stays consistent.

notify pgrst, 'reload schema';
