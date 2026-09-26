-- ============================================================================
-- Slice D4 (part 2 of 2) — THE QUIET IDENTITY-CONFLICT WORKFLOW
--
-- WHAT REPLACES THE OLD SUGGESTER
--   Slice A deleted suggest_duplicate_players because it matched on NAMES: it would have
--   offered to merge Jackson Schneider into Jackson Tochman -- two different children -- and
--   the old merge_players would have hard-deleted one of them.
--
--   Its replacement is NOT a matcher. list_identity_conflicts() is a deterministic query over
--   RECORDED RELATIONSHIPS. Every source is a fact somebody put in the database:
--     1. the SAME adult holds guardian links to both rows        (parent_player_links)
--     2. the two rows share an explicit lineage assertion         (players.player_lineage_id)
--     3. a coach flagged the pair, or a guardian opened a request  (player_merge_requests)
--   Names, nicknames, trigram similarity and jersey numbers are NEVER consulted. Two children
--   who happen to share a name are never surfaced, and that is a structural guarantee rather
--   than a threshold that could be tuned wrong later.
--
-- NO AUTOMATIC MERGES. Everything here produces a SUGGESTION or a REQUEST. The only thing
-- that moves data is D1's reconcile_players, under its own authority checks.
--
-- BUILD 68 COMPATIBILITY: entirely new RPCs and policies on new tables. Nothing Build 68
-- calls is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RLS FOR THE TWO D4 TABLES
--    Reads are scoped to the people with standing in the pair. All WRITES go through the
--    definer RPCs below -- there is deliberately no client INSERT/UPDATE/DELETE policy, so a
--    direct PostgREST call cannot forge a dismissal or a confirmation.
-- ----------------------------------------------------------------------------
drop policy if exists player_match_dismissals_read on public.player_match_dismissals;
create policy player_match_dismissals_read on public.player_match_dismissals
  for select to authenticated
  using (
    public.is_super_admin()
    or dismissed_by_user_id = (select auth.uid())
    or public.is_linked_parent(player_a) or public.is_linked_parent(player_b)
    or (scope = 'team' and public.is_team_coach(team_id))
  );

drop policy if exists player_merge_requests_read on public.player_merge_requests;
create policy player_merge_requests_read on public.player_merge_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or requested_by_user_id = (select auth.uid())
    or public.is_linked_parent(source_player_id)
    or public.is_linked_parent(target_player_id)
    -- a coach of a team either child currently plays on: they may have raised the flag and
    -- need to see its state, but per plan v2 §7.2 they can never confirm a merge.
    or exists (select 1 from public.player_teams pt
                where pt.player_id in (source_player_id, target_player_id)
                  and pt.left_on is null and public.is_team_coach(pt.team_id))
  );

-- ----------------------------------------------------------------------------
-- 2. THE CONFLICT LIST
-- ----------------------------------------------------------------------------
create or replace function public.list_identity_conflicts()
returns table (
  player_a        uuid,
  player_b        uuid,
  name_a          text,
  name_b          text,
  evidence        text,
  evidence_detail text,
  i_may_reconcile boolean,
  authority       text,
  open_request_id uuid,
  request_status  text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with
  -- SOURCE 1 — the same adult holds guardian links to both rows. A recorded fact.
  same_guardian as (
    select least(a.player_id, b.player_id) as pa,
           greatest(a.player_id, b.player_id) as pb,
           'same_guardian'::text as evidence,
           'You are listed as a guardian of both records'::text as detail
      from parent_player_links a
      join parent_player_links b
        on b.parent_user_id = a.parent_user_id and b.player_id <> a.player_id
     where a.parent_user_id = auth.uid()
  ),
  -- SOURCE 2 — an explicit human assertion that these are the same child.
  same_lineage as (
    select least(a.id, b.id) as pa, greatest(a.id, b.id) as pb,
           'linked_identity'::text,
           'Someone has already recorded these as the same child'::text
      from players a
      join players b
        on coalesce(b.player_lineage_id, b.id) = coalesce(a.player_lineage_id, a.id)
       and b.id <> a.id
     where a.merged_into_id is null and b.merged_into_id is null
       and (public.is_linked_parent(a.id) or public.is_linked_parent(b.id)
            or public.is_super_admin())
  ),
  -- SOURCE 3 — a coach flag or a guardian's request, live.
  flagged as (
    select least(mr.source_player_id, mr.target_player_id) as pa,
           greatest(mr.source_player_id, mr.target_player_id) as pb,
           case when mr.requested_as = 'coach' then 'coach_flagged' else 'merge_requested' end::text,
           coalesce(mr.reason, case when mr.requested_as = 'coach'
                                    then 'A coach flagged these as possibly the same child'
                                    else 'A guardian asked to combine these records' end)::text
      from player_merge_requests mr
     where mr.status in ('pending','confirmed')
  ),
  unioned as (
    select pa, pb, evidence, detail from same_guardian
    union all select * from same_lineage
    union all select * from flagged
  ),
  -- one row per pair, strongest evidence first
  ranked as (
    select pa, pb, evidence, detail,
           row_number() over (partition by pa, pb order by
             case evidence when 'same_guardian' then 1 when 'linked_identity' then 2
                           when 'merge_requested' then 3 else 4 end) as rn
      from unioned
  )
  select r.pa, r.pb, a.name, b.name, r.evidence, r.detail,
         public.reconcile_authority(r.pa, r.pb) is not null,
         public.reconcile_authority(r.pa, r.pb),
         mr.id, mr.status
    from ranked r
    join players a on a.id = r.pa
    join players b on b.id = r.pb
    left join player_merge_requests mr
      on least(mr.source_player_id, mr.target_player_id) = r.pa
     and greatest(mr.source_player_id, mr.target_player_id) = r.pb
     and mr.status in ('pending','confirmed')
   where r.rn = 1
     and a.merged_into_id is null
     and b.merged_into_id is null
     -- DISMISSED PAIRS ARE EXCLUDED. A dismissal may be re-surfaced exactly once, and only
     -- when NEW recorded-relationship evidence post-dates it (D12). Never on names.
     and not exists (
       select 1 from player_match_dismissals d
        where d.player_a = r.pa and d.player_b = r.pb
          and d.revoked_at is null
          and (d.scope = 'global' or (d.scope = 'team' and public.is_team_coach(d.team_id)))
          -- still dismissed unless there is later evidence AND it has not already been
          -- re-surfaced once for this dismissal
          and not (
            d.resurfaced_at is null
            and exists (
              select 1 from parent_player_links l1
               join parent_player_links l2
                 on l2.parent_user_id = l1.parent_user_id and l2.player_id = r.pb
              where l1.player_id = r.pa
                and greatest(l1.created_at, l2.created_at) > d.dismissed_at)
          )
     )
   order by a.name;
$function$;

comment on function public.list_identity_conflicts() is
  'Quiet identity-conflict suggestions built ONLY from recorded relationships (plan v2 §6.1): the same adult holding both records, an explicit lineage assertion, or a coach flag / guardian request. Never names, nicknames, trigrams or jersey numbers -- so two different children who share a name are structurally incapable of being suggested. Suggestions only; nothing here moves data.';

grant execute on function public.list_identity_conflicts() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. "THESE ARE DIFFERENT CHILDREN" — permanent, normalised dismissal
-- ----------------------------------------------------------------------------
create or replace function public.dismiss_identity_conflict(
  p_player_a uuid, p_player_b uuid, p_team_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid  uuid := auth.uid();
  pa   uuid := least(p_player_a, p_player_b);
  pb   uuid := greatest(p_player_a, p_player_b);
  v_as text;
  v_scope text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if pa = pb then raise exception 'A player cannot be a duplicate of itself'; end if;

  -- Authority tiers (plan v2 §6.2). A GUARDIAN of either row speaks for the family and the
  -- dismissal is global. A COACH may only silence it for their OWN team, and never for a
  -- family -- which is the direct answer to "a random coach must not silence a real identity
  -- problem for every family forever".
  if public.is_super_admin() then
    v_as := 'super_admin'; v_scope := 'global';
  elsif public.is_linked_parent(pa) or public.is_linked_parent(pb) then
    v_as := 'guardian'; v_scope := 'global';
  elsif p_team_id is not null and public.is_team_coach(p_team_id)
        and exists (select 1 from player_teams where player_id = pa and team_id = p_team_id and left_on is null)
        and exists (select 1 from player_teams where player_id = pb and team_id = p_team_id and left_on is null)
  then
    v_as := 'coach'; v_scope := 'team';
  else
    raise exception 'Not authorized to dismiss this pair';
  end if;

  insert into player_match_dismissals
    (player_a, player_b, scope, team_id, dismissed_by_user_id, asserted_as)
  values (pa, pb, v_scope, case when v_scope = 'team' then p_team_id end, uid, v_as)
  on conflict (player_a, player_b, scope,
               coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set dismissed_at = now(), dismissed_by_user_id = uid,
                asserted_as = v_as, revoked_at = null,
                -- a second dismissal after a re-surface is final for that evidence class
                resurfaced_at = player_match_dismissals.resurfaced_at;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'dismiss_identity_conflict', uid, 'player_match_dismissals', pa,
          jsonb_build_object('player_a', pa, 'player_b', pb, 'scope', v_scope,
                             'asserted_as', v_as, 'team_id', p_team_id));
end $function$;

grant execute on function public.dismiss_identity_conflict(uuid, uuid, uuid) to authenticated, service_role;

-- Mark a re-surfaced suggestion as seen, so a pair can be re-raised ONCE per dismissal and
-- can never loop.
create or replace function public.mark_conflict_resurfaced(
  p_player_a uuid, p_player_b uuid, p_reason text default 'new_recorded_relationship')
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update player_match_dismissals
     set resurfaced_at = now(), resurfaced_reason = p_reason
   where player_a = least(p_player_a, p_player_b)
     and player_b = greatest(p_player_a, p_player_b)
     and resurfaced_at is null
     and (public.is_super_admin()
          or public.is_linked_parent(p_player_a) or public.is_linked_parent(p_player_b));
$function$;

grant execute on function public.mark_conflict_resurfaced(uuid, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. REQUESTS — the dual-confirmation path for authority-matrix cases 4 and 5
-- ----------------------------------------------------------------------------
create or replace function public.request_player_merge(
  p_source_player_id uuid, p_target_player_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  v_as text;
  v_id uuid;
  pa uuid := least(p_source_player_id, p_target_player_id);
  pb uuid := greatest(p_source_player_id, p_target_player_id);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if pa = pb then raise exception 'A player cannot be merged with itself'; end if;

  if public.is_super_admin() then v_as := 'super_admin';
  elsif public.is_linked_parent(p_source_player_id) or public.is_linked_parent(p_target_player_id)
    then v_as := 'guardian';
  elsif exists (select 1 from player_teams pt
                 where pt.player_id in (pa, pb) and pt.left_on is null
                   and public.is_team_coach(pt.team_id))
    -- A coach may only FLAG. The row is a suggestion to the family; a coach can never
    -- confirm it (see confirm_player_merge).
    then v_as := 'coach';
  else
    raise exception 'Not authorized to raise a reconciliation request for these players';
  end if;

  -- One live request per unordered pair. A double-tap returns the existing one instead of
  -- failing or opening a second.
  select id into v_id from player_merge_requests
   where least(source_player_id, target_player_id) = pa
     and greatest(source_player_id, target_player_id) = pb
     and status in ('pending','confirmed');
  if v_id is not null then return v_id; end if;

  insert into player_merge_requests
    (source_player_id, target_player_id, requested_by_user_id, requested_as, reason)
  values (p_source_player_id, p_target_player_id, uid, v_as, p_reason)
  returning id into v_id;

  -- Notify the other side: every guardian of either row, excluding the requester.
  perform notify_users(
    array(select distinct l.parent_user_id from parent_player_links l
           where l.player_id in (pa, pb) and l.parent_user_id <> uid),
    'player_merge_requested', uid, pa, null, 'player', pa);

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'request_player_merge', uid, 'player_merge_requests', v_id,
          jsonb_build_object('source', p_source_player_id, 'target', p_target_player_id,
                             'requested_as', v_as, 'reason', p_reason));
  return v_id;
end $function$;

grant execute on function public.request_player_merge(uuid, uuid, text) to authenticated, service_role;

create or replace function public.confirm_player_merge(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r public.player_merge_requests;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into r from player_merge_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then
    raise exception 'That request is already %', r.status;
  end if;
  if r.expires_at < now() then
    update player_merge_requests set status = 'expired' where id = p_request_id;
    raise exception 'That request has expired';
  end if;

  -- WHO MAY CONFIRM (plan v2 §7.2 cases 4-5):
  --   * a super admin, or
  --   * a guardian with MANAGEMENT authority over either child who is NOT the requester
  --     (the other family's signature), or
  --   * a coach of the unclaimed row's team, when one row has no family at all (case 4 --
  --     there is no other family to sign, so the coach supplies the second signal).
  -- A coach may NEVER confirm a pair where both rows belong to families.
  if public.is_super_admin() then
    null;
  elsif r.requested_by_user_id <> uid
        and (public.can_manage_guardians(r.source_player_id)
             or public.can_manage_guardians(r.target_player_id)) then
    null;
  elsif (not exists (select 1 from parent_player_links where player_id = r.source_player_id)
         or not exists (select 1 from parent_player_links where player_id = r.target_player_id))
        and exists (select 1 from player_teams pt
                     where pt.player_id in (r.source_player_id, r.target_player_id)
                       and pt.left_on is null and public.is_team_coach(pt.team_id))
        and r.requested_by_user_id <> uid then
    null;
  else
    raise exception 'Not authorized to confirm this reconciliation'
      using hint = 'The other family must confirm, or IamSports support can act.';
  end if;

  update player_merge_requests
     set status = 'confirmed', confirmed_by_user_id = uid, confirmed_at = now()
   where id = p_request_id;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'confirm_player_merge', uid, 'player_merge_requests', p_request_id,
          jsonb_build_object('source', r.source_player_id, 'target', r.target_player_id));

  perform notify_users(array[r.requested_by_user_id], 'player_merge_confirmed', uid,
                       r.target_player_id, null, 'player', r.target_player_id);
end $function$;

grant execute on function public.confirm_player_merge(uuid) to authenticated, service_role;

create or replace function public.decline_player_merge(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r public.player_merge_requests;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from player_merge_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('pending','confirmed') then
    raise exception 'That request is already %', r.status;
  end if;

  if not (public.is_super_admin()
          or public.is_linked_parent(r.source_player_id)
          or public.is_linked_parent(r.target_player_id)) then
    raise exception 'Not authorized to decline this reconciliation';
  end if;

  update player_merge_requests set status = 'declined' where id = p_request_id;

  -- Declining records a dismissal at the decliner's authority tier, so a refused merge does
  -- not come straight back as a suggestion (plan v2 §7.3).
  perform public.dismiss_identity_conflict(r.source_player_id, r.target_player_id, null);

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'decline_player_merge', uid, 'player_merge_requests', p_request_id,
          jsonb_build_object('source', r.source_player_id, 'target', r.target_player_id));
end $function$;

grant execute on function public.decline_player_merge(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RETIRE THE OLD NAME-BASED SUGGESTER'S SHELL
--    Slice A already made it return zero rows. Point its comment at the replacement so nobody
--    resurrects it, and keep the signature for installed builds.
-- ----------------------------------------------------------------------------
comment on function public.suggest_duplicate_players(uuid) is
  'RETIRED (Slice A, 2026-09-25): always returns zero rows. Name-based duplicate suggestion is forbidden -- it would have offered to merge two different children with the same first name. Replacement: list_identity_conflicts() (Slice D4), which uses only recorded relationships. Signature retained for installed builds.';

notify pgrst, 'reload schema';
