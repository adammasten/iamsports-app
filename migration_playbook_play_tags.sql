-- Play tags — applied live 2026-08-19 via Supabase MCP (playbook_play_tags).
-- Formation/situation/defense labels on a play, for organising the library and
-- (Phase 7) powering auto-suggest. Additive + dark. Lives on the play, not the
-- version (tags describe the play, not a specific taught diagram).
alter table public.plays add column if not exists tags text[] not null default '{}';
create index if not exists plays_tags_idx on public.plays using gin (tags);

-- Seed tags for the 3 concierge plays on Center Attack Regents (data, re-run safe):
--   Horns      → Half-court, vs Man, Horns, Ball screen
--   Give & go  → Half-court, 5-out, Give & go, vs Man
--   BLOB 'Box' → BLOB, ATO, Box, Off-ball screen
