-- migration_fix_roster_placeholder_ambiguous.sql
--
-- FIX: "column reference \"player_id\" is ambiguous" when a coach adds a roster
-- placeholder ("hold a spot"). create_roster_placeholder is declared
-- `returns table (player_id uuid, guardian_code text)`, which puts a function
-- variable named `player_id` in scope for the whole body. The player_teams
-- insert's `on conflict (player_id, team_id)` then can't tell that OUT variable
-- from the player_teams.player_id column, and PL/pgSQL's default
-- variable_conflict = error raises. (join_team_with_code has the same ON CONFLICT
-- but no player_id variable, so only the placeholder path broke.)
--
-- Minimal, signature-preserving fix: the `#variable_conflict use_column`
-- directive tells PL/pgSQL to resolve an ambiguous name to the COLUMN. That's
-- what we want in the ON CONFLICT target; the only other reference is the
-- positional `return query select new_id, c` (unaffected). Return column names
-- stay `player_id` / `guardian_code`.

create or replace function public.create_roster_placeholder(p_team_id uuid, p_name text, p_jersey text default null)
returns table (player_id uuid, guardian_code text)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare uid uuid := auth.uid(); new_id uuid; c text; v_name text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can add roster spots'; end if;

  v_name := coalesce(nullif(trim(p_name), ''), '#' || nullif(trim(p_jersey), ''));
  if v_name is null then raise exception 'A name or jersey number is required'; end if;

  insert into players (name, team_id, jersey_number)
  values (v_name, p_team_id, nullif(trim(p_jersey), ''))
  returning id into new_id;

  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (new_id, p_team_id, nullif(trim(p_jersey), ''), uid)
  on conflict (player_id, team_id) do nothing;

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return query select new_id, c;
end $$;

notify pgrst, 'reload schema';
