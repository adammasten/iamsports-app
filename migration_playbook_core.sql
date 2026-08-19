-- =====================================================================
-- Playbook v2 — Phase 1 P0 data model (concierge-pilot foundation)
-- Spec: PLAYBOOK_V2_CONVERGED.md
--
-- ADDITIVE + DARK: referenced by zero app code, no user-facing surface.
-- Applied pre-launch on Adam's explicit "live now" call (overriding the
-- spec's own post-launch line). Safe because it is purely new tables that
-- nothing else reads; reversible with DROP TABLE.
--
-- Encodes the four invariants the reviews flagged as un-retrofittable —
-- they MUST exist from the first migration, once real coach data lands:
--   §5  two-layer ownership .... library_plays (coach) vs plays (team)
--   §4  immutable installs ..... install_plays pins (play_id, play_version)
--   §6  cross-team clip safety . play_clips visibility = VIEWER's team
--   §7  minors-safe receipts ... binary events only, NO watch-time column
--
-- Helpers (verified live this session): is_team_coach(check_team_id uuid),
--   is_team_member(t uuid), is_linked_parent(p_player_id uuid),
--   is_super_admin().
--
-- Deliberately DEFERRED to a later phase (not a P0 invariant): playbooks /
-- playbook_plays (organisational grouping), render-cache bookkeeping,
-- template library, editor.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- TABLES  (created first; policies reference each other, so all tables
--          must exist before any policy is defined)
-- ─────────────────────────────────────────────────────────────────────

-- §5 — the coach's PERSONAL library. Cross-team, season-surviving. This is
-- the Pro Coach asset ("plays stay with you" = literally this table). No
-- team linkage at all, so its RLS is one line.
create table public.library_plays (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  sport          text not null,
  name           text not null,
  doc            jsonb not null default '{}'::jsonb,
  schema_version int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- §5 — team-scoped play INSTANCE. Optionally derived from a library play
-- (provenance only; the library grants no access here). Evolves per team.
create table public.plays (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  library_play_id uuid references public.library_plays(id) on delete set null,
  sport           text not null,
  name            text not null,
  doc             jsonb not null default '{}'::jsonb,  -- current working doc
  latest_version  int  not null default 0,             -- last snapshot number
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- §4 — APPEND-ONLY version snapshots. This is what installs pin to, so it
-- is load-bearing for immutability. No UPDATE/DELETE policy exists → rows
-- are immutable once written (deletion only via play-cascade, itself
-- blocked by the install_plays RESTRICT below).
create table public.play_versions (
  id         uuid primary key default gen_random_uuid(),
  play_id    uuid not null references public.plays(id) on delete cascade,
  version    int  not null,
  doc        jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (play_id, version)
);

-- §4 — an install (what was taught, when). Draft → published.
create table public.installs (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  title        text not null,
  note         text,
  status       text not null default 'draft' check (status in ('draft','published')),
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- §4 — the immutability core: an install pins each play at a SPECIFIC
-- version. The composite FK to play_versions is ON DELETE RESTRICT, so a
-- pinned version can never be deleted out from under a published install.
create table public.install_plays (
  id           uuid primary key default gen_random_uuid(),
  install_id   uuid not null references public.installs(id) on delete cascade,
  play_id      uuid not null,
  play_version int  not null,
  sort_order   int  not null default 0,
  note         text,
  created_at   timestamptz not null default now(),
  foreign key (play_id, play_version)
    references public.play_versions (play_id, version) on delete restrict,
  unique (install_id, play_id, play_version)
);

-- §6 — clip linkage, HARDENED. team_id is the denormalised owner of the
-- FILM (not the play). Visibility is re-checked against the viewer's team
-- membership, independent of the play's library lineage → a play derived
-- from the same library play on Team A and Team B can never surface Team
-- A's film to Team B. Library plays cannot appear here at all (play_id
-- references team `plays` only), so the leak is structural, not policy.
create table public.play_clips (
  id           uuid primary key default gen_random_uuid(),
  play_id      uuid not null,
  play_version int  not null,
  clip_id      uuid not null references public.clips(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  link_type    text not null check (link_type in ('exemplar','execution','mistake')),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  foreign key (play_id, play_version)
    references public.play_versions (play_id, version) on delete cascade,
  unique (play_id, play_version, clip_id)
);

-- §7 — receipts, MINORS-SAFE by design. Binary events ONLY. There is NO
-- duration / watch-time column, and there never will be one here. Parents
-- see everything a coach sees about their own child (policy below).
create table public.install_receipts (
  id         uuid primary key default gen_random_uuid(),
  install_id uuid not null references public.installs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  play_id    uuid references public.plays(id) on delete set null,
  event_type text not null check (event_type in
                ('install_viewed','play_opened','video_viewed','install_completed')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- INDEXES (FK columns + the hot lookup paths)
-- ─────────────────────────────────────────────────────────────────────
create index library_plays_owner_idx    on public.library_plays(owner_user_id);
create index plays_team_idx             on public.plays(team_id);
create index plays_library_idx          on public.plays(library_play_id);
create index play_versions_play_idx     on public.play_versions(play_id);
create index installs_team_idx          on public.installs(team_id);
create index install_plays_install_idx  on public.install_plays(install_id);
create index install_plays_play_idx     on public.install_plays(play_id, play_version);
create index play_clips_team_idx        on public.play_clips(team_id);
create index play_clips_clip_idx        on public.play_clips(clip_id);
create index play_clips_play_idx        on public.play_clips(play_id, play_version);
create index install_receipts_install_idx on public.install_receipts(install_id);
create index install_receipts_user_idx  on public.install_receipts(user_id);

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- Read DAG (no cycles): installs → install_plays → plays / play_versions.
-- Coach access uses SECURITY DEFINER helpers (bypass nested RLS); player
-- access flows through visible installs so drafts stay coach-only.
-- ─────────────────────────────────────────────────────────────────────
alter table public.library_plays   enable row level security;
alter table public.plays           enable row level security;
alter table public.play_versions   enable row level security;
alter table public.installs        enable row level security;
alter table public.install_plays   enable row level security;
alter table public.play_clips      enable row level security;
alter table public.install_receipts enable row level security;

-- library_plays: owner only.
create policy library_plays_all on public.library_plays
  for all
  using (owner_user_id = auth.uid() or is_super_admin())
  with check (owner_user_id = auth.uid());

-- plays: coaches full CRUD; members read only plays that appear in an
-- install they're allowed to see (install_plays RLS does the gating).
create policy plays_coach_all on public.plays
  for all
  using (is_super_admin() or is_team_coach(team_id))
  with check (is_team_coach(team_id));
create policy plays_member_read on public.plays
  for select
  using (exists (select 1 from public.install_plays ip where ip.play_id = plays.id));

-- play_versions: coaches insert + read; members read versions surfaced by
-- a visible install. NO update/delete policy → append-only.
create policy play_versions_coach_read on public.play_versions
  for select
  using (
    is_super_admin()
    or exists (select 1 from public.plays p where p.id = play_versions.play_id and is_team_coach(p.team_id))
    or exists (select 1 from public.install_plays ip
                 where ip.play_id = play_versions.play_id and ip.play_version = play_versions.version)
  );
create policy play_versions_coach_insert on public.play_versions
  for insert
  with check (exists (select 1 from public.plays p where p.id = play_versions.play_id and is_team_coach(p.team_id)));

-- installs: coaches full CRUD; members read PUBLISHED only.
create policy installs_coach_all on public.installs
  for all
  using (is_super_admin() or is_team_coach(team_id))
  with check (is_team_coach(team_id));
create policy installs_member_read on public.installs
  for select
  using (status = 'published' and is_team_member(team_id));

-- install_plays: read if you can see the parent install; coaches write.
create policy install_plays_coach_all on public.install_plays
  for all
  using (exists (select 1 from public.installs i where i.id = install_id and (is_super_admin() or is_team_coach(i.team_id))))
  with check (exists (select 1 from public.installs i where i.id = install_id and is_team_coach(i.team_id)));
create policy install_plays_member_read on public.install_plays
  for select
  using (exists (select 1 from public.installs i where i.id = install_id));

-- play_clips: SELECT gated on the VIEWER's membership of the FILM's team
-- (structural cross-team safety); coaches write, and may only link a clip
-- that actually belongs to that team.
create policy play_clips_member_read on public.play_clips
  for select
  using (is_super_admin() or is_team_member(team_id));
create policy play_clips_coach_all on public.play_clips
  for all
  using (is_super_admin() or is_team_coach(team_id))
  with check (
    is_team_coach(team_id)
    and exists (select 1 from public.clips c where c.id = clip_id and c.team_id = team_id)
  );

-- install_receipts: log for installs you can see (as yourself); read your
-- own, your child's (parent link), or — as a coach — your team's.
create policy install_receipts_insert on public.install_receipts
  for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.installs i where i.id = install_id)
  );
create policy install_receipts_read on public.install_receipts
  for select
  using (
    is_super_admin()
    or user_id = auth.uid()
    or exists (select 1 from public.installs i where i.id = install_id and is_team_coach(i.team_id))
    or exists (select 1 from public.players pl where pl.user_id = install_receipts.user_id and is_linked_parent(pl.id))
  );
