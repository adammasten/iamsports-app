-- Applied live 2026-08-29 via Supabase MCP (apply_migration).
--
-- Slice 4 support (docs/PARENT_FILM_ROOM_PLAN.md): let a linked parent read their
-- OWN kid's lineup rows so the Film Room client can resolve "my kid's games".
-- Own-kid-only + toggle-aware (via is_family_film_parent), so it never widens
-- beyond the film access granted in Slice 3.
--
-- Reversible: restore game_lineups_read to (is_super_admin() OR team-member).

alter policy game_lineups_read on public.game_lineups
using (
  is_super_admin()
  or exists (select 1 from games g where g.id = game_lineups.game_id and is_team_member(g.team_id))
  or (is_linked_parent(player_id) and is_family_film_parent(game_id))
);
