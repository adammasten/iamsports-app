-- migration_fix_create_kid_drop_user_id.sql
-- Slice A (Adam, 2026-09-23). Production bug fix: create_kid has been raising
--   42703: column "user_id" of relation "players" does not exist
-- ever since migration_close_kid_login_doors.sql ran `alter table public.players
-- drop column if exists user_id` (kid-login doors closed, 2026-09-02). The function
-- body was never updated to match, so BOTH callers have been dead since:
--     app/select-team.tsx:314  "Add a kid" on the app home
--     app/join-team.tsx:77     "Add & join" in the parent join flow
-- (also reachable from app/onboarding.tsx:71 -> /select-team?action=newkid).
-- Consistent with that: the newest teamless player in production was created
-- 2026-08-24, i.e. nothing has been created through this path since the drop.
--
-- SCOPE: exactly ONE line changes — the INSERT column list.
--     before: insert into players (name, team_id, user_id) values (clean_name, null, null)
--     after:  insert into players (name, team_id)          values (clean_name, null)
-- Every other line is byte-identical to the live body. Grants are preserved by
-- CREATE OR REPLACE and are deliberately not restated.
--
-- DELIBERATELY NOT CHANGED IN THIS SLICE (planned later, per the identity plan):
--   * still NOT idempotent — a double tap can still create two children; the
--     explicit request-id fix is a later slice, and must never key on a name
--   * does not set players.player_lineage_id, so a new child gets NULL (22/49 rows
--     are already NULL); lineage maintenance is a later slice
--   * no cap or rate limit on children per adult (pre-existing behaviour)
--
-- DATA: modifies no data. Function body only.

create or replace function public.create_kid(name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(name, ''));
  new_id uuid;
  c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if clean_name = '' then raise exception 'Kid name is required'; end if;

  insert into players (name, team_id) values (clean_name, null) returning id into new_id;
  insert into parent_player_links (parent_user_id, player_id, relationship) values (uid, new_id, 'parent');

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return new_id;
end $function$;

notify pgrst, 'reload schema';
