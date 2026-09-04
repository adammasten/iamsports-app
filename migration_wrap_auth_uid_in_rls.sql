-- Wrap auth.uid() in a scalar subquery across all RLS policies (perf hardening).
--
-- Postgres re-evaluates a bare auth.uid() ONCE PER ROW scanned; wrapping it as
-- (select auth.uid()) makes it an InitPlan evaluated ONCE PER QUERY. Same value,
-- same access decisions — purely a scale optimization. This was Supabase's #1
-- flagged performance lint (auth_rls_initplan, 72 policies) — 0 after this.
--
-- Applied via a DO block that regenerates each ALTER POLICY from prod's own live
-- pg_policies text, so it exactly matches whatever is deployed and can't drift
-- from a stale generated statement. Idempotent: the WHERE skips any policy already
-- select-wrapped (incl. player_guardian_seats_read, which already used
-- (SELECT auth.uid() AS uid)). Only USING/WITH CHECK expressions change — policy
-- names, roles, and commands are untouched.
--
-- Verified on the local dev DB before prod: 72 policies wrapped, 0 truly-bare
-- auth.uid() remaining, and an RLS enforcement spot-check (a coach sees own team
-- video; a stranger is blocked) still passes. Post-apply prod advisor: 0
-- auth_rls_initplan.
do $$
declare r record; stmt text;
begin
  for r in
    select policyname, schemaname, tablename, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) ~ 'auth\.uid\(\)'
      and (coalesce(qual,'') || coalesce(with_check,'')) !~* 'select auth\.uid'
  loop
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      stmt := stmt || ' using (' || regexp_replace(r.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g') || ')';
    end if;
    if r.with_check is not null then
      stmt := stmt || ' with check (' || regexp_replace(r.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g') || ')';
    end if;
    execute stmt;
  end loop;
end $$;
