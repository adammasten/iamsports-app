-- =====================================================================
-- Scheduling Slice 1 — unified events model. APPLIED LIVE via the Supabase MCP
-- (migration: schedule_events_core + a backfill DML block). Fully ADDITIVE:
-- games / film / tagging / stats are untouched; a game-family event links 1:1 to
-- a games row via games.event_id. See docs (SCHEDULE_PLAN) for the architecture.
--
-- Real column names verified against live schema. Adjustments vs the original
-- spec: (1) home_away lives on events (games has no such column); (2) the
-- backfill excludes soft-deleted games (games.deleted_at) and is collision-safe
-- (per-row loop), with local_date falling back to created_at::date for the
-- rare null-date game.
-- =====================================================================

create table public.events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  series_id uuid,
  event_type text not null check (event_type in ('game','scrimmage','practice','tournament_game','team_event')),
  title text,
  local_date date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  arrival_at timestamptz,
  event_timezone text not null default 'America/Chicago',
  time_status text not null default 'confirmed' check (time_status in ('confirmed','tbd','all_day')),
  home_away text check (home_away in ('home','away')),
  venue_name text,
  venue_address text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','canceled','postponed')),
  uniform text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index events_team_date_idx on public.events (team_id, local_date);
create index events_team_status_idx on public.events (team_id, status);
create index events_tournament_idx on public.events (tournament_id) where tournament_id is not null;

alter table public.games add column event_id uuid unique references public.events(id) on delete set null;

create table public.event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  responder_user_id uuid references auth.users(id),
  rsvp_status text not null check (rsvp_status in ('going','maybe','out')),
  note text,
  updated_at timestamptz not null default now(),
  unique (event_id, player_id)
);
create index event_attendance_event_idx on public.event_attendance (event_id);
create index event_attendance_player_idx on public.event_attendance (player_id);

alter table public.events enable row level security;
alter table public.event_attendance enable row level security;

create policy events_select on public.events for select using ( public.is_team_member(team_id) or public.is_super_admin() );
create policy events_insert on public.events for insert with check ( public.is_team_coach(team_id) or public.is_super_admin() );
create policy events_update on public.events for update
  using ( public.is_team_coach(team_id) or public.is_super_admin() )
  with check ( public.is_team_coach(team_id) or public.is_super_admin() );

create policy att_select on public.event_attendance for select using (
  exists (select 1 from public.events e where e.id = event_id and public.is_team_member(e.team_id))
);
create policy att_write on public.event_attendance for all
  using (
    exists (select 1 from public.events e where e.id = event_attendance.event_id and public.is_team_coach(e.team_id))
    or exists (select 1 from public.parent_player_links ppl where ppl.player_id = event_attendance.player_id and ppl.parent_user_id = public.effective_user_id())
    or exists (select 1 from public.players p where p.id = event_attendance.player_id and p.user_id = public.effective_user_id())
  )
  with check (
    exists (select 1 from public.events e where e.id = event_attendance.event_id and public.is_team_coach(e.team_id))
    or exists (select 1 from public.parent_player_links ppl where ppl.player_id = event_attendance.player_id and ppl.parent_user_id = public.effective_user_id())
    or exists (select 1 from public.players p where p.id = event_attendance.player_id and p.user_id = public.effective_user_id())
  );

create or replace function public.touch_event()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end $$;
create trigger events_touch before update on public.events for each row execute function public.touch_event();

-- ── Backfill (DML — run once after the DDL above) ──
do $$
declare g record; new_event uuid;
begin
  for g in select * from public.games where event_id is null and deleted_at is null loop
    insert into public.events (team_id, season_id, tournament_id, event_type, local_date, time_status, status, created_at)
    values (
      g.team_id, g.season_id, g.tournament_id, 'game',
      coalesce(g.game_date, g.created_at::date),
      'tbd',
      case when g.team_score is not null and g.opponent_score is not null then 'completed' else 'scheduled' end,
      coalesce(g.created_at, now())
    ) returning id into new_event;
    update public.games set event_id = new_event where id = g.id;
  end loop;
end $$;
-- After applying: NOTIFY pgrst, 'reload schema';
-- =====================================================================
