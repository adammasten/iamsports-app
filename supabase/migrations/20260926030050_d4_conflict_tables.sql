-- ============================================================================
-- Slice D4 (part 1 of 2) — CONFLICT / DISMISSAL / MERGE-REQUEST TABLES
--
-- Ordered BEFORE D1's reconcile_players because that function keeps these tables in step
-- when an identity is retired (a dismissal or a request that named the retired row has to
-- follow the surviving identity). Creating them later would leave reconcile_players
-- referencing tables that do not yet exist.
--
-- The RPCs that drive these tables are in 20260926030400_d4_conflict_workflow.sql.
--
-- BUILD 68 COMPATIBILITY: two brand-new tables. Nothing existing is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PERMANENT DISMISSALS — "these are different children" (plan v2 §6.2)
--
--    PAIR NORMALISATION is the whole point of player_a < player_b: without it, A+B and B+A
--    are two different rows, and a pair dismissed in one direction comes straight back the
--    next time the conflict query happens to compute it in the other order.
-- ----------------------------------------------------------------------------
create table if not exists public.player_match_dismissals (
  player_a             uuid not null references public.players(id) on delete cascade,
  player_b             uuid not null references public.players(id) on delete cascade,
  scope                text not null check (scope in ('global','team')),
  team_id              uuid null references public.teams(id) on delete cascade,
  dismissed_by_user_id uuid not null,
  asserted_as          text not null check (asserted_as in ('guardian','coach','super_admin')),
  dismissed_at         timestamptz not null default now(),
  -- D12: a dismissal may be re-surfaced exactly ONCE, and only on new RECORDED-RELATIONSHIP
  -- evidence. Never on names.
  resurfaced_at        timestamptz null,
  resurfaced_reason    text null,
  revoked_at           timestamptz null,
  revoked_by_user_id   uuid null,
  constraint player_match_dismissals_pair_ordered check (player_a < player_b),
  constraint player_match_dismissals_team_scope
    check ((scope = 'team' and team_id is not null) or (scope = 'global' and team_id is null))
);

-- One dismissal per (pair, scope, team). COALESCE in the index keeps a global row unique
-- without a nullable column defeating uniqueness.
create unique index if not exists player_match_dismissals_key
  on public.player_match_dismissals
     (player_a, player_b, scope, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.player_match_dismissals enable row level security;

comment on table public.player_match_dismissals is
  'Permanent "these are different children" assertions (plan v2 §6.2). Pair is normalised with least()/greatest() so A+B and B+A are one record. A guardian assertion is global; a coach assertion binds only that team and never a family.';

-- ----------------------------------------------------------------------------
-- 2. RECONCILIATION REQUESTS — the dual-confirmation path (plan v2 §7.3)
--    Used for authority-matrix cases 4 and 5, where nobody may act unilaterally.
-- ----------------------------------------------------------------------------
create table if not exists public.player_merge_requests (
  id                   uuid primary key default gen_random_uuid(),
  source_player_id     uuid not null references public.players(id) on delete cascade,
  target_player_id     uuid not null references public.players(id) on delete cascade,
  requested_by_user_id uuid not null,
  requested_as         text not null check (requested_as in ('guardian','coach','super_admin')),
  reason               text null,
  status               text not null default 'pending'
                         check (status in ('pending','confirmed','declined','expired','applied')),
  confirmed_by_user_id uuid null,
  confirmed_at         timestamptz null,
  applied_at           timestamptz null,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null default (now() + interval '30 days'),
  constraint player_merge_requests_not_self check (source_player_id <> target_player_id)
);

-- At most ONE live request per unordered pair, so a double-tap cannot open two requests and
-- so A->B and B->A cannot both be pending.
create unique index if not exists player_merge_requests_live_pair_key
  on public.player_merge_requests (
    least(source_player_id, target_player_id),
    greatest(source_player_id, target_player_id))
  where status in ('pending','confirmed');

alter table public.player_merge_requests enable row level security;

comment on table public.player_merge_requests is
  'Dual-confirmation reconciliation requests (plan v2 §7.3). Nothing moves until status = confirmed and reconcile_players runs. Unique on the UNORDERED pair while live, so a pair cannot have two competing requests.';

notify pgrst, 'reload schema';
