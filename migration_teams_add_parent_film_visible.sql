-- Applied live 2026-08-29 via Supabase MCP (apply_migration).
--
-- Slice 1 of the "Family Film Room" plan (docs/PARENT_FILM_ROOM_PLAN.md):
-- the per-team coach toggle. When true, a parent linked to a roster kid can see
-- (and, in a later slice, make highlights from) their OWN kid's tagged games from
-- this team's coach-uploaded film. Enforcement lives in RLS in a later slice
-- (the parent branches of videos_read / clips_read will require this column);
-- this slice only stores the setting and exposes it in team-settings.
--
-- Default TRUE (decision D1) so the feature helps by default once the downstream
-- slices land; coaches can turn it off per team. Additive + defaulted, so no
-- existing row is affected and team creation is never blocked.

alter table public.teams
  add column if not exists parent_film_visible boolean not null default true;
