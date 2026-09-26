-- CHAIN REPAIR (recovered from the production migration ledger, 2026-09-25).
-- Applied to production as ledger version 20260904035133 but never committed as a
-- replayable file, which is one of the reasons `supabase start` could not rebuild
-- production. Text below is exactly what production executed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('was_on_roster','roster_for_season','season_for_date',
                        'team_seasons','set_season_window')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
