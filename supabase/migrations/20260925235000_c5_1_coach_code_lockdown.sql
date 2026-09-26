-- C.5 step 1 (Adam, 2026-09-25): close the team-code → coach-takeover path.
--
-- THE CHAIN THIS BREAKS
--   teams_read = is_super_admin() OR is_team_member(id) OR created_by_user_id = auth.uid()
--   is_team_member() is TRUE for role 'parent' and 'follower', and `authenticated`
--   held column-level SELECT on teams.coach_code. So any parent on a team could:
--       select coach_code from teams where id = <their team>
--       -> redeem_coach_code(that code)  -> team_memberships role='coach'
--       -> (before C.5 step 2) mutate parent_player_links for any child on that team
--   Link 1 of that chain dies here; step 2 kills links 3-4 independently.
--
-- WHAT CHANGES
--   1. REVOKE SELECT (coach_code) ON teams FROM authenticated, anon.
--      join_code is deliberately LEFT READABLE (Adam, 2026-09-25): it is meant to be
--      distributed to a whole team and is not the escalation secret. What possession
--      of a team code is *allowed to accomplish* is Slice D's problem, not concealment.
--      ics_token is deliberately OUT OF SCOPE for C.5 and logged as a separate
--      follow-up security item (calendar bearer token, not an escalation path).
--   2. ADD get_team_codes(p_team_id) so a coach can still read both codes through an
--      authorized path. New function; no existing signature changes.
--
-- COMPATIBILITY — measured, not assumed (see the C.5 report for the psql evidence):
--   Postgres requires SELECT privilege on every column a statement reads OR returns,
--   and PostgREST surfaces a 42501 for the whole request rather than omitting a
--   column. Two call sites are therefore affected:
--     a) app/(tabs)/roster.tsx  select('join_code, coach_code')
--        -> the WHOLE query fails, so builds <= 66 lose the team code display too,
--           not just the coach code. Rewritten on this branch to use get_team_codes.
--     b) app/select-team.tsx    .insert({...}).select().single()   <-- BARE select()
--        -> a wildcard RETURNING, which needs SELECT on coach_code. TEAM CREATION
--           would break. Rewritten on this branch to an explicit column list.
--   Every other teams read in the app names explicit columns that exclude coach_code,
--   and the Edge Functions use the service role, which is unaffected.
--   No RPC signature changes. regenerate_coach_code is deliberately untouched and
--   still returns the new code to its caller, so a coach can always obtain one.

-- 1. Remove the raw read.
--
--    IMPORTANT MECHANIC (found by testing — a column-level revoke alone is a SILENT
--    NO-OP here): public.teams carries a TABLE-level SELECT grant to authenticated and
--    anon. In Postgres, table-level SELECT subsumes column-level privileges, so
--    `revoke select (coach_code) ...` changes nothing while the table grant stands.
--    The only way to withhold one column is to revoke the table-level SELECT and
--    re-grant SELECT on the columns that remain readable.
--
--    ⚠ MAINTENANCE CONSEQUENCE: once SELECT is column-scoped, any NEW column added to
--    public.teams is NOT readable by authenticated/anon until it is explicitly granted.
--    Any future migration that adds a teams column must add a matching
--    `grant select (<new_col>) on public.teams to authenticated, anon;`.
--
--    postgres/service_role keep full SELECT (Edge Functions, support, pg_dump).
revoke select on public.teams from authenticated;
revoke select on public.teams from anon;

-- Every column EXCEPT coach_code, in ordinal order.
grant select (
  id, name, sport, created_by_user_id, created_at, grad_class, join_code, logo_path,
  require_coaches_pin, ics_token, accent_color, snacks_enabled_games,
  snacks_enabled_practices, parent_film_visible, coach_code_expires_at,
  join_code_expires_at, format
) on public.teams to authenticated;

grant select (
  id, name, sport, created_by_user_id, created_at, grad_class, join_code, logo_path,
  require_coaches_pin, ics_token, accent_color, snacks_enabled_games,
  snacks_enabled_practices, parent_film_visible, coach_code_expires_at,
  join_code_expires_at, format
) on public.teams to anon;

-- 2. The authorized replacement. Coach or super admin only; returns nothing to anyone
--    else. STABLE + SECURITY DEFINER so it can read the column the caller cannot.
create or replace function public.get_team_codes(p_team_id uuid)
returns table (
  join_code             text,
  coach_code            text,
  join_code_expires_at  timestamptz,
  coach_code_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  -- Team membership alone is NOT enough. Coach tier or super admin only.
  if not (public.is_super_admin() or public.is_team_coach(p_team_id)) then
    raise exception 'Not authorized to view this team''s codes';
  end if;
  return query
    select t.join_code, t.coach_code, t.join_code_expires_at, t.coach_code_expires_at
      from public.teams t
     where t.id = p_team_id;
end $function$;

revoke execute on function public.get_team_codes(uuid) from public, anon;
grant  execute on function public.get_team_codes(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
