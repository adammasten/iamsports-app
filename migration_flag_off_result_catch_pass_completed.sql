-- migration_flag_off_result_catch_pass_completed.sql
-- Applied live via Supabase MCP apply_migration (name: flag_off_result_catch_pass_completed), 2026-09-10.
--
-- Additive tag seed: more descriptive OFFENSE result tags for Flag Football.
-- "Catch" (receiver side) + "Pass completed" (passer side) split the generic
-- "Completion" so a completion play can be tagged from both roles via grouping
-- (e.g. "Conrad + Catch" and "QB + Pass completed"). Global, sport-scoped to Flag
-- Football, matching the existing off_result rows seeded by
-- migration_flag_phase_boards.sql. Guarded so re-running is a no-op (Invariant 4:
-- additive-first; the phase board already renders off_result, so these appear
-- immediately with no build required).

begin;

insert into public.tags (name, category, scope, sport, team_id, sort_order)
select v.name, 'off_result', 'global'::tag_scope, 'Flag Football', null, v.so
from (values ('Catch', 7), ('Pass completed', 8)) as v(name, so)
where not exists (
  select 1 from public.tags t
  where t.category = 'off_result'
    and t.scope = 'global'
    and t.sport = 'Flag Football'
    and t.name = v.name
);

commit;

-- ROLLBACK (manual, if ever needed):
-- delete from public.tags
--  where category='off_result' and scope='global' and sport='Flag Football'
--    and name in ('Catch','Pass completed');
