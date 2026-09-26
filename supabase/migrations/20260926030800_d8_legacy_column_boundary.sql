-- ============================================================================
-- Slice D8 — LEGACY PLAYER COLUMNS: AUTHORIZATION DEPENDENCE REMOVED, COLUMNS RETAINED
--
-- THE DECISION, AND WHY IT IS NOT "FINISH THE CLEANUP"
--   Adam's brief: "If Build 68 compatibility requires leaving a legacy column physically
--   present temporarily, leave it present and stop writing/authorizing through it rather than
--   breaking the installed client. Compatibility beats cosmetic schema cleanup."
--
--   players.team_id / jersey_number / season_id are the legacy pre-spell columns. After D6,
--   NOTHING AUTHORIZES through them -- that was the dangerous part and it is done. But they
--   are still READ by an installed client:
--
--     lib/core/player-links.ts:24  (app/link-players.tsx, the coach cross-team linking screen)
--        .from('players').select('id, name, team_id, jersey_number, player_lineage_id')
--        .in('team_id', teamIds)
--
--   So dropping the columns would break that screen in Build 68, and -- worse -- so would
--   merely stopping the WRITES, because join_team_with_code sets players.team_id when a child
--   joins their first team and that screen filters on it. A newly joined child would silently
--   disappear from the coach's linking screen: exactly the kind of quiet failure this codebase
--   already has too much of.
--
--   Therefore: the columns stay, and the legacy writes stay, PURELY as a denormalised
--   convenience for that one reader. They are no longer part of any authorization decision,
--   and this migration documents that boundary in the schema itself so the next engineer does
--   not mistake "still written" for "still meaningful".
--
-- WHAT WOULD FINISH IT (the exact deferred step, not a vague promise)
--   1. Change lib/core/player-links.ts to read the roster through player_teams (open spells)
--      instead of players.team_id, and take jersey from player_teams.jersey_number.
--   2. Ship that client; confirm the install.
--   3. Then, and only then: stop writing the three columns, re-run the dependency assertion
--      below, and drop them. Invariant 4 (additive-first): ship the reading build, confirm it
--      is installed, THEN migrate.
--
-- BUILD 68 COMPATIBILITY: this migration changes no behaviour at all. It adds comments and one
-- verification function.
-- ============================================================================

comment on column public.players.team_id is
  'LEGACY (pre-spell). NOT an authorization key -- as of Slice D6 no policy, RPC or view authorises through it; player_teams (open spells) is the truth. Still written by join_team_with_code / create_roster_placeholder and still read by app/link-players.tsx in Build 68, which is the only reason it survives. Retirement plan: Slice D8 header.';

comment on column public.players.jersey_number is
  'LEGACY. The real jersey is player_teams.jersey_number (a TEAM-owned fact, per team). Retained only for Build 68''s link-players screen. Do not read it in new code.';

comment on column public.players.season_id is
  'LEGACY and unused. player_teams.season_id is the per-spell truth. Retained for Build 68 schema compatibility only.';

-- ----------------------------------------------------------------------------
-- A STANDING ASSERTION, not a one-off check
--
-- Returns any policy or function that authorises through the legacy columns. It is the gate
-- for step 3 above, and it will catch a future change that quietly reintroduces the
-- dependence -- which is exactly how this problem arrived the first time.
-- ----------------------------------------------------------------------------
create or replace function public.audit_legacy_player_column_dependence()
returns table (kind text, object_name text, detail text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- RLS policies whose expression reaches players.team_id
  select 'policy'::text,
         (p.schemaname || '.' || p.tablename || '.' || p.policyname)::text,
         left(coalesce(p.qual, p.with_check), 240)::text
    from pg_policies p
   where p.schemaname = 'public'
     and (coalesce(p.qual,'') || coalesce(p.with_check,'')) ~* '(team_id from players|players\.team_id)'
  union all
  -- functions that both read players.team_id AND make an authorization decision on it
  select 'function'::text,
         (n.nspname || '.' || pr.proname)::text,
         'reads players.team_id in an is_team_* check'::text
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'public'
     and pr.prosrc ~* '(team_id\s+from\s+(public\.)?players|players\.team_id)'
     and pr.prosrc ~* 'is_team_(coach|member)'
     and pr.proname <> 'audit_legacy_player_column_dependence'
  order by 1, 2;
$function$;

comment on function public.audit_legacy_player_column_dependence() is
  'Returns every policy/function still AUTHORISING through the legacy players.team_id. Expected result after Slice D6: zero rows. This is the gate for physically retiring the legacy columns, and a tripwire against reintroducing the dependence.';

grant execute on function public.audit_legacy_player_column_dependence() to authenticated, service_role;

notify pgrst, 'reload schema';
