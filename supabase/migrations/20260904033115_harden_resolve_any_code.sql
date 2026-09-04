-- Close the anonymous code-enumeration oracle.
--
-- FOUND 2026-09-03, verified by unauthenticated curl against production:
--   POST /rest/v1/rpc/resolve_any_code   (apikey only, NO Authorization header)
--     {"p_code":"ZZZZZZ"} -> HTTP 200 {"type": null}
--     {"p_code":"<real>"} -> HTTP 200 {"type":"team","team_id":"...","team_name":"..."}
--
-- The publishable key ships in the web bundle at iamsports.com, so ANY visitor
-- could guess codes at line rate, with no account and nothing to attribute. A
-- guardian-code hit returned a CHILD'S NAME and player_id to an anonymous caller.
--
-- Root cause, two parts:
--   1. resolve_any_code is the only function in the code family with NO
--      `auth.uid() is null` guard. Its siblings all raise 'not signed in'
--      (verified: redeem_coach_code returns HTTP 400 to anon).
--   2. `anon` holds EXECUTE on the whole family by default.
--
-- Fix: add the missing guard AND revoke anon EXECUTE (defense in depth — the
-- siblings' internal guards stay, but anon shouldn't reach them at all).
--
-- SAFE TO REVOKE: every caller is post-login. app/_layout.tsx routes logged-out
-- users away from everything except /landing, /login, /terms, /privacy, and none
-- of those four call any of these RPCs. Callers verified 2026-09-03:
--   onboarding.tsx -> resolve_any_code      join-team.tsx  -> preview_roster_by_code
--   join-coach.tsx -> redeem_coach_code     claim-kid.tsx  -> preview_guardian_code,
--   lib/core/tagging-jobs.ts -> redeem_tagger_code           claim_or_link_guardian
--
-- Expiry logic from migration 20260903160000_harden_join_codes is preserved
-- VERBATIM below — do not drop those `*_expires_at` checks.

-- 1. Auth guard + minimise what a hit discloses.
create or replace function public.resolve_any_code(p_code text)
returns json language plpgsql stable security definer set search_path to 'public' as $function$
declare c text := upper(trim(coalesce(p_code, ''))); v_team uuid; v_tname text; v_player uuid; v_pname text;
begin
  -- THE FIX: this function had no auth check. Without it the whole body was an
  -- open oracle for anyone holding the publishable key.
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

  -- Minimisation: return the kid's FIRST name only, matching what
  -- preview_guardian_code already does (split_part(name,' ',1)). This function
  -- previously returned the full name, so an authenticated enumerator learned
  -- more from a hit here than from the dedicated preview. The caller
  -- (onboarding.tsx) only routes on `type`; it does not render this field.
  select p.id, split_part(p.name, ' ', 1) into v_player, v_pname
  from player_guardian_codes gc join players p on p.id = gc.player_id
  where upper(gc.code) = c and (gc.expires_at is null or gc.expires_at > now()) limit 1;
  if v_player is not null then
    return json_build_object('type', 'player', 'player_id', v_player, 'first_name', v_pname);
  end if;

  return json_build_object('type', null);
end $function$;

-- 2. Revoke anon EXECUTE across the code family (all overloads, skip absent ones).
--
-- MUST revoke from PUBLIC, not just anon. Supabase grants these to PUBLIC by
-- default (the leading `=X/postgres` ACL entry), and `anon` INHERITS that — so
-- `revoke ... from anon` alone is a no-op. Verified on the local dev DB:
-- after revoking from anon only, has_function_privilege('anon', ..., 'EXECUTE')
-- was still true and an anon HTTP call still entered the function body.
-- Revoke PUBLIC, then re-grant explicitly to the roles that should have it.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'resolve_any_code',
        'preview_guardian_code', 'preview_roster_by_code',
        'claim_or_link_guardian', 'claim_roster_spot',
        'join_team_with_code', 'redeem_coach_code', 'redeem_tagger_code',
        'grant_guardian_seat',
        'regenerate_team_code', 'regenerate_coach_code', 'regenerate_guardian_code',
        'revoke_team_code', 'revoke_coach_code', 'revoke_guardian_code'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
