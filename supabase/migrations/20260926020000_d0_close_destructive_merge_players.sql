-- Slice D0 — close the live destructive merge_players RPC.
--
-- WHY THIS IS URGENT
--   Slice A removed the duplicate banner and merge chooser from the Roster tab, but it did
--   NOT remove the RPC, and PostgREST exposes every granted function. merge_players was
--   still granted to PUBLIC, anon and authenticated, and its internal gate accepted
--       is_super_admin()
--       OR (is_linked_parent(keep) AND is_linked_parent(dup))
--       OR EXISTS (coach of a team BOTH players are on)     <-- two different families
--   while the body HARD-DELETES the losing players row and does NOT repoint
--   event_attendance or game_stat_lines (both ON DELETE CASCADE). So a coach of a team two
--   children share could destroy one of them with a single REST call. On live data that
--   meant a coach of Regents Bangels could merge Jackson Schneider and Jackson Tochman --
--   two different children with 7 and 5 tagged clips.
--
-- WHAT THIS DOES — belt and braces
--   1. REVOKE EXECUTE from PUBLIC, anon, authenticated. No client role can invoke it.
--   2. Replace the body with an unconditional refusal, so the destructive SQL no longer
--      exists in the database at all -- not merely unreachable.
--   The SIGNATURE is deliberately preserved. Build 61 (commit 45e8ae7) still contains a
--   caller in app/(tabs)/roster.tsx; dropping the function would give those installs a
--   confusing "function not found", whereas this gives a clear, actionable message. That
--   caller is already unreachable in practice because Slice A made
--   suggest_duplicate_players return zero rows, so the banner that leads to it never renders.
--
-- SUPER-ADMIN EMERGENCY PATH — deliberately NOT a granted RPC
--   Adam asked how a super admin would invoke an emergency merge without granting
--   destructive execution back to `authenticated`. The answer is that they would not, and
--   should not: super admins authenticate as the `authenticated` role like everyone else, so
--   any granted wrapper re-exposes the destructive body to the same role we are closing.
--   Until D1 ships reconcile_players, the emergency path is the PRIVILEGED DATABASE
--   CONNECTION (Supabase SQL editor / MCP, running as postgres) -- which is where a
--   one-off destructive operation belongs, is performed deliberately by a human, and needs
--   no standing grant. There is also nothing queued that needs it: reconciling the real
--   duplicates (Lars, Conrad, Tommy, Neo, Max) is D5 and is explicitly gated on D1.
--
-- DATA
--   Modifies no data. Grants and one function body only. No table, column, policy, index,
--   constraint or trigger is touched. C.5's controls are untouched.

revoke execute on function public.merge_players(uuid, uuid) from public;
revoke execute on function public.merge_players(uuid, uuid) from anon;
revoke execute on function public.merge_players(uuid, uuid) from authenticated;

create or replace function public.merge_players(p_keep uuid, p_dup uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Retired in Slice D0. The previous body hard-deleted a players row and relied on
  -- ON DELETE CASCADE, which silently destroyed event_attendance and game_stat_lines,
  -- and it accepted "coach of a team both players are on" as sufficient authority.
  -- Its replacement is reconcile_players (Slice D1): repoint-and-tombstone, never a hard
  -- delete, full per-table audit counts, and an explicit authority matrix in which coach
  -- status is never sufficient to merge two families' children.
  raise exception 'merge_players is retired and does nothing. Player reconciliation must go through reconcile_players (Slice D1), which preserves all history and requires explicit guardian authority.'
    using errcode = '0A000',
          hint = 'If you reached this from an old installed build, update the app. Reconciliation of known duplicates is tracked as Slice D5.';
end $function$;

comment on function public.merge_players(uuid, uuid) is
  'RETIRED in Slice D0 (2026-09-26). Raises unconditionally. Execute revoked from PUBLIC/anon/authenticated. Signature retained only so legacy installed builds get a clear error instead of a missing-function error. Replacement: reconcile_players (Slice D1).';

notify pgrst, 'reload schema';
