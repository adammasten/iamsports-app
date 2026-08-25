-- Pre-launch security fix (audit 2026-08-24): the stats views were SECURITY DEFINER
-- (invoker off) and selectable by any authenticated user, so they exposed player
-- names + stats across ALL teams (RLS bypass / child-data leak). Flip to
-- security_invoker=on so each view respects the QUERYING user's RLS on the underlying
-- tables (clips, videos, tags, players, games, game_stat_lines — all team-scoped).
-- Legit coaches keep their own team's stats; a non-member gets nothing.
-- Applied live via Supabase MCP 2026-08-24. NOTE: re-test the stats screens after.
alter view public.stat_events          set (security_invoker = on);
alter view public.game_box_score       set (security_invoker = on);
alter view public.resolved_game_stats  set (security_invoker = on);
alter view public.season_player_stats  set (security_invoker = on);
alter view public.season_team_stats    set (security_invoker = on);
