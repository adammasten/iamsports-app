-- migration_retire_name_based_duplicate_suggester.sql
-- Slice A (Adam, 2026-09-23). Name-based duplicate suggestion is RETIRED, not tuned.
--
-- WHY
--   The live body matched two players as possible duplicates when
--     similarity(pa.name, pb.name) > 0.3
--     OR lower(split_part(pa.name,' ',1)) = lower(split_part(pb.name,' ',1))   <-- exact FIRST-NAME equality
--   scoped to players sharing one team. Replaying that predicate across all 7
--   live teams returned exactly ONE pair: Jackson Schneider / Jackson Tochman —
--   two different children on one roster, offered an irreversible "Combine".
--   It surfaced NONE of the nine real duplicates in the database, because those
--   pairs sit on different teams and the predicate only compares within a team.
--   Settled product rule: names never establish identity, and no automatic
--   name-based merging. Tuning the threshold is not a fix.
--
-- WHY THE FUNCTION IS KEPT (not dropped)
--   app/(tabs)/roster.tsx calls this RPC on every focus of the Roster tab, and
--   builds already installed on phones (TestFlight 57) keep calling it. Dropping
--   it would make those builds throw; returning an EMPTY SET makes their banner
--   stop rendering (it renders only when length > 0) with no client update and no
--   App Store wait. The signature must therefore stay byte-identical.
--
-- SIGNATURE / DRIFT NOTE  (this is the important part)
--   The signature below is the LIVE 5-column one:
--     TABLE(keep_id uuid, keep_name text, dup_id uuid, dup_name text, sim real)
--   migration_merge_dupe_counts.sql EXISTS IN THIS REPOSITORY (committed
--   2026-08-13, commit e12e557) and would have widened this to 9 columns
--   (keep_guardians / keep_content / dup_guardians / dup_content), but it was
--   NEVER APPLIED TO PRODUCTION. Production still has the original 5-column
--   function from migration_merge_players.sql, which the 2026-09-03 production
--   baseline capture (supabase/migrations/20260903150504_remote_schema.sql:4118)
--   also shows. That file is deliberately left in place, unapplied and undeleted,
--   pending a repo-vs-live migration reconciliation audit. THIS migration
--   intentionally supersedes the LIVE function directly and does not depend on,
--   apply, or revert migration_merge_dupe_counts.sql.
--
--   (Consequence of that drift, for the record: because the live function never
--   returned the four count columns the client's DupePair type expects, the merge
--   chooser's per-side meta always read "Placeholder · unclaimed · No footage
--   yet", its "Recommended" badge always landed on the dup side via NaN scoring,
--   and its confirmation dialog always claimed the absorbed child was empty.)
--
-- AUTHORIZATION
--   The is_team_coach(p_team_id) OR is_super_admin() gate is PRESERVED verbatim
--   (Adam, 2026-09-23): a retired RPC is not a reason to broaden access to it.
--
-- WHAT REPLACES IT
--   A later slice adds an evidence-based conflict list built only from RECORDED
--   relationships — the same authenticated adult holding guardian links to both
--   rows, an explicit human identity assertion — never from names, nicknames,
--   jersey numbers or fuzzy similarity.
--
-- DATA
--   Modifies no data. Function body only. merge_players is deliberately left
--   byte-identical; once this returns zero rows and the client UI is removed it
--   is unreachable from every client, old and new.

create or replace function public.suggest_duplicate_players(p_team_id uuid)
returns table (keep_id uuid, keep_name text, dup_id uuid, dup_name text, sim real)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Authorization boundary preserved exactly as it was.
  if not (is_team_coach(p_team_id) or is_super_admin()) then raise exception 'Not allowed'; end if;
  -- Retired: return no rows. Name similarity never establishes identity.
  return;
end $function$;

notify pgrst, 'reload schema';
