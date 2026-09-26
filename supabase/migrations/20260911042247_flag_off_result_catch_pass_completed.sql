-- migration_flag_off_result_catch_pass_completed.sql
-- Applied live via Supabase MCP, 2026-09-10 (apply_migration
-- flag_off_result_catch_pass_completed, then a rename to the role-labelled names).
-- This file reflects the FINAL live state.
--
-- Additive tag seed: more descriptive OFFENSE result tags for Flag Football.
-- "Catch (Receiver)" + "Pass completed (Passer)" split the generic "Completion"
-- and name the ROLE in the chip so a completion reads clearly from both sides via
-- grouping (e.g. "Conrad + Catch (Receiver)" and "QB + Pass completed (Passer)") —
-- the role is in the label so it's obvious which player it attributes to. Global,
-- sport-scoped to Flag Football, matching the existing off_result rows seeded by
-- migration_flag_phase_boards.sql. Guarded so re-running is a no-op (Invariant 4:
-- additive-first; the phase board already renders off_result, so these appear
-- immediately with no build required).

begin;

insert into public.tags (name, category, scope, sport, team_id, sort_order)
select v.name, 'off_result', 'global'::tag_scope, 'Flag Football', null, v.so
from (values ('Catch (Receiver)', 7), ('Pass completed (Passer)', 8)) as v(name, so)
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
--    and name in ('Catch (Receiver)','Pass completed (Passer)');
