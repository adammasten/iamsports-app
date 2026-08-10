-- migration_share_comments.sql
--
-- Coaches' Corner comment thread. A lightweight thread hanging off a shared item
-- (shares row). Coach-only by construction: RLS gates read/write to coaches of
-- the share's team via is_team_coach(shares.team_id), mirroring the coaches-audience
-- visibility — a comment can't leak to non-coaches. Coexists with the per-share
-- note (shares.note) — the note is the sharer's caption; this is the discussion.

create table if not exists share_comments (
  id             uuid primary key default gen_random_uuid(),
  share_id       uuid not null references shares(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body           text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_share_comments_share on share_comments (share_id, created_at);

alter table share_comments enable row level security;

create policy share_comments_read on share_comments for select using (
  is_super_admin() or exists (select 1 from shares s where s.id = share_comments.share_id and is_team_coach(s.team_id))
);
create policy share_comments_insert on share_comments for insert with check (
  author_user_id = auth.uid() and (is_super_admin() or exists (select 1 from shares s where s.id = share_comments.share_id and is_team_coach(s.team_id)))
);
create policy share_comments_update on share_comments for update using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());
create policy share_comments_delete on share_comments for delete using (author_user_id = auth.uid() or is_super_admin());

notify pgrst, 'reload schema';
