-- C.5 step 3 — controlled super-admin guardian recovery.
--
-- WHY
--   claim_roster_spot hardcodes relationship='parent' for whoever claims a child FIRST,
--   and remove_guardian() gates on that text: a 'parent' may remove a 'guardian', never
--   the reverse. So a wrong first claimer becomes an unremovable primary who can evict
--   the real family and rotate the guardian code they need. Before C.5 the only remedy
--   was hand-editing parent_player_links in SQL. C.5 step 2 closed raw coach mutation,
--   which makes an explicit, audited repair path mandatory rather than optional.
--
-- SCOPE DISCIPLINE
--   These are REPAIR tools. C.5 does NOT redesign the parent/guardian model; the product
--   fix for first-claimer-wins is Slice D. Neither function can create a guardian
--   relationship, and neither grants a coach anything.

-- ============================================================
-- admin_set_primary_guardian — transfer primary among ALREADY-LINKED guardians.
-- ============================================================
create or replace function public.admin_set_primary_guardian(
  p_player_id uuid,
  p_new_primary_user_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid            uuid := auth.uid();
  v_old_primary  uuid;
  v_new_rel      text;
  v_parents      int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  -- SUPER ADMIN ONLY. Not a coach, not a guardian, not the primary guardian.
  if not public.is_super_admin() then
    raise exception 'Only a super admin may transfer the primary guardian';
  end if;

  -- Lock the child row for the duration: serialises concurrent recovery operations
  -- against each other and against claim_roster_spot / claim_or_link_guardian, both of
  -- which take the same lock.
  perform 1 from public.players where id = p_player_id for update;
  if not found then raise exception 'Player not found'; end if;

  -- The target MUST already be linked. This function never creates a relationship.
  select relationship into v_new_rel
    from public.parent_player_links
   where player_id = p_player_id and parent_user_id = p_new_primary_user_id;
  if v_new_rel is null then
    raise exception 'That user is not a guardian of this player. Link them first; this function never creates a guardian relationship.';
  end if;

  -- Current primary (may be absent in already-broken data, which is the point).
  select parent_user_id into v_old_primary
    from public.parent_player_links
   where player_id = p_player_id and relationship = 'parent'
   order by created_at
   limit 1;

  if v_old_primary = p_new_primary_user_id then
    -- Already primary. Still normalise any duplicate 'parent' rows below.
    null;
  end if;

  -- Demote EVERY other 'parent' row, then promote exactly the target. Doing it in this
  -- order guarantees exactly one 'parent' even if the data arrived with several.
  update public.parent_player_links
     set relationship = 'guardian'
   where player_id = p_player_id
     and parent_user_id <> p_new_primary_user_id
     and relationship = 'parent';

  update public.parent_player_links
     set relationship = 'parent'
   where player_id = p_player_id
     and parent_user_id = p_new_primary_user_id;

  -- Post-condition: exactly one effective primary, or abort the whole transaction.
  select count(*) into v_parents
    from public.parent_player_links
   where player_id = p_player_id and relationship = 'parent';
  if v_parents <> 1 then
    raise exception 'Invariant violated: % primary guardians after transfer (expected exactly 1)', v_parents;
  end if;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'admin_set_primary_guardian', p_new_primary_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id,
                             'old_primary_user_id', v_old_primary,
                             'new_primary_user_id', p_new_primary_user_id,
                             'reason', p_reason));

  -- Notify every guardian of the child, including the demoted and promoted parties.
  perform notify_users(
    array(select ppl.parent_user_id from public.parent_player_links ppl where ppl.player_id = p_player_id),
    'guardian_primary_changed', uid, p_player_id, null, 'player', p_player_id
  );
end $function$;

revoke execute on function public.admin_set_primary_guardian(uuid, uuid, text) from public, anon;
grant  execute on function public.admin_set_primary_guardian(uuid, uuid, text) to authenticated, service_role;

-- ============================================================
-- admin_remove_guardian — remove a guardian link without stranding the child.
-- ============================================================
create or replace function public.admin_remove_guardian(
  p_player_id uuid,
  p_user_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid             uuid := auth.uid();
  v_rel           text;
  v_remaining     int;
  v_other_parents int;
  v_parents_after int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin may remove a guardian through admin recovery';
  end if;

  perform 1 from public.players where id = p_player_id for update;
  if not found then raise exception 'Player not found'; end if;

  select relationship into v_rel
    from public.parent_player_links
   where player_id = p_player_id and parent_user_id = p_user_id;
  if v_rel is null then
    raise exception 'That user is not a guardian of this player';
  end if;

  select count(*) into v_remaining
    from public.parent_player_links
   where player_id = p_player_id and parent_user_id <> p_user_id;

  -- Removing the PRIMARY while other guardians remain would leave the child with
  -- guardians but no primary -- the invalid state that produces the eviction bug.
  -- Require an explicit replacement first, with an admin-facing message that says so.
  if v_rel = 'parent' and v_remaining > 0 then
    select count(*) into v_other_parents
      from public.parent_player_links
     where player_id = p_player_id and parent_user_id <> p_user_id and relationship = 'parent';
    if v_other_parents = 0 then
      raise exception 'Refusing to remove the primary guardian: % other guardian(s) remain and no replacement primary exists. Call admin_set_primary_guardian(player, new_primary) first, then retry.', v_remaining;
    end if;
  end if;

  delete from public.parent_player_links
   where player_id = p_player_id and parent_user_id = p_user_id;

  -- Post-condition: either no guardians at all, or exactly one primary.
  select count(*) into v_parents_after
    from public.parent_player_links
   where player_id = p_player_id and relationship = 'parent';
  select count(*) into v_remaining
    from public.parent_player_links
   where player_id = p_player_id;
  if v_remaining > 0 and v_parents_after <> 1 then
    raise exception 'Invariant violated: % guardian(s) remain but % primary (expected exactly 1)', v_remaining, v_parents_after;
  end if;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'admin_remove_guardian', p_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id,
                             'removed_user_id', p_user_id,
                             'removed_relationship', v_rel,
                             'guardians_remaining', v_remaining,
                             'reason', p_reason));

  -- Notify whoever is left. (The removed party is deliberately not notified here; the
  -- trg_revoke_guardian_seat trigger already fires on the delete for seat revocation.)
  if v_remaining > 0 then
    perform notify_users(
      array(select ppl.parent_user_id from public.parent_player_links ppl where ppl.player_id = p_player_id),
      'guardian_removed', uid, p_player_id, null, 'player', p_player_id
    );
  end if;
end $function$;

revoke execute on function public.admin_remove_guardian(uuid, uuid, text) from public, anon;
grant  execute on function public.admin_remove_guardian(uuid, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
