-- Applied live 2026-08-19 via Supabase MCP (library_plays_tags). Mirrors
-- plays.tags onto the coach's personal library so tags travel when a library
-- play is attached to a team. Additive, dark.
alter table public.library_plays add column if not exists tags text[] not null default '{}';
create index if not exists library_plays_tags_idx on public.library_plays using gin (tags);
