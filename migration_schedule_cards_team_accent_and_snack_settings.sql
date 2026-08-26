-- Schedule card redesign: team accent color (wayfinding) + team-level snack
-- toggles (per event-type). Coaches already hold UPDATE on teams (that's how
-- rename works), so these columns inherit the correct RLS — no policy change.
-- Applied live via Supabase MCP 2026-08-26.

alter table public.teams
  add column if not exists accent_color text,
  add column if not exists snacks_enabled_games boolean not null default true,
  add column if not exists snacks_enabled_practices boolean not null default false;

-- Curated 12-color palette, all legible on the dark theme. A team's color is
-- assigned deterministically from its id so cards for different teams differ and
-- no team ever renders without an accent; a coach can override it in settings.
create or replace function public.assign_team_accent()
returns trigger language plpgsql as $$
declare palette text[] := array[
  '#6C63FF','#2FB380','#3B9EDB','#E0A52E','#E2574A','#A468E0',
  '#2BB3A3','#FF6A2C','#E86AA6','#86C34A','#5B8DEF','#C9A227'];
begin
  if new.accent_color is null then
    new.accent_color := palette[(abs(hashtext(new.id::text)) % array_length(palette,1)) + 1];
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_team_accent on public.teams;
create trigger trg_assign_team_accent
  before insert on public.teams
  for each row execute function public.assign_team_accent();

-- Backfill existing teams with distinct stored colors.
update public.teams
set accent_color = (array[
  '#6C63FF','#2FB380','#3B9EDB','#E0A52E','#E2574A','#A468E0',
  '#2BB3A3','#FF6A2C','#E86AA6','#86C34A','#5B8DEF','#C9A227'])[(abs(hashtext(id::text)) % 12) + 1]
where accent_color is null;
