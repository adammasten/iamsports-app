-- =====================================================================
-- clip_football — football play breakdown, one row per clip (a "play").
-- APPLIED LIVE via the Supabase MCP (migration: clip_football_table).
-- Phase 3 slice 1. See docs/FOOTBALL_TAGGING_PLAN.md.
--
-- A clip is already a time range on a video (with period = quarter). This adds
-- the ODK breakdown columns coaches filter on. yard_line is 1..99 (1 = own goal
-- line, 99 = opponent goal line) for clean range queries (red zone = >= 80).
-- RLS mirrors the live clips_* policies: accessible exactly when the parent clip is.
-- =====================================================================

create table if not exists clip_football (
  clip_id       uuid primary key references clips(id) on delete cascade,
  odk           text not null check (odk in ('offense','defense','kicking')),
  down          smallint check (down between 1 and 4),
  distance      smallint check (distance >= 0),
  yard_line     smallint check (yard_line between 1 and 99),
  play_type     text,
  gap           text,
  off_formation text,
  def_front     text,
  result        text,
  gain_loss     smallint,
  drive_id      integer,
  opp_formation text,
  created_at    timestamptz not null default now()
);

alter table clip_football enable row level security;

create policy clip_football_read on clip_football for select using (
  exists (select 1 from clips c where c.id = clip_id and (
    is_super_admin()
    or c.created_by_user_id = auth.uid()
    or (c.visibility = 'team' and is_team_member(c.team_id))
    or (c.visibility = 'public_link' and is_team_member(c.team_id))
    or (c.visibility = 'coaches_only' and is_team_coach(c.team_id))
  ))
);
create policy clip_football_insert on clip_football for insert with check (
  exists (select 1 from clips c where c.id = clip_id and (
    is_super_admin() or is_team_member(c.team_id)
    or (c.team_id is null and c.created_by_user_id = auth.uid())
  ))
);
create policy clip_football_update on clip_football for update using (
  exists (select 1 from clips c where c.id = clip_id and (
    is_super_admin() or c.created_by_user_id = auth.uid() or is_team_coach(c.team_id)
  ))
) with check (
  exists (select 1 from clips c where c.id = clip_id and (
    is_super_admin() or c.created_by_user_id = auth.uid() or is_team_coach(c.team_id)
  ))
);
create policy clip_football_delete on clip_football for delete using (
  exists (select 1 from clips c where c.id = clip_id and (
    is_super_admin() or c.created_by_user_id = auth.uid() or is_team_coach(c.team_id)
  ))
);

-- After applying: NOTIFY pgrst, 'reload schema';
-- =====================================================================
