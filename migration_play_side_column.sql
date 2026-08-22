-- =====================================================================
-- Offense / Defense / Special Teams side on plays. APPLIED LIVE via the
-- Supabase MCP (migration: play_side_column). Mirrors PlayDoc.side.
--
-- Default 'offense' (existing plays are offensive sets). Lets the Playbook split
-- and filter plays by side without parsing the diagram JSON. Special Teams is
-- football-only (enforced in the app / validatePlayDoc, not the DB).
-- =====================================================================

alter table library_plays add column if not exists side text not null default 'offense';
alter table plays add column if not exists side text not null default 'offense';

do $$ begin
  alter table library_plays add constraint library_plays_side_chk check (side in ('offense','defense','special_teams'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table plays add constraint plays_side_chk check (side in ('offense','defense','special_teams'));
exception when duplicate_object then null; end $$;

-- After applying: NOTIFY pgrst, 'reload schema';
-- =====================================================================
