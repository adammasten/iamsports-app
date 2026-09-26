-- ============================================================================
-- Slice D1 (part 2 of 2) — SAFE PLAYER RECONCILIATION: repoint + tombstone
--
-- Replaces the retired merge_players (Slice D0). Plan v2 §7.2 (authority matrix),
-- §8.2 (repoint every dependent explicitly), §8.4 (per-table audit), §8.6 (identity
-- field carry-over), §3.2 (idempotency via request id).
--
-- GUARANTEES
--   1. NO HARD DELETE of a players row. The loser is tombstoned (merged_into_id), so any
--      stale id still resolves via resolve_player_id().
--   2. Nothing is lost. Every one of the 16 dependent references discovered by the
--      programmatic inventory is repointed or explicitly folded with a counted reason.
--   3. NO MERGE CHAINS. The keeper must itself be canonical, and every row already
--      pointing AT the loser is re-pointed to the keeper in the same transaction, so the
--      tombstone graph stays exactly one hop deep.
--   4. Idempotent per (actor, request id). A double-tapped "Yes, this is my Lars" merges
--      once and returns the same answer twice.
--   5. Coach status is NEVER sufficient to reconcile two claimed children.
--   6. One transaction. A failure anywhere leaves the database untouched.
--
-- BUILD 68 COMPATIBILITY: purely additive. New table, new functions. No existing RPC,
-- policy or column changes. Build 68 has no caller and cannot reach this.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DURABLE RECONCILIATION RECORD
--    admin_audit_log also gets a row (§8.4) for support continuity, but idempotency and
--    "what actually moved" need a typed, queryable record of their own.
-- ----------------------------------------------------------------------------
create table if not exists public.player_reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  canonical_player_id uuid not null references public.players(id) on delete restrict,
  retired_player_id   uuid not null references public.players(id) on delete restrict,
  actor_user_id       uuid not null,
  request_id          uuid,
  authority           text not null,     -- super_admin | guardian_both | coach_both_unclaimed | claim_flow | merge_request
  merge_request_id    uuid,
  moved               jsonb not null default '{}'::jsonb,
  skipped_as_duplicate jsonb not null default '{}'::jsonb,
  carried_identity_fields text[] not null default '{}',
  created_at          timestamptz not null default now(),
  constraint player_reconciliations_not_self check (canonical_player_id <> retired_player_id)
);

create unique index if not exists player_reconciliations_request_key
  on public.player_reconciliations (actor_user_id, request_id)
  where request_id is not null;

create index if not exists idx_player_reconciliations_retired
  on public.player_reconciliations (retired_player_id);

alter table public.player_reconciliations enable row level security;

-- Readable by a guardian of either side, a super admin, or the actor. Never writable from a
-- client: only reconcile_players (definer) writes it.
drop policy if exists player_reconciliations_read on public.player_reconciliations;
create policy player_reconciliations_read on public.player_reconciliations
  for select to authenticated
  using (
    public.is_super_admin()
    or actor_user_id = (select auth.uid())
    or public.is_linked_parent(canonical_player_id)
    or public.is_linked_parent(retired_player_id)
  );

comment on table public.player_reconciliations is
  'Durable audit of every applied player reconciliation (Slice D1): canonical, retired, actor, authority basis, per-table moved/skipped counts, and which identity fields were carried over. Also the idempotency ledger -- (actor_user_id, request_id) is unique.';

-- ----------------------------------------------------------------------------
-- 2. AUTHORITY (plan v2 §7.2)
--
--    Returns the authority basis, or NULL when the caller may not act directly.
--
--      super_admin           — always (recovery path)
--      guardian_both         — case 2: the caller holds a guardian link to BOTH rows
--      coach_both_unclaimed  — case 1: BOTH rows have zero guardians AND both have an open
--                              spell on ONE team the caller coaches. No family interest exists.
--      claim_flow            — case 3: caller is a guardian of the keeper, the loser is
--                              unclaimed, and the caller produced a valid team join code for
--                              a team the loser has an open spell on. The code is the
--                              coach-side authorization, exactly as claim_roster_spot relies
--                              on it today.
--
--    Cases 4 and 5 deliberately return NULL: they require a CONFIRMED player_merge_request
--    (Slice D4), which reconcile_players accepts separately.
-- ----------------------------------------------------------------------------
create or replace function public.reconcile_authority(
  p_keep uuid,
  p_retire uuid,
  p_claim_team_code text default null
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  v_keep_guardians   int;
  v_retire_guardians int;
begin
  if uid is null then return null; end if;
  if public.is_super_admin() then return 'super_admin'; end if;

  select count(*) into v_keep_guardians   from parent_player_links where player_id = p_keep;
  select count(*) into v_retire_guardians from parent_player_links where player_id = p_retire;

  -- case 2 — the same adult holds both children
  if public.is_linked_parent(p_keep) and public.is_linked_parent(p_retire) then
    return 'guardian_both';
  end if;

  -- case 1 — both unclaimed, both on one team the caller coaches
  if v_keep_guardians = 0 and v_retire_guardians = 0 then
    if exists (
      select 1
      from player_teams a
      join player_teams b on b.team_id = a.team_id and b.left_on is null
      where a.player_id = p_keep and a.left_on is null
        and b.player_id = p_retire
        and public.is_team_coach(a.team_id)
    ) then
      return 'coach_both_unclaimed';
    end if;
  end if;

  -- case 3 — in-claim-flow: caller owns the keeper, loser is unclaimed, valid team code for
  -- a team the loser actually plays on.
  if p_claim_team_code is not null
     and v_retire_guardians = 0
     and public.is_linked_parent(p_keep) then
    if exists (
      select 1
      from teams t
      join player_teams pt on pt.team_id = t.id and pt.player_id = p_retire and pt.left_on is null
      where t.join_code = upper(trim(p_claim_team_code))
        and (t.join_code_expires_at is null or t.join_code_expires_at > now())
    ) then
      return 'claim_flow';
    end if;
  end if;

  return null;
end $function$;

comment on function public.reconcile_authority(uuid, uuid, text) is
  'Returns the authority basis under which the caller may directly reconcile two players (plan v2 §7.2 cases 1-3 + super admin), or NULL when a confirmed merge request is required (cases 4-5). Coach status alone NEVER authorises reconciling a claimed child.';

grant execute on function public.reconcile_authority(uuid, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. CONFLICT DETECTION
--
--    Reconciliation must never silently pick between incompatible values. This reports the
--    conflicts a caller has to acknowledge, and is used both by the dry run and by
--    reconcile_players itself.
--
--    `guardian_sets_differ` is the one that gates: when each row has guardians and they are
--    not the same set of adults, a direct merge is refused (case 5) and a confirmed request
--    is required.
-- ----------------------------------------------------------------------------
create or replace function public.reconcile_conflicts(p_keep uuid, p_retire uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ka as (select array_agg(parent_user_id order by parent_user_id) a
                from parent_player_links where player_id = p_keep),
       ra as (select array_agg(parent_user_id order by parent_user_id) a
                from parent_player_links where player_id = p_retire),
       k  as (select * from players where id = p_keep),
       r  as (select * from players where id = p_retire)
  select jsonb_build_object(
    'guardian_sets_differ',
      coalesce(ka.a, '{}') is distinct from coalesce(ra.a, '{}')
      and coalesce(array_length(ka.a,1),0) > 0
      and coalesce(array_length(ra.a,1),0) > 0,
    'keep_guardians',   coalesce(array_length(ka.a,1), 0),
    'retire_guardians', coalesce(array_length(ra.a,1), 0),
    'both_have_photo',      (k.photo_path is not null and r.photo_path is not null),
    'grad_class_differs',   (k.grad_class is not null and r.grad_class is not null
                             and k.grad_class <> r.grad_class),
    'name_differs',         (k.name is distinct from r.name),
    'overlapping_open_spells', (
       select coalesce(array_agg(distinct a.team_id), '{}')
       from player_teams a join player_teams b
         on b.team_id = a.team_id and b.player_id = p_retire and b.left_on is null
       where a.player_id = p_keep and a.left_on is null),
    'keep_is_retired',   (k.merged_into_id is not null),
    'retire_is_retired', (r.merged_into_id is not null)
  )
  from ka, ra, k, r;
$function$;

grant execute on function public.reconcile_conflicts(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. THE RECONCILIATION ITSELF
--
--    p_dry_run = true performs every count and conflict check, then RAISES a rollback-free
--    report instead of writing. That is D5's tooling: it answers "exactly what would move"
--    without moving anything.
-- ----------------------------------------------------------------------------
create or replace function public.reconcile_players(
  p_keep             uuid,
  p_retire           uuid,
  p_request_id       uuid    default null,
  p_dry_run          boolean default false,
  p_claim_team_code  text    default null,
  p_merge_request_id uuid    default null,
  p_acknowledge_conflicts boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid        uuid := auth.uid();
  v_auth     text;
  v_conf     jsonb;
  v_prior    public.player_reconciliations;
  v_moved    jsonb := '{}'::jsonb;
  v_skipped  jsonb := '{}'::jsonb;
  v_carried  text[] := '{}';
  v_first    uuid;
  v_second   uuid;
  v_recon_id uuid;
  v_seats_live_before int;
  n          int;
  n2         int;
  r          record;
  v_keep     public.players;
  v_retire   public.players;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_keep is null or p_retire is null then raise exception 'Both players are required'; end if;
  if p_keep = p_retire then
    raise exception 'Cannot reconcile a player with itself' using errcode = 'invalid_parameter_value';
  end if;

  -- ---- IDEMPOTENCY (before any work, and before any authority error) ----
  if p_request_id is not null then
    select * into v_prior from player_reconciliations
     where actor_user_id = uid and request_id = p_request_id;
    if found then
      return jsonb_build_object(
        'status', 'already_applied',
        'canonical_player_id', v_prior.canonical_player_id,
        'retired_player_id',   v_prior.retired_player_id,
        'authority',           v_prior.authority,
        'moved',               v_prior.moved,
        'skipped_as_duplicate',v_prior.skipped_as_duplicate,
        'reconciliation_id',   v_prior.id);
    end if;
  end if;

  -- ---- LOCK BOTH ROWS IN A DETERMINISTIC ORDER (deadlock safety) ----
  -- Two adults reconciling the same pair in opposite directions at the same moment must
  -- serialise, not deadlock.
  v_first  := least(p_keep, p_retire);
  v_second := greatest(p_keep, p_retire);
  perform 1 from players where id = v_first  for update;
  perform 1 from players where id = v_second for update;

  select * into v_keep   from players where id = p_keep;
  if not found then raise exception 'Keeper player not found'; end if;
  select * into v_retire from players where id = p_retire;
  if not found then raise exception 'Player to retire not found'; end if;

  -- ---- ALREADY DONE? (idempotent without a request id) ----
  if v_retire.merged_into_id = p_keep then
    return jsonb_build_object('status','already_applied','canonical_player_id',p_keep,
                              'retired_player_id',p_retire,'note','already tombstoned into this keeper');
  end if;

  -- ---- NO CHAINS ----
  if v_keep.merged_into_id is not null then
    raise exception 'The keeper % was itself retired into %. Reconcile into the canonical player instead.',
      p_keep, v_keep.merged_into_id using errcode = 'invalid_parameter_value';
  end if;
  if v_retire.merged_into_id is not null then
    raise exception 'Player % was already retired into %.', p_retire, v_retire.merged_into_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- AUTHORITY ----
  -- A CONFIRMED REQUEST IS THE STRONGEST BASIS and is therefore checked FIRST. It carries both
  -- parties' signatures, so it must not be shadowed by the caller's own weaker direct
  -- authority: an adult who holds both children has basis 'guardian_both', which is correctly
  -- NOT enough when the guardian sets differ -- and if we recorded that basis instead of the
  -- request, the very merge the other family just confirmed would still be refused.
  if p_merge_request_id is not null and exists (
      select 1 from player_merge_requests mr
      where mr.id = p_merge_request_id
        and mr.status = 'confirmed'
        and least(mr.source_player_id, mr.target_player_id) = v_first
        and greatest(mr.source_player_id, mr.target_player_id) = v_second
        and (mr.requested_by_user_id = uid or mr.confirmed_by_user_id = uid)
  ) then
    v_auth := 'merge_request';
  else
    v_auth := public.reconcile_authority(p_keep, p_retire, p_claim_team_code);
  end if;

  -- A DRY RUN NEVER RAISES ON AUTHORITY OR CONFLICTS -- reporting them is its entire job
  -- (Slice D5: "show exactly what would move/change ... conflicts ... canonical-selection
  -- reasoning"). A caller inspecting a hard case must be able to SEE that it would be refused
  -- and why, rather than getting an exception and no information.
  --
  -- It does still require STANDING, so it cannot be used to probe arbitrary children: a
  -- guardian of either row, a coach of a team either row currently plays on, or a super admin.
  if p_dry_run then
    if not (public.is_super_admin()
            or public.is_linked_parent(p_keep) or public.is_linked_parent(p_retire)
            or public.is_current_team_coach_of_player(p_keep)
            or public.is_current_team_coach_of_player(p_retire)) then
      raise exception 'Not authorized to inspect these two players'
        using errcode = 'insufficient_privilege';
    end if;
  elsif v_auth is null then
    raise exception 'Not authorized to reconcile these two players. A coach may not combine children who belong to families, and two different families must each confirm.'
      using errcode = 'insufficient_privilege',
            hint = 'Open a reconciliation request instead (request_player_merge), or ask support.';
  end if;

  -- ---- CONFLICTS ----
  v_conf := public.reconcile_conflicts(p_keep, p_retire);

  -- Differing guardian sets are never reconciled on one party's word, whatever the authority
  -- basis -- except by super admin, and by an explicitly confirmed request (which IS the
  -- other family's signature).
  if not p_dry_run
     and (v_conf->>'guardian_sets_differ')::boolean
     and v_auth not in ('super_admin','merge_request') then
    raise exception 'These two records have different guardians. Reconciling them needs both families to confirm.'
      using errcode = 'insufficient_privilege',
            hint = 'Use request_player_merge so the other guardian can confirm.';
  end if;

  -- Softer conflicts must be acknowledged rather than silently resolved.
  if not p_dry_run and not p_acknowledge_conflicts
     and ((v_conf->>'both_have_photo')::boolean or (v_conf->>'grad_class_differs')::boolean) then
    raise exception 'These records hold conflicting profile details (photo and/or graduation year). Confirm which to keep before combining.'
      using errcode = 'data_exception',
            hint = 'Re-run with p_acknowledge_conflicts => true; the keeper''s existing values always win.';
  end if;

  -- Captured BEFORE step 1, because deleting a duplicate guardian link fires
  -- trg_revoke_guardian_seat, which revokes that adult's seat on the retired row. That is
  -- correct behaviour, but it means the seats step below cannot learn how many seats it
  -- retired by counting the rows ITS OWN update touched -- the trigger got there first. The
  -- audit must describe what happened, so measure the state change instead.
  select count(*) into v_seats_live_before
    from player_guardian_seats where player_id = p_retire and revoked_at is null;

  -- ======================================================================
  -- REPOINT EVERY DEPENDENT. Order follows plan v2 §8.2, extended by this slice's
  -- programmatic FK/reference inventory.
  --
  -- p_dry_run counts what WOULD move using the identical predicates, and writes nothing.
  -- ======================================================================

  -- 1. parent_player_links — never drop a guardian who is not already on the keeper.
  if p_dry_run then
    select count(*) into n from parent_player_links l where l.player_id = p_retire
      and not exists (select 1 from parent_player_links k
                       where k.player_id = p_keep and k.parent_user_id = l.parent_user_id);
    select count(*) into n2 from parent_player_links l where l.player_id = p_retire
      and exists (select 1 from parent_player_links k
                   where k.player_id = p_keep and k.parent_user_id = l.parent_user_id);
  else
    with moved as (
      update parent_player_links l set player_id = p_keep
       where l.player_id = p_retire
         and not exists (select 1 from parent_player_links k
                          where k.player_id = p_keep and k.parent_user_id = l.parent_user_id)
      returning 1)
    select count(*) into n from moved;
    with dropped as (
      delete from parent_player_links where player_id = p_retire returning 1)
    select count(*) into n2 from dropped;
  end if;
  v_moved   := v_moved   || jsonb_build_object('parent_player_links', n);
  v_skipped := v_skipped || jsonb_build_object('parent_player_links', n2);

  -- 2. player_teams — spell union. Only an OPEN spell can collide (the unique index is
  --    partial on left_on IS NULL); a closed spell is always safe to repoint, which keeps a
  --    genuine left-and-rejoined history intact instead of flattening it.
  n := 0; n2 := 0;
  for r in select * from player_teams where player_id = p_retire loop
    if r.left_on is null and exists (
         select 1 from player_teams k
          where k.player_id = p_keep and k.team_id = r.team_id and k.left_on is null) then
      if not p_dry_run then
        -- union the range onto the keeper's open spell, then drop the loser's row
        update player_teams k
           set joined_on = least(k.joined_on, r.joined_on),
               jersey_number = coalesce(k.jersey_number, r.jersey_number),
               season_id     = coalesce(k.season_id, r.season_id)
         where k.player_id = p_keep and k.team_id = r.team_id and k.left_on is null;
        delete from player_teams where id = r.id;
      end if;
      n2 := n2 + 1;
    else
      if not p_dry_run then
        update player_teams set player_id = p_keep where id = r.id;
      end if;
      n := n + 1;
    end if;
  end loop;
  v_moved   := v_moved   || jsonb_build_object('player_teams', n);
  v_skipped := v_skipped || jsonb_build_object('player_teams', n2);

  -- 3. tags + clip_tags — PER (team, player), not once globally. The loser's chip for a team
  --    folds onto the keeper's chip for THAT team, preserving bundle_number and stat_side,
  --    so the tag-bundle semantics clipMatchesGroup depends on survive intact.
  declare
    v_ct_moved int := 0; v_ct_skipped int := 0; v_tag_moved int := 0; v_tag_folded int := 0;
    v_keep_tag uuid;
  begin
    for r in select * from tags where player_id = p_retire loop
      select id into v_keep_tag from tags
       where player_id = p_keep and category = 'players'
         and team_id is not distinct from r.team_id
       limit 1;

      if r.category = 'players' and v_keep_tag is not null then
        -- fold this chip's clip_tags onto the keeper's chip for the same team
        if p_dry_run then
          select count(*) into n from clip_tags ct where ct.tag_id = r.id
            and not exists (select 1 from clip_tags k
                             where k.clip_id = ct.clip_id and k.tag_id = v_keep_tag
                               and k.bundle_number = ct.bundle_number);
          select count(*) into n2 from clip_tags ct where ct.tag_id = r.id
            and exists (select 1 from clip_tags k
                         where k.clip_id = ct.clip_id and k.tag_id = v_keep_tag
                           and k.bundle_number = ct.bundle_number);
        else
          with mv as (
            update clip_tags ct set tag_id = v_keep_tag
             where ct.tag_id = r.id
               and not exists (select 1 from clip_tags k
                                where k.clip_id = ct.clip_id and k.tag_id = v_keep_tag
                                  and k.bundle_number = ct.bundle_number)
            returning 1)
          select count(*) into n from mv;
          with dp as (delete from clip_tags where tag_id = r.id returning 1)
          select count(*) into n2 from dp;
          delete from tags where id = r.id;
        end if;
        v_ct_moved   := v_ct_moved + n;
        v_ct_skipped := v_ct_skipped + n2;
        v_tag_folded := v_tag_folded + 1;
      else
        -- no keeper chip for this team (or a non-roster tag): the chip itself moves, and its
        -- clip_tags come with it untouched.
        if not p_dry_run then
          update tags set player_id = p_keep where id = r.id;
        end if;
        v_tag_moved := v_tag_moved + 1;
      end if;
    end loop;
    v_moved   := v_moved   || jsonb_build_object('tags', v_tag_moved, 'clip_tags', v_ct_moved);
    v_skipped := v_skipped || jsonb_build_object('tags_folded', v_tag_folded,
                                                'clip_tags', v_ct_skipped);
  end;

  -- 4-16. Plain repoint-with-skip for every remaining reference. Each is "move the rows that
  -- would not collide, then drop the rest", so a unique constraint can never abort the merge
  -- and a collision is always counted rather than silently swallowed.
  -- game_lineups  PK (game_id, player_id)
  if p_dry_run then
    select count(*) into n  from game_lineups l where l.player_id = p_retire
      and not exists (select 1 from game_lineups k where k.game_id = l.game_id and k.player_id = p_keep);
    select count(*) into n2 from game_lineups l where l.player_id = p_retire
      and exists (select 1 from game_lineups k where k.game_id = l.game_id and k.player_id = p_keep);
  else
    with mv as (update game_lineups l set player_id = p_keep where l.player_id = p_retire
        and not exists (select 1 from game_lineups k where k.game_id = l.game_id and k.player_id = p_keep)
        returning 1) select count(*) into n from mv;
    with dp as (delete from game_lineups where player_id = p_retire returning 1) select count(*) into n2 from dp;
  end if;
  v_moved := v_moved || jsonb_build_object('game_lineups', n);
  v_skipped := v_skipped || jsonb_build_object('game_lineups', n2);

  -- game_stat_lines  UQ (game_id, player_id, stat_side) WHERE player_id IS NOT NULL
  if p_dry_run then
    select count(*) into n  from game_stat_lines l where l.player_id = p_retire
      and not exists (select 1 from game_stat_lines k where k.game_id = l.game_id
                       and k.player_id = p_keep and k.stat_side = l.stat_side);
    select count(*) into n2 from game_stat_lines l where l.player_id = p_retire
      and exists (select 1 from game_stat_lines k where k.game_id = l.game_id
                   and k.player_id = p_keep and k.stat_side = l.stat_side);
  else
    with mv as (update game_stat_lines l set player_id = p_keep where l.player_id = p_retire
        and not exists (select 1 from game_stat_lines k where k.game_id = l.game_id
                         and k.player_id = p_keep and k.stat_side = l.stat_side)
        returning 1) select count(*) into n from mv;
    with dp as (delete from game_stat_lines where player_id = p_retire returning 1) select count(*) into n2 from dp;
  end if;
  v_moved := v_moved || jsonb_build_object('game_stat_lines', n);
  v_skipped := v_skipped || jsonb_build_object('game_stat_lines', n2);

  -- event_attendance  UQ (event_id, player_id)
  if p_dry_run then
    select count(*) into n  from event_attendance l where l.player_id = p_retire
      and not exists (select 1 from event_attendance k where k.event_id = l.event_id and k.player_id = p_keep);
    select count(*) into n2 from event_attendance l where l.player_id = p_retire
      and exists (select 1 from event_attendance k where k.event_id = l.event_id and k.player_id = p_keep);
  else
    with mv as (update event_attendance l set player_id = p_keep where l.player_id = p_retire
        and not exists (select 1 from event_attendance k where k.event_id = l.event_id and k.player_id = p_keep)
        returning 1) select count(*) into n from mv;
    with dp as (delete from event_attendance where player_id = p_retire returning 1) select count(*) into n2 from dp;
  end if;
  v_moved := v_moved || jsonb_build_object('event_attendance', n);
  v_skipped := v_skipped || jsonb_build_object('event_attendance', n2);

  -- team_player_permissions  PK (team_id, player_id, permission)
  if p_dry_run then
    select count(*) into n  from team_player_permissions l where l.player_id = p_retire
      and not exists (select 1 from team_player_permissions k where k.team_id = l.team_id
                       and k.player_id = p_keep and k.permission = l.permission);
    select count(*) into n2 from team_player_permissions l where l.player_id = p_retire
      and exists (select 1 from team_player_permissions k where k.team_id = l.team_id
                   and k.player_id = p_keep and k.permission = l.permission);
  else
    with mv as (update team_player_permissions l set player_id = p_keep where l.player_id = p_retire
        and not exists (select 1 from team_player_permissions k where k.team_id = l.team_id
                         and k.player_id = p_keep and k.permission = l.permission)
        returning 1) select count(*) into n from mv;
    with dp as (delete from team_player_permissions where player_id = p_retire returning 1) select count(*) into n2 from dp;
  end if;
  v_moved := v_moved || jsonb_build_object('team_player_permissions', n);
  v_skipped := v_skipped || jsonb_build_object('team_player_permissions', n2);

  -- player_guardian_seats  UQ (player_id, granted_to_user_id) WHERE revoked_at IS NULL
  -- A seat is PAID. Never drop one that the keeper does not already have live.
  if p_dry_run then
    select count(*) into n  from player_guardian_seats l where l.player_id = p_retire
      and not exists (select 1 from player_guardian_seats k where k.player_id = p_keep
                       and k.granted_to_user_id = l.granted_to_user_id and k.revoked_at is null);
    select count(*) into n2 from player_guardian_seats l where l.player_id = p_retire
      and exists (select 1 from player_guardian_seats k where k.player_id = p_keep
                   and k.granted_to_user_id = l.granted_to_user_id and k.revoked_at is null);
  else
    with mv as (update player_guardian_seats l set player_id = p_keep where l.player_id = p_retire
        and not exists (select 1 from player_guardian_seats k where k.player_id = p_keep
                         and k.granted_to_user_id = l.granted_to_user_id and k.revoked_at is null)
        returning 1) select count(*) into n from mv;
    -- a live duplicate seat is revoked, not deleted: the payment record survives
    update player_guardian_seats set revoked_at = now()
     where player_id = p_retire and revoked_at is null;
    -- state-based, so seats already revoked by trg_revoke_guardian_seat are still counted
    n2 := greatest(v_seats_live_before - n, 0);
  end if;
  v_moved := v_moved || jsonb_build_object('player_guardian_seats', n);
  v_skipped := v_skipped || jsonb_build_object('player_guardian_seats_revoked_as_duplicate', n2);

  -- followers  UQ (follower_user_id, scope, team_id, player_id) — D15: on collision keep the
  -- more advanced status ('approved' beats 'pending').
  if p_dry_run then
    select count(*) into n  from followers l where l.player_id = p_retire
      and not exists (select 1 from followers k where k.follower_user_id = l.follower_user_id
                       and k.scope = l.scope and k.team_id is not distinct from l.team_id
                       and k.player_id = p_keep);
    select count(*) into n2 from followers l where l.player_id = p_retire
      and exists (select 1 from followers k where k.follower_user_id = l.follower_user_id
                   and k.scope = l.scope and k.team_id is not distinct from l.team_id
                   and k.player_id = p_keep);
  else
    update followers k set status = 'approved'
     where k.player_id = p_keep and k.status <> 'approved'
       and exists (select 1 from followers l where l.player_id = p_retire
                    and l.follower_user_id = k.follower_user_id and l.scope = k.scope
                    and l.team_id is not distinct from k.team_id and l.status = 'approved');
    with mv as (update followers l set player_id = p_keep where l.player_id = p_retire
        and not exists (select 1 from followers k where k.follower_user_id = l.follower_user_id
                         and k.scope = l.scope and k.team_id is not distinct from l.team_id
                         and k.player_id = p_keep)
        returning 1) select count(*) into n from mv;
    with dp as (delete from followers where player_id = p_retire returning 1) select count(*) into n2 from dp;
  end if;
  v_moved := v_moved || jsonb_build_object('followers', n);
  v_skipped := v_skipped || jsonb_build_object('followers', n2);

  -- Simple repoints with no unique constraint to collide against.
  if p_dry_run then
    select count(*) into n from videos where player_id = p_retire;
  else
    with mv as (update videos set player_id = p_keep where player_id = p_retire returning 1)
    select count(*) into n from mv;
  end if;
  v_moved := v_moved || jsonb_build_object('videos', n);

  if p_dry_run then
    select count(*) into n from shares where target_player_id = p_retire;
  else
    with mv as (update shares set target_player_id = p_keep where target_player_id = p_retire returning 1)
    select count(*) into n from mv;
  end if;
  v_moved := v_moved || jsonb_build_object('shares', n);

  if p_dry_run then
    select count(*) into n from event_snack_signups where player_id = p_retire;
  else
    with mv as (update event_snack_signups set player_id = p_keep where player_id = p_retire returning 1)
    select count(*) into n from mv;
  end if;
  v_moved := v_moved || jsonb_build_object('event_snack_signups', n);

  -- notifications: BOTH the FK column and the polymorphic entity_id. The latter has no FK
  -- and was NOT in the plan's dependent list -- found by this slice's inventory, with 4 live
  -- production rows. Missing it would leave notifications deep-linking to a retired child.
  if p_dry_run then
    select count(*) into n  from notifications where target_player_id = p_retire;
    select count(*) into n2 from notifications where entity_type = 'player' and entity_id = p_retire;
  else
    with mv as (update notifications set target_player_id = p_keep
                 where target_player_id = p_retire returning 1) select count(*) into n from mv;
    with mv2 as (update notifications set entity_id = p_keep
                  where entity_type = 'player' and entity_id = p_retire returning 1)
    select count(*) into n2 from mv2;
  end if;
  v_moved := v_moved || jsonb_build_object('notifications', n, 'notifications_entity_id', n2);

  -- player_guardian_codes  PK (player_id): the keeper's code wins; the loser's is revoked,
  -- never cascaded away, so a code already handed to a family stops working deliberately.
  if p_dry_run then
    select count(*) into n from player_guardian_codes where player_id = p_retire;
  else
    if exists (select 1 from player_guardian_codes where player_id = p_keep) then
      with dp as (delete from player_guardian_codes where player_id = p_retire returning 1)
      select count(*) into n from dp;
      v_skipped := v_skipped || jsonb_build_object('player_guardian_codes_revoked', n);
      n := 0;
    else
      with mv as (update player_guardian_codes set player_id = p_keep
                   where player_id = p_retire returning 1) select count(*) into n from mv;
    end if;
  end if;
  v_moved := v_moved || jsonb_build_object('player_guardian_codes', n);

  -- players.player_lineage_id — anything grouped with the loser regroups onto the keeper, and
  -- rows already pointing AT the loser are re-pointed so no dangling assertion survives.
  if p_dry_run then
    select count(*) into n from players where player_lineage_id = p_retire and id <> p_retire;
  else
    with mv as (update players set player_lineage_id = p_keep
                 where player_lineage_id = p_retire and id <> p_retire returning 1)
    select count(*) into n from mv;
  end if;
  v_moved := v_moved || jsonb_build_object('player_lineage_pointers', n);

  -- ---- NO CHAINS: anything already tombstoned into the loser now points at the keeper ----
  if p_dry_run then
    select count(*) into n from players where merged_into_id = p_retire;
  else
    with mv as (update players set merged_into_id = p_keep where merged_into_id = p_retire returning 1)
    select count(*) into n from mv;
  end if;
  v_moved := v_moved || jsonb_build_object('prior_tombstones_repointed', n);

  -- ---- dismissals and merge requests follow the identity (D4 tables) ----
  if not p_dry_run then
    update player_match_dismissals set player_a = least(p_keep, player_b), player_b = greatest(p_keep, player_b)
     where player_a = p_retire and player_b <> p_keep;
    update player_match_dismissals set player_b = greatest(p_keep, player_a), player_a = least(p_keep, player_a)
     where player_b = p_retire and player_a <> p_keep;
    delete from player_match_dismissals where player_a = p_retire or player_b = p_retire;
    update player_merge_requests set status = 'applied', applied_at = now()
     where status = 'confirmed'
       and least(source_player_id, target_player_id) = v_first
       and greatest(source_player_id, target_player_id) = v_second;
  end if;

  -- 15. IDENTITY FIELDS (plan v2 §8.6) — carry non-NULL from the retired row where the
  --     keeper's is NULL. NEVER clobber a keeper value. Without this the family loses the
  --     coach's photo/grad class to a merge that was supposed to be purely additive.
  if not p_dry_run then
    if v_keep.photo_path is null and v_retire.photo_path is not null then
      update players set photo_path = v_retire.photo_path where id = p_keep;
      v_carried := array_append(v_carried, 'photo_path');
    end if;
    if v_keep.grad_class is null and v_retire.grad_class is not null then
      update players set grad_class = v_retire.grad_class where id = p_keep;
      v_carried := array_append(v_carried, 'grad_class');
    end if;
    -- the keeper's name is a bare jersey sentinel ("#12") and the loser has a real name
    if v_keep.name like '#%' and v_retire.name is not null and v_retire.name not like '#%' then
      update players set name = v_retire.name where id = p_keep;
      v_carried := array_append(v_carried, 'name');
    end if;
  else
    if v_keep.photo_path is null and v_retire.photo_path is not null then v_carried := array_append(v_carried, 'photo_path'); end if;
    if v_keep.grad_class is null and v_retire.grad_class is not null then v_carried := array_append(v_carried, 'grad_class'); end if;
    if v_keep.name like '#%' and v_retire.name not like '#%' then v_carried := array_append(v_carried, 'name'); end if;
  end if;

  -- ---- DRY RUN STOPS HERE ----
  if p_dry_run then
    return jsonb_build_object(
      'status','dry_run',
      'canonical_player_id', p_keep,
      'retired_player_id',   p_retire,
      'canonical_name',      v_keep.name,
      'retiring_name',       v_retire.name,
      'authority',           coalesce(v_auth,'NONE — would be refused'),
      'would_be_refused',    (v_auth is null)
                             or ((v_conf->>'guardian_sets_differ')::boolean
                                 and coalesce(v_auth,'') not in ('super_admin','merge_request')),
      'refusal_reason',      case
                               when v_auth is null then 'caller holds no direct authority for this pair'
                               when (v_conf->>'guardian_sets_differ')::boolean
                                    and v_auth not in ('super_admin','merge_request')
                                 then 'the two records have different guardians — both families must confirm'
                               else null end,
      'conflicts',           v_conf,
      'would_move',          v_moved,
      'would_skip_as_duplicate', v_skipped,
      'would_carry_identity_fields', to_jsonb(v_carried));
  end if;

  -- 16. TOMBSTONE. No DELETE, ever.
  update players
     set merged_into_id    = p_keep,
         merged_at         = now(),
         merged_by_user_id = uid
   where id = p_retire;

  -- ---- AUDIT ----
  insert into player_reconciliations (
    canonical_player_id, retired_player_id, actor_user_id, request_id, authority,
    merge_request_id, moved, skipped_as_duplicate, carried_identity_fields)
  values (p_keep, p_retire, uid, p_request_id, v_auth,
          p_merge_request_id, v_moved, v_skipped, v_carried)
  returning id into v_recon_id;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'reconcile_players', uid, 'players', p_keep,
          jsonb_build_object('kept', p_keep, 'retired', p_retire, 'authority', v_auth,
                             'request_id', p_request_id, 'moved', v_moved,
                             'skipped_as_duplicate', v_skipped,
                             'carried_identity_fields', to_jsonb(v_carried),
                             'reconciliation_id', v_recon_id));

  -- Tell every guardian of the surviving child what happened.
  perform notify_users(
    array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_keep),
    'players_reconciled', uid, p_keep, null, 'player', p_keep);

  return jsonb_build_object(
    'status','applied',
    'canonical_player_id', p_keep,
    'retired_player_id',   p_retire,
    'authority',           v_auth,
    'moved',               v_moved,
    'skipped_as_duplicate',v_skipped,
    'carried_identity_fields', to_jsonb(v_carried),
    'reconciliation_id',   v_recon_id);
end $function$;

comment on function public.reconcile_players(uuid, uuid, uuid, boolean, text, uuid, boolean) is
  'Safe player reconciliation (Slice D1): repoint every dependent reference then TOMBSTONE the loser -- never a hard delete. Idempotent per (actor, request_id). Authority per plan v2 §7.2; coach status alone can never combine children who belong to families. p_dry_run => true reports exactly what would move and writes nothing (Slice D5 tooling).';

revoke execute on function public.reconcile_players(uuid, uuid, uuid, boolean, text, uuid, boolean) from public, anon;
grant  execute on function public.reconcile_players(uuid, uuid, uuid, boolean, text, uuid, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
