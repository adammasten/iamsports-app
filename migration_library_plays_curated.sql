-- =====================================================================
-- Curated Vault seeds live ONLY in The Vault, not in a coach's My Playbook.
-- APPLIED LIVE via the Supabase MCP.
-- =====================================================================
alter table public.library_plays add column if not exists curated boolean not null default false;
-- fetchLibraryPlays filters curated=false; the Vault reads visibility='community'.
-- =====================================================================
