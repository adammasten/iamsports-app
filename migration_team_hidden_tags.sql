-- =====================================================================
-- Per-team hide list for tags (Flag/7v7 universal-tag pruning).
-- APPLIED LIVE via the Supabase MCP (migration: team_hidden_tags).
-- A team can tuck away any tag (esp. universal/global) so it stops
-- cluttering their tagging screen — WITHOUT affecting other teams.
-- Hiding != deleting: the tag row is untouched; only this team stops
-- seeing it in the taggers + reel picker. Managed from the Tags tab.
-- =====================================================================
create table public.team_hidden_tags (
  team_id uuid not null references public.teams(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  hidden_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (team_id, tag_id)
);
create index team_hidden_tags_team_idx on public.team_hidden_tags(team_id);

alter table public.team_hidden_tags enable row level security;

create policy team_hidden_tags_read on public.team_hidden_tags
  for select to authenticated using (is_team_member(team_id) or is_super_admin());
create policy team_hidden_tags_insert on public.team_hidden_tags
  for insert to authenticated with check (is_team_member(team_id));
create policy team_hidden_tags_delete on public.team_hidden_tags
  for delete to authenticated using (is_team_member(team_id) or is_super_admin());
-- =====================================================================
