-- ============================================================================
-- Slice D2 — IDENTITY LIFECYCLE + EXPLICIT GUARDIAN-MANAGEMENT CAPABILITY
--
-- THE PROBLEM THIS CLOSES
--   Today authority is inferred from two accidents: the string in
--   parent_player_links.relationship, and ARRIVAL ORDER (claim_or_link_guardian writes
--   'parent' when the child has no guardians yet, 'guardian' otherwise). So the FIRST adult
--   to type a code becomes the permanent authority over a child -- including the power to
--   remove the real family. That is the first-claimer inversion.
--
-- THE MODEL (Adam's brief, 2026-09-26)
--   Team membership != coaching authority != guardianship != child-identity authority.
--   * `relationship` becomes DESCRIPTIVE ('parent','guardian','grandparent',...).
--   * `can_manage_guardians` becomes the AUTHORITY primitive, and it is never granted by
--     arrival order and never by coach role.
--   * A code authorises ENTRY (linking). It does NOT confer management authority.
--   * Authority is conferred by exactly four things:
--       1. creating the child yourself (create_kid — you ARE the originating family)
--       2. an existing manager granting it       (grant_guardian_management)
--       3. narrowly scoped coach confirmation of a claimant on a child that has NO manager
--          (coach_confirm_guardian_claim) — grants the CLAIMANT authority, the coach none
--       4. super admin recovery                   (admin_set_primary_guardian)
--     Never time-based promotion. Never arrival order.
--
-- ONE COHERENT AUTHORITY DEFINITION
--   is_primary_guardian() (read by the live shares_read policy), remove_guardian(), and the
--   two C.5 admin recovery RPCs are all moved onto can_manage_guardians in this migration, so
--   the four mechanisms that previously disagreed now read and write ONE signal. D0.75 made
--   them agree on `relationship` as a transitional step; this completes the move.
--   `relationship` is kept IN SYNC as a descriptive mirror so Build 68's kid_guardians
--   display and C.5's "exactly one primary" post-conditions keep working unchanged.
--
-- BACKFILL SAFETY — verified against live production 2026-09-26
--   9 children have guardian links; 0 lack a relationship='parent' row; 0 have more than one;
--   0 rows where earliest-link <> parent-flagged. So granting can_manage_guardians to exactly
--   the existing 'parent' rows reproduces today's authority for every current family: no
--   family gains or loses anything on the day this ships.
--
-- BUILD 68 COMPATIBILITY — one intentional behaviour change, documented
--   Additive columns, no signature changes, no removals. The ONE deliberate change: an adult
--   who claims a child with a code from Build 68 is now linked but does NOT become the
--   child's manager. That is the entire point of the slice. Practical effect on Build 68:
--   they cannot call remove_guardian, and they cannot see a not-yet-on-wall inbox share
--   (shares_read's primary branch). Live production has 0 such inbox shares, so nothing
--   currently visible disappears. The confirmation UI that resolves it ships in D3 on web;
--   super admin is the recovery path meanwhile.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUMNS
-- ----------------------------------------------------------------------------
alter table public.parent_player_links
  add column if not exists can_manage_guardians boolean not null default false,
  add column if not exists verified_at          timestamptz null,
  add column if not exists verified_by_user_id  uuid null,
  add column if not exists verification_basis   text null;

comment on column public.parent_player_links.can_manage_guardians is
  'THE authority primitive (Slice D2). TRUE = this adult may add/remove other guardians and holds identity authority for this child. Never granted by arrival order, never by coach role. relationship is descriptive only.';

alter table public.players
  add column if not exists identity_state text not null default 'provisional';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'players_identity_state_check') then
    alter table public.players add constraint players_identity_state_check
      check (identity_state in ('provisional','claimed_unverified','verified','retired'));
  end if;
end $$;

create index if not exists idx_players_identity_state on public.players (identity_state);

comment on column public.players.identity_state is
  'Explicit identity lifecycle (Slice D2): provisional (coach-created, no guardian) -> claimed_unverified (an adult linked, no verification event) -> verified (a manager exists) -> retired (tombstoned, see merged_into_id). Replaces states the code previously inferred.';

-- ----------------------------------------------------------------------------
-- 2. BACKFILL — existing legitimate families keep exactly what they have today
-- ----------------------------------------------------------------------------
update public.parent_player_links l
   set can_manage_guardians = true,
       verified_at          = coalesce(l.verified_at, l.created_at),
       verification_basis   = coalesce(l.verification_basis, 'backfill_existing_primary')
 where l.relationship = 'parent'
   and l.can_manage_guardians = false;

-- Safety net: a child that has guardians but (through historical data drift) no
-- relationship='parent' row would otherwise end up with NO manager and be unrecoverable
-- without support. Production has 0 such rows; this makes the backfill correct anyway by
-- promoting that child's earliest link.
with needing as (
  select l.player_id, min(l.created_at) as first_created
    from public.parent_player_links l
   group by l.player_id
  having count(*) filter (where l.can_manage_guardians) = 0
)
update public.parent_player_links l
   set can_manage_guardians = true,
       verified_at        = coalesce(l.verified_at, l.created_at),
       verification_basis = 'backfill_no_primary_existed'
  from needing n
 where l.player_id = n.player_id and l.created_at = n.first_created;

-- Keep the descriptive mirror consistent with the new authority signal.
update public.parent_player_links
   set relationship = 'parent'
 where can_manage_guardians and coalesce(relationship,'') <> 'parent';

update public.players p
   set identity_state = case
     when p.merged_into_id is not null then 'retired'
     when exists (select 1 from public.parent_player_links l
                   where l.player_id = p.id and l.can_manage_guardians) then 'verified'
     when exists (select 1 from public.parent_player_links l where l.player_id = p.id)
       then 'claimed_unverified'
     else 'provisional' end
 where true;

-- ----------------------------------------------------------------------------
-- 3. ONE AUTHORITY DEFINITION
--    Supersedes D0.75's transitional `relationship = 'parent'` read.
-- ----------------------------------------------------------------------------
create or replace function public.is_primary_guardian(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from parent_player_links ppl
    where ppl.player_id      = p_player_id
      and ppl.parent_user_id = auth.uid()
      and ppl.can_manage_guardians
  );
$function$;

comment on function public.is_primary_guardian(uuid) is
  'TRUE when the caller holds guardian-MANAGEMENT authority for this child. Reads parent_player_links.can_manage_guardians (Slice D2) -- the single authority primitive, replacing D0.75''s transitional relationship read and, before that, earliest created_at. Read by the shares_read RLS policy.';

-- A clearer name for the same fact, for new code. Kept as a separate function so the
-- shares_read policy does not have to be rewritten.
create or replace function public.can_manage_guardians(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_super_admin() or exists (
    select 1 from parent_player_links ppl
    where ppl.player_id      = p_player_id
      and ppl.parent_user_id = auth.uid()
      and ppl.can_manage_guardians
  );
$function$;

grant execute on function public.can_manage_guardians(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. remove_guardian — gated on the capability, not on a descriptive string
-- ----------------------------------------------------------------------------
create or replace function public.remove_guardian(p_player_id uuid, p_guardian_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  v_caller_manages boolean;
  v_target_manages boolean;
  v_target_exists  boolean;
  v_managers_after int;
  v_remaining      int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  perform 1 from players where id = p_player_id for update;

  select true, can_manage_guardians into v_target_exists, v_target_manages
    from parent_player_links where player_id = p_player_id and parent_user_id = p_guardian_user_id;
  if not coalesce(v_target_exists, false) then
    raise exception 'That person is not a guardian of this player';
  end if;

  select coalesce(bool_or(can_manage_guardians), false) into v_caller_manages
    from parent_player_links where player_id = p_player_id and parent_user_id = uid;

  -- You may always remove YOURSELF. Removing anyone else requires management authority.
  -- A manager may not remove another manager: that is a support/recovery action, so a
  -- compromised or hostile co-manager cannot evict the other one.
  if p_guardian_user_id <> uid then
    if not v_caller_manages then
      raise exception 'Only a guardian with management authority can remove another guardian';
    end if;
    if v_target_manages then
      raise exception 'That guardian also has management authority. Ask IamSports support to remove them.'
        using hint = 'This protects a family from one manager evicting another.';
    end if;
  end if;

  -- Never leave a child with guardians but no manager.
  select count(*) into v_managers_after from parent_player_links
   where player_id = p_player_id and parent_user_id <> p_guardian_user_id and can_manage_guardians;
  select count(*) into v_remaining from parent_player_links
   where player_id = p_player_id and parent_user_id <> p_guardian_user_id;
  if v_remaining > 0 and v_managers_after = 0 then
    raise exception 'Removing yourself would leave this child with guardians but nobody able to manage them. Grant management to another guardian first.'
      using hint = 'Use grant_guardian_management(player, user) before leaving.';
  end if;

  delete from parent_player_links
   where player_id = p_player_id and parent_user_id = p_guardian_user_id;

  delete from team_memberships tm
  where tm.user_id = p_guardian_user_id
    and tm.role = 'parent'
    and tm.team_id in (select team_id from player_teams where player_id = p_player_id)
    and not exists (
      select 1 from parent_player_links ppl2
      join player_teams pt2 on pt2.player_id = ppl2.player_id
      where ppl2.parent_user_id = p_guardian_user_id and pt2.team_id = tm.team_id
    );

  -- Keep the lifecycle honest: losing the last guardian returns the child to provisional.
  update players set identity_state = case
      when merged_into_id is not null then 'retired'
      when exists (select 1 from parent_player_links l where l.player_id = p_player_id and l.can_manage_guardians) then 'verified'
      when exists (select 1 from parent_player_links l where l.player_id = p_player_id) then 'claimed_unverified'
      else 'provisional' end
   where id = p_player_id;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'remove_guardian', p_guardian_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'removed_user_id', p_guardian_user_id,
                             'self_removal', p_guardian_user_id = uid));
end $function$;

-- ----------------------------------------------------------------------------
-- 5. GRANTING AND REVOKING MANAGEMENT — an existing manager confirming another
-- ----------------------------------------------------------------------------
create or replace function public.grant_guardian_management(p_player_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform 1 from players where id = p_player_id for update;

  -- Only an existing manager (or super admin) may confer management. NEVER a coach.
  if not public.can_manage_guardians(p_player_id) then
    raise exception 'Only a guardian who already manages this child (or IamSports support) can grant management authority';
  end if;
  if not exists (select 1 from parent_player_links
                  where player_id = p_player_id and parent_user_id = p_user_id) then
    raise exception 'That person is not a guardian of this player. Link them first.';
  end if;

  update parent_player_links
     set can_manage_guardians = true,
         relationship         = 'parent',
         verified_at          = coalesce(verified_at, now()),
         verified_by_user_id  = coalesce(verified_by_user_id, uid),
         verification_basis   = coalesce(verification_basis, 'granted_by_manager')
   where player_id = p_player_id and parent_user_id = p_user_id;

  update players set identity_state = 'verified'
   where id = p_player_id and merged_into_id is null;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'grant_guardian_management', p_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'granted_to', p_user_id));

  perform notify_users(array[p_user_id], 'guardian_management_granted', uid, p_player_id, null, 'player', p_player_id);
end $function$;

create or replace function public.revoke_guardian_management(p_player_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); v_managers int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform 1 from players where id = p_player_id for update;

  -- Only super admin may strip another manager. A manager may stand down themselves.
  if not (public.is_super_admin() or p_user_id = uid) then
    raise exception 'Only IamSports support can remove another guardian''s management authority';
  end if;
  if p_user_id = uid and not public.can_manage_guardians(p_player_id) then
    raise exception 'You do not have management authority for this child';
  end if;

  select count(*) into v_managers from parent_player_links
   where player_id = p_player_id and can_manage_guardians and parent_user_id <> p_user_id;
  if v_managers = 0 then
    raise exception 'This child would be left with no one able to manage their guardians. Grant management to another guardian first.';
  end if;

  update parent_player_links
     set can_manage_guardians = false, relationship = 'guardian'
   where player_id = p_player_id and parent_user_id = p_user_id;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'revoke_guardian_management', p_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'revoked_from', p_user_id));
end $function$;

-- ----------------------------------------------------------------------------
-- 6. NARROWLY SCOPED COACH CONFIRMATION (the second signal for a provisional child)
--
--    This is the ONLY thing a coach may do to guardianship, and it deliberately gives the
--    coach nothing. It answers exactly one question: "is this the adult I meant for THIS
--    child?" -- which is the fact only the coach possesses.
--
--    Hard limits, all enforced below:
--      * the coach must coach a team the child has an OPEN spell on
--      * the child must have NO existing manager (otherwise the family decides, not a coach)
--      * the target must ALREADY be linked (this never creates a guardian relationship —
--        C.5's F14 closure stays intact)
--      * a coach may NOT confirm themselves
--      * the coach gains NO management capability, on this child or any other
-- ----------------------------------------------------------------------------
create or replace function public.coach_confirm_guardian_claim(p_player_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); v_team uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_user_id = uid then
    raise exception 'A coach cannot confirm themselves as a child''s guardian manager'
      using hint = 'If you are this child''s parent, claim them with the family code like any other guardian.';
  end if;

  perform 1 from players where id = p_player_id for update;

  select pt.team_id into v_team
    from player_teams pt
   where pt.player_id = p_player_id and pt.left_on is null
     and public.is_team_coach(pt.team_id)
   limit 1;
  if v_team is null and not public.is_super_admin() then
    raise exception 'Only a coach of a team this child currently plays on can confirm a guardian';
  end if;

  if exists (select 1 from parent_player_links
              where player_id = p_player_id and can_manage_guardians) then
    raise exception 'This child already has a guardian who manages them. Only that family (or IamSports support) can add another manager.';
  end if;

  if not exists (select 1 from parent_player_links
                  where player_id = p_player_id and parent_user_id = p_user_id) then
    raise exception 'That adult has not claimed this child yet. They must join with the child''s code first.'
      using hint = 'This function never creates a guardian relationship.';
  end if;

  update parent_player_links
     set can_manage_guardians = true,
         relationship         = 'parent',
         verified_at          = now(),
         verified_by_user_id  = uid,
         verification_basis   = 'coach_confirmed'
   where player_id = p_player_id and parent_user_id = p_user_id;

  update players set identity_state = 'verified'
   where id = p_player_id and merged_into_id is null;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'coach_confirm_guardian_claim', p_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'confirmed_user_id', p_user_id, 'team_id', v_team));

  perform notify_users(array[p_user_id], 'guardian_claim_confirmed', uid, p_player_id, v_team, 'player', p_player_id);
end $function$;

revoke execute on function public.grant_guardian_management(uuid, uuid)    from public, anon;
revoke execute on function public.revoke_guardian_management(uuid, uuid)   from public, anon;
revoke execute on function public.coach_confirm_guardian_claim(uuid, uuid) from public, anon;
grant  execute on function public.grant_guardian_management(uuid, uuid)    to authenticated, service_role;
grant  execute on function public.revoke_guardian_management(uuid, uuid)   to authenticated, service_role;
grant  execute on function public.coach_confirm_guardian_claim(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. KEEP C.5's RECOVERY RPCs COHERENT WITH THE NEW PRIMITIVE
--    These are NOT weakened: still super-admin-only, still "never creates a relationship",
--    still exactly-one-primary post-conditions. They now write can_manage_guardians as well
--    as relationship, so recovery and authority cannot drift apart -- which is the whole
--    failure D0.75 was a stopgap for.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_primary_guardian(
  p_player_id uuid, p_new_primary_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid(); v_old_primary uuid; v_linked boolean; v_managers int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin may transfer the primary guardian';
  end if;

  perform 1 from public.players where id = p_player_id for update;
  if not found then raise exception 'Player not found'; end if;

  select true into v_linked from public.parent_player_links
   where player_id = p_player_id and parent_user_id = p_new_primary_user_id;
  if not coalesce(v_linked, false) then
    raise exception 'That user is not a guardian of this player. Link them first; this function never creates a guardian relationship.';
  end if;

  select parent_user_id into v_old_primary from public.parent_player_links
   where player_id = p_player_id and can_manage_guardians order by created_at limit 1;

  -- Demote on EITHER signal, not just the capability. Caught by the C.5 regression harness:
  -- a row carrying relationship='parent' with can_manage_guardians=false (possible in data
  -- written before the D2 backfill, or by any future path that sets only the descriptive
  -- field) would be skipped, leaving TWO 'parent' rows after a transfer -- the exact mirror
  -- divergence this slice exists to make impossible.
  update public.parent_player_links
     set can_manage_guardians = false, relationship = 'guardian'
   where player_id = p_player_id and parent_user_id <> p_new_primary_user_id
     and (can_manage_guardians or relationship = 'parent');

  update public.parent_player_links
     set can_manage_guardians = true, relationship = 'parent',
         verified_at         = coalesce(verified_at, now()),
         verified_by_user_id = coalesce(verified_by_user_id, uid),
         verification_basis  = coalesce(verification_basis, 'super_admin_recovery')
   where player_id = p_player_id and parent_user_id = p_new_primary_user_id;

  select count(*) into v_managers from public.parent_player_links
   where player_id = p_player_id and can_manage_guardians;
  if v_managers <> 1 then
    raise exception 'Invariant violated: % managing guardians after transfer (expected exactly 1)', v_managers;
  end if;

  update public.players set identity_state = 'verified'
   where id = p_player_id and merged_into_id is null;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'admin_set_primary_guardian', p_new_primary_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'old_primary_user_id', v_old_primary,
                             'new_primary_user_id', p_new_primary_user_id, 'reason', p_reason));

  perform notify_users(
    array(select ppl.parent_user_id from public.parent_player_links ppl where ppl.player_id = p_player_id),
    'guardian_primary_changed', uid, p_player_id, null, 'player', p_player_id);
end $function$;

create or replace function public.admin_remove_guardian(
  p_player_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid(); v_manages boolean; v_linked boolean;
  v_remaining int; v_other_managers int; v_managers_after int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin may remove a guardian through admin recovery';
  end if;

  perform 1 from public.players where id = p_player_id for update;
  if not found then raise exception 'Player not found'; end if;

  select true, can_manage_guardians into v_linked, v_manages
    from public.parent_player_links
   where player_id = p_player_id and parent_user_id = p_user_id;
  if not coalesce(v_linked, false) then
    raise exception 'That user is not a guardian of this player';
  end if;

  select count(*) into v_remaining from public.parent_player_links
   where player_id = p_player_id and parent_user_id <> p_user_id;

  if v_manages and v_remaining > 0 then
    select count(*) into v_other_managers from public.parent_player_links
     where player_id = p_player_id and parent_user_id <> p_user_id and can_manage_guardians;
    if v_other_managers = 0 then
      raise exception 'Refusing to remove the primary guardian: % other guardian(s) remain and no replacement primary exists. Call admin_set_primary_guardian(player, new_primary) first, then retry.', v_remaining;
    end if;
  end if;

  delete from public.parent_player_links
   where player_id = p_player_id and parent_user_id = p_user_id;

  select count(*) into v_managers_after from public.parent_player_links
   where player_id = p_player_id and can_manage_guardians;
  select count(*) into v_remaining from public.parent_player_links
   where player_id = p_player_id;
  if v_remaining > 0 and v_managers_after <> 1 then
    raise exception 'Invariant violated: % guardian(s) remain but % primary (expected exactly 1)', v_remaining, v_managers_after;
  end if;

  update public.players set identity_state = case
      when merged_into_id is not null then 'retired'
      when v_managers_after > 0 then 'verified'
      when v_remaining > 0 then 'claimed_unverified'
      else 'provisional' end
   where id = p_player_id;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'admin_remove_guardian', p_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'removed_user_id', p_user_id,
                             'removed_managed', v_manages,
                             'guardians_remaining', v_remaining, 'reason', p_reason));

  if v_remaining > 0 then
    perform notify_users(
      array(select ppl.parent_user_id from public.parent_player_links ppl where ppl.player_id = p_player_id),
      'guardian_removed', uid, p_player_id, null, 'player', p_player_id);
  end if;
end $function$;

-- ----------------------------------------------------------------------------
-- 8. KEEP identity_state TRUE AUTOMATICALLY
--    A trigger, so no future code path can link or unlink a guardian and leave the lifecycle
--    column lying. Cheaper and far more reliable than remembering to update it in 6 RPCs.
-- ----------------------------------------------------------------------------
create or replace function public.sync_player_identity_state()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_player uuid := coalesce(new.player_id, old.player_id);
begin
  update players p set identity_state = case
      when p.merged_into_id is not null then 'retired'
      when exists (select 1 from parent_player_links l where l.player_id = v_player and l.can_manage_guardians) then 'verified'
      when exists (select 1 from parent_player_links l where l.player_id = v_player) then 'claimed_unverified'
      else 'provisional' end
   where p.id = v_player
     and p.identity_state is distinct from case
      when p.merged_into_id is not null then 'retired'
      when exists (select 1 from parent_player_links l where l.player_id = v_player and l.can_manage_guardians) then 'verified'
      when exists (select 1 from parent_player_links l where l.player_id = v_player) then 'claimed_unverified'
      else 'provisional' end;
  return null;
end $function$;

drop trigger if exists trg_sync_player_identity_state on public.parent_player_links;
create trigger trg_sync_player_identity_state
  after insert or update of can_manage_guardians or delete on public.parent_player_links
  for each row execute function public.sync_player_identity_state();

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 9. A TOMBSTONED IDENTITY IS ALWAYS 'retired'
--    reconcile_players (D1) predates identity_state, so rather than duplicate the lifecycle
--    rule into that function, enforce it declaratively here. Any path that ever sets
--    merged_into_id -- today's reconcile_players, or anything added later -- gets the
--    lifecycle right for free, and a retired row can never linger as 'verified'.
-- ----------------------------------------------------------------------------
create or replace function public.force_retired_identity_state()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.merged_into_id is not null then
    new.identity_state := 'retired';
  elsif old.merged_into_id is not null and new.merged_into_id is null then
    -- un-retiring (support recovery): fall back to the guardian-derived state
    new.identity_state := case
      when exists (select 1 from parent_player_links l
                    where l.player_id = new.id and l.can_manage_guardians) then 'verified'
      when exists (select 1 from parent_player_links l where l.player_id = new.id)
        then 'claimed_unverified'
      else 'provisional' end;
  end if;
  return new;
end $function$;

drop trigger if exists trg_force_retired_identity_state on public.players;
create trigger trg_force_retired_identity_state
  before update of merged_into_id on public.players
  for each row execute function public.force_retired_identity_state();

notify pgrst, 'reload schema';
