-- Security hardening: pin a fixed search_path on the 4 functions flagged by the
-- Supabase security advisor (function_search_path_mutable). A mutable search_path
-- lets a caller inject a malicious schema; pinning it to public removes that.
-- All four reference only public objects or pg_catalog builtins, so this is safe.
-- Applied live via Supabase MCP 2026-08-26.
alter function public.gen_join_code(integer) set search_path = public;
alter function public.assign_team_accent() set search_path = public;
alter function public.touch_event() set search_path = public;
alter function public.game_stat_lines_touch_updated_at() set search_path = public;
