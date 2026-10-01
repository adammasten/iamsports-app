-- Slice D9 — the family-code fast path.
--
-- THE PROBLEM THIS FIXES
--   Slice D correctly stopped a TEAM code from conferring authority over a child: a team code is
--   a secret a whole team holds, so "first to claim wins" was a race dressed up as a family
--   permission model. But D flattened BOTH codes to entry-only, and the per-child family code was
--   left unreachable anyway:
--
--     player_guardian_codes_read  USING (is_super_admin() OR is_linked_parent(player_id))
--     regenerate_guardian_code    gate: is_linked_parent(p_player_id) OR is_super_admin()
--
--   A coach is not a linked parent, so for an UNCLAIMED child -- precisely the case that matters --
--   a coach could neither read nor mint the child's family code. The only credential a coach could
--   hand out was the team code. That is WHY the team code became the claim path. On top of that,
--   app/(tabs)/roster.tsx already ships a per-player "Code XXXXXXXX · tap to share" affordance
--   (206f3b3, an ancestor of builds 70/71/76 and of main) which rendered nothing because the
--   policy returned zero rows, with a fallback button that always raised
--   "Only a guardian can reset this code". Classic fail-safe-by-swallowing.
--
-- THE MODEL (Adam, 2026-10-01)
--   TEAM CODE   = gets a family to the roster. Entry only. Authority still needs a coach's
--                 confirmation. claim_roster_spot is deliberately NOT TOUCHED by this migration.
--   FAMILY CODE = child-specific authorization. Only this child's family, or the coach who
--                 created the roster spot (create_roster_placeholder RETURNS the code to them),
--                 can have given it out. Presenting it IS the second signal, so the first adult
--                 to present it becomes the child's manager with no coach tap.
--
-- WHAT THIS MIGRATION CHANGES — 1 policy, 2 function bodies, ZERO schema
--   1. player_guardian_codes_read  -- a coach may read the code, but only while the child has
--                                     no guardian manager. Self-extinguishing: the moment a
--                                     family takes over, coach read access lapses on its own.
--                                     No revocation job, no scheduled sweep.
--   2. regenerate_guardian_code    -- the identical narrow coach branch in its authority gate.
--   3. claim_or_link_guardian      -- first-manager grant + code rotation + post-lock
--                                     revalidation + the three "loud" signals.
--
--   No table, column, index, constraint, trigger, enum or grant is touched. notifications.type is
--   plain text (verified), so the new 'guardian_self_claimed_by_coach' string needs no migration.
--
-- DELIBERATELY NOT BLOCKING A COACH FROM SELF-CLAIMING (Adam, 2026-10-01)
--   The obvious hardening -- refuse the grant when the redeemer coaches the child's team, mirroring
--   coach_confirm_guardian_claim's self-confirm block -- was investigated and REJECTED on evidence:
--     * is_team_coach counts admin/head_coach/coach, so it would have blocked the legitimate path
--       for 2 of the 9 current managers (both of them Adam, admin of his own kids' teams). The
--       coach-parent is the COMMON case in youth sports, not an edge case.
--     * It would also have cost those guardians inbox visibility of their own child's content:
--       shares_read gates the player audience on ((on_wall = true) OR is_primary_guardian(...)),
--       and is_primary_guardian reads can_manage_guardians.
--     * It would have blocked them from confirm_player_merge -- i.e. from reconciling duplicates
--       of their own child.
--     * And the protection would have been partial anyway: coach_confirm_guardian_claim requires
--       only (caller <> target, caller coaches the child's team, no existing manager, target
--       already linked), so a coach with a second email address can already claim from account B
--       and confirm it from account A. The block would have stopped the one-account version only.
--   So the decision is VISIBILITY, not prohibition: the grant is allowed, tagged
--   detail.self_coach in admin_audit_log, and announced to every OTHER coach on the child's teams.
--   Detection is one line:
--     select * from admin_audit_log
--      where action = 'claim_or_link_guardian' and detail->>'self_coach' = 'true';
--
-- ROLLBACK — behaviour is fully reversible; two data effects are not, by design.
--   Restore the three prior definitions, reproduced verbatim at the foot of this file.
--   NOT auto-reversible:
--     (a) grants already made -- enumerable, and individually reversible via
--         revoke_guardian_management(player, user):
--           select player_id, parent_user_id, verified_at from parent_player_links
--            where verification_basis = 'family_code';
--     (b) rotated codes -- the superseded code is gone for good. That is the intended security
--         property, not a defect. The family holds the new one on the kid screen.
--
-- BASELINE AT TIME OF WRITING (production, for the post-code compare)
--   managers 9 / total_links 12 / players_live 53
--   identity: provisional 44, claimed_unverified 0, verified 9
--   codes: 47 rows, 47 non-null, 47 unexpired, 0 with a code and a null expiry
--   children_with_links_no_manager 0   (so this migration alters NO existing row)
--   relationship mirror: guardian/false 3, parent/true 9, no mixed states

-- ---------------------------------------------------------------------------------------------
-- 1. POLICY — let a coach read the family code for a child nobody manages yet.
-- ---------------------------------------------------------------------------------------------
-- The coach branch is intentionally spelled out inline here and again in
-- regenerate_guardian_code rather than extracted into a helper, to keep this migration's blast
-- radius exactly 1 policy + 2 functions as reported pre-code. If a third caller ever needs it,
-- extract it then.
drop policy if exists player_guardian_codes_read on public.player_guardian_codes;

create policy player_guardian_codes_read on public.player_guardian_codes
for select using (
  public.is_super_admin()
  or public.is_linked_parent(player_id)
  or (
    -- a confirmed coach of a team this child CURRENTLY plays on ...
    exists (
      select 1 from public.player_teams pt
       where pt.player_id = player_guardian_codes.player_id
         and pt.left_on is null
         and public.is_team_coach(pt.team_id)
    )
    -- ... but only until the child has someone who manages them.
    and not exists (
      select 1 from public.parent_player_links l
       where l.player_id = player_guardian_codes.player_id
         and l.can_manage_guardians
    )
  )
);

comment on policy player_guardian_codes_read on public.player_guardian_codes is
  'Slice D9. Guardians and super admins always. A coach of a team the child currently plays on may ALSO read it, but only while no guardian manages the child -- so coach access to a family credential ends by itself the moment the family takes over. Writes remain definer-only (there is no INSERT/UPDATE/DELETE policy on this table).';

-- ---------------------------------------------------------------------------------------------
-- 2. regenerate_guardian_code — same narrow coach branch, so the roster's existing
--    "Get invite code" button works for exactly the children it is meant for.
-- ---------------------------------------------------------------------------------------------
create or replace function public.regenerate_guardian_code(p_player_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if not (
    is_linked_parent(p_player_id)
    or is_super_admin()
    -- Slice D9: a coach of a team this child currently plays on, while nobody manages the child.
    -- This is what makes "Invite this player's family" possible at all: before D9 the only
    -- credential a coach could hand out was the team code.
    or (
      exists (
        select 1 from player_teams pt
         where pt.player_id = p_player_id and pt.left_on is null
           and public.is_team_coach(pt.team_id)
      )
      and not exists (
        select 1 from parent_player_links l
         where l.player_id = p_player_id and l.can_manage_guardians
      )
    )
  ) then
    raise exception 'Only this child''s guardian can reset their code'
      using hint = 'A coach can share or reset a player''s family code only until that family has claimed the child.';
  end if;

  loop c := gen_join_code(8); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  update player_guardian_codes
     set code = c, last_used_at = null, expires_at = now() + interval '90 days'
   where player_id = p_player_id;
  if not found then
    -- Covers children created outside create_roster_placeholder / create_kid -- e.g. the six
    -- directly-seeded Demo Warriors 14U rows, which have no code row at all. Minting on demand
    -- is why no backfill is needed.
    insert into player_guardian_codes (player_id, code) values (p_player_id, c);
  end if;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_guardian_code', 'players', p_player_id,
          jsonb_build_object('player_id', p_player_id,
                             -- a super admin is neither, so exclude them explicitly rather
                             -- than labelling every non-guardian a coach
                             'by_coach', (not is_linked_parent(p_player_id)) and not is_super_admin()));
  return c;
end $function$;

comment on function public.regenerate_guardian_code(uuid) is
  'Slice D9. Mints/rotates a child''s family code. Allowed for a linked guardian, a super admin, or a coach of a team the child currently plays on WHILE no guardian manages the child. Inserts a code row if the child has none (directly-seeded players).';

-- ---------------------------------------------------------------------------------------------
-- 3. claim_or_link_guardian — the fast path.
-- ---------------------------------------------------------------------------------------------
create or replace function public.claim_or_link_guardian(p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid               uuid := auth.uid();
  p_id              uuid;
  n                 int;
  has_seat          boolean;
  v_code            text := upper(trim(p_code));
  v_already         boolean := false;
  v_grant           boolean := false;
  v_self_coach      boolean := false;
  v_prior_guardians uuid[] := '{}';
  v_new_code        text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('claim_or_link_guardian');

  select player_id into p_id from player_guardian_codes
   where code = v_code and (expires_at is null or expires_at > now());
  if p_id is null then raise exception 'Invalid code'; end if;

  -- Serialises concurrent redemptions of the same child. Everything below re-reads
  -- parent_player_links AFTER this lock, so under READ COMMITTED the second redeemer sees the
  -- first one's committed link and exactly one of them can win the grant.
  perform 1 from players where id = p_id for update;

  -- POST-LOCK REVALIDATION (new in D9). The lookup above ran BEFORE the lock, so a redemption
  -- that granted management and rotated this code could have committed in between. Without this
  -- re-check, that in-flight redeemer would still be linked using a code that no longer exists --
  -- which would make "rotated means dead" untrue in a narrow window.
  if not exists (
    select 1 from player_guardian_codes
     where player_id = p_id and code = v_code
       and (expires_at is null or expires_at > now())
  ) then
    perform public.record_code_attempt('claim_or_link_guardian', false);
    raise exception 'That code is no longer valid — it was replaced when this child''s family claimed them.'
      using hint = 'Ask the family for their current code.';
  end if;

  v_already := exists (
    select 1 from parent_player_links where parent_user_id = uid and player_id = p_id
  );

  -- THE FAST PATH. Grant management iff nobody manages this child yet. Note this is "no
  -- MANAGER", not "no guardians" (Adam, 2026-10-01): it also recovers the case where someone
  -- claimed via the team code and no coach ever confirmed them, without needing a coach tap.
  -- Arrival order still decides nothing on its own -- what decides is possession of a
  -- credential specific to THIS child.
  --
  -- Evaluated BEFORE the already-linked branch on purpose. The commonest stuck case is the
  -- SAME adult: mum claims with the team code, no coach ever confirms her, then the coach sends
  -- her the family code. She is already linked, so if the grant lived inside the "new link"
  -- branch she would present the stronger credential and still be told nothing happened.
  v_grant := not exists (
    select 1 from parent_player_links where player_id = p_id and can_manage_guardians
  );

  if v_grant then
    -- Recorded, not refused. See the header for why a coach is not blocked here.
    select exists (
      select 1 from player_teams pt
       where pt.player_id = p_id and pt.left_on is null
         and public.is_team_coach(pt.team_id)
    ) into v_self_coach;
    -- The OTHER adults already attached -- self excluded, so a self-upgrade never notifies the
    -- person who performed it. Captured before any write below.
    select coalesce(array_agg(parent_user_id) filter (where parent_user_id <> uid), '{}'::uuid[])
      into v_prior_guardians
      from parent_player_links where player_id = p_id;
  end if;

  if not v_already then
    select count(*) into n from parent_player_links where player_id = p_id;
    select exists (
      select 1 from player_guardian_seats
       where player_id = p_id and granted_to_user_id = uid and revoked_at is null
    ) into has_seat;
    if n >= 4 and not has_seat then
      raise exception 'This player already has the maximum of 4 guardians';
    end if;

    -- relationship mirrors the capability, exactly as coach_confirm_guardian_claim and
    -- grant_guardian_management do, and as revoke_guardian_management unwinds. It cannot produce
    -- a second relationship='parent' row because the grant only happens when no manager exists.
    insert into parent_player_links (parent_user_id, player_id, relationship, can_manage_guardians,
                                     verified_at, verified_by_user_id, verification_basis)
    values (uid, p_id,
            case when v_grant then 'parent' else 'guardian' end,
            v_grant,
            case when v_grant then now() end,
            case when v_grant then uid  end,
            case when v_grant then 'family_code' end);

    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );

  elsif v_grant then
    -- Already linked, nobody manages the child, and they have just presented the child-specific
    -- credential. Upgrade the existing row rather than refusing. coalesce() keeps any earlier
    -- verification provenance instead of overwriting it.
    update parent_player_links
       set can_manage_guardians = true,
           relationship         = 'parent',
           verified_at          = coalesce(verified_at, now()),
           verified_by_user_id  = coalesce(verified_by_user_id, uid),
           verification_basis   = coalesce(verification_basis, 'family_code')
     where player_id = p_id and parent_user_id = uid;
  end if;

  if v_grant then
    update players set identity_state = 'verified'
     where id = p_id and merged_into_id is null;

    -- ROTATE IN THE SAME TRANSACTION. Before D9 this function only stamped last_used_at, so a
    -- screenshot of the coach-issued code stayed a working family credential for the rest of
    -- its 90 days. Rotation kills it the instant the family takes over. The new manager sees
    -- the fresh code on the kid screen; the coach's read access has already lapsed, because a
    -- manager now exists.
    loop
      v_new_code := gen_join_code(8);
      exit when not exists (select 1 from player_guardian_codes where code = v_new_code);
    end loop;
    update player_guardian_codes
       set code = v_new_code, last_used_at = null, expires_at = now() + interval '90 days'
     where player_id = p_id;
  elsif not v_already then
    update player_guardian_codes set last_used_at = now() where player_id = p_id;
  end if;

  -- Audit only when something actually happened. An already-linked guardian re-entering a code
  -- on a child who already has a manager is a no-op, exactly as it was before D9.
  if v_grant or not v_already then
    insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
    values (uid, 'claim_or_link_guardian', uid, 'parent_player_links', p_id,
            jsonb_build_object('player_id', p_id,
                               'granted_management', v_grant,
                               'granted_to_existing_link', v_grant and v_already,
                               'rotated_code', v_grant,
                               'self_coach', v_grant and v_self_coach,
                               'prior_guardian_count', coalesce(array_length(v_prior_guardians, 1), 0)));
  end if;

  if v_grant then
    -- LOUD 1 — the child already had other guardians and nobody managed them, so this
    -- redemption just put one adult in charge of the others. They hear immediately, which is
    -- what makes the no-manager rule safe to be this permissive.
    if coalesce(array_length(v_prior_guardians, 1), 0) > 0 then
      -- Its own type, NOT the pre-existing 'guardian_management_granted': that one is emitted
      -- by grant_guardian_management, where the actor is the granter and the recipient is the
      -- grantee. Here the actor is the new manager and the recipients are the other guardians,
      -- so the same string would render backwards ("X gave you access" to people X did not
      -- give anything to).
      perform notify_users(v_prior_guardians, 'guardian_manager_established',
                           uid, p_id, null, 'player', p_id);
    end if;

    -- LOUD 2 — a coach of this child's team claimed the child themselves. This is the one
    -- single-account path by which a coach can become a manager, so every OTHER coach on the
    -- child's current teams is told. Allowed, never quiet.
    if v_self_coach then
      perform notify_users(
        array(select distinct tm.user_id
                from player_teams pt
                join team_memberships tm on tm.team_id = pt.team_id
               where pt.player_id = p_id and pt.left_on is null
                 and tm.status = 'confirmed' and tm.left_on is null
                 and tm.role in ('admin','head_coach','coach')
                 and tm.user_id <> uid),
        'guardian_self_claimed_by_coach', uid, p_id, null, 'player', p_id);
    end if;
  end if;
  -- NOTE: the pre-D9 'guardian_claim_awaiting_confirmation' notification is gone from THIS
  -- function, because it is now unreachable here by construction: v_grant is the negation of
  -- "a manager exists", so either we just granted (nothing left to confirm) or a manager
  -- already exists (likewise nothing to confirm). That notification remains live and
  -- load-bearing in claim_roster_spot, the team-code path, which this migration does not touch.

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt
   where pt.player_id = p_id and pt.left_on is null
  on conflict (team_id, user_id, role)
  do update set left_on = null, status = 'confirmed';

  perform public.record_code_attempt('claim_or_link_guardian', true);
  return p_id;
end $function$;

comment on function public.claim_or_link_guardian(text) is
  'Slice D9. Redeeming a CHILD-SPECIFIC family code links the adult, and makes them the child''s manager (verification_basis=''family_code'') iff nobody manages the child yet -- then rotates the code so the presented one dies. A coach of the child''s team is not blocked from this; it is tagged detail.self_coach and announced to the other coaches. The TEAM-code path (claim_roster_spot) is unchanged and still requires coach confirmation.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------------------
-- ROLLBACK — the three definitions exactly as they were before this migration.
-- ---------------------------------------------------------------------------------------------
--
-- drop policy if exists player_guardian_codes_read on public.player_guardian_codes;
-- create policy player_guardian_codes_read on public.player_guardian_codes
-- for select using (is_super_admin() OR is_linked_parent(player_id));
--
-- create or replace function public.regenerate_guardian_code(p_player_id uuid)
-- returns text language plpgsql security definer set search_path to 'public'
-- as $$
-- declare uid uuid := auth.uid(); c text;
-- begin
--   if uid is null then raise exception 'Not authenticated'; end if;
--   if not (is_linked_parent(p_player_id) or is_super_admin()) then
--     raise exception 'Only a guardian can reset this code';
--   end if;
--   loop c := gen_join_code(8); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
--   update player_guardian_codes
--      set code = c, last_used_at = null, expires_at = now() + interval '90 days'
--    where player_id = p_player_id;
--   if not found then
--     insert into player_guardian_codes (player_id, code) values (p_player_id, c);
--   end if;
--   insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
--   values (uid, 'regenerate_guardian_code', 'players', p_player_id, jsonb_build_object('player_id', p_player_id));
--   return c;
-- end $$;
--
-- create or replace function public.claim_or_link_guardian(p_code text)
-- returns uuid language plpgsql security definer set search_path to 'public'
-- as $$
-- declare uid uuid := auth.uid(); p_id uuid; n int; has_seat boolean;
-- begin
--   if uid is null then raise exception 'Not authenticated'; end if;
--   perform public.code_attempt_guard('claim_or_link_guardian');
--   select player_id into p_id from player_guardian_codes
--    where code = upper(trim(p_code)) and (expires_at is null or expires_at > now());
--   if p_id is null then raise exception 'Invalid code'; end if;
--   perform 1 from players where id = p_id for update;
--   if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
--     select count(*) into n from parent_player_links where player_id = p_id;
--     select exists (select 1 from player_guardian_seats
--                     where player_id = p_id and granted_to_user_id = uid and revoked_at is null) into has_seat;
--     if n >= 4 and not has_seat then
--       raise exception 'This player already has the maximum of 4 guardians';
--     end if;
--     insert into parent_player_links (parent_user_id, player_id, relationship, can_manage_guardians)
--     values (uid, p_id, 'guardian', false);
--     update player_guardian_codes set last_used_at = now() where player_id = p_id;
--     perform notify_users(
--       array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
--       'guardian_joined', uid, p_id, null, 'player', p_id);
--     insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
--     values (uid, 'claim_or_link_guardian', uid, 'parent_player_links', p_id,
--             jsonb_build_object('player_id', p_id, 'granted_management', false));
--     if not exists (select 1 from parent_player_links
--                     where player_id = p_id and can_manage_guardians) then
--       perform notify_users(
--         array(select distinct tm.user_id from player_teams pt
--                 join team_memberships tm on tm.team_id = pt.team_id
--                where pt.player_id = p_id and pt.left_on is null
--                  and tm.status = 'confirmed' and tm.role in ('admin','head_coach','coach')),
--         'guardian_claim_awaiting_confirmation', uid, p_id, null, 'player', p_id);
--     end if;
--   end if;
--   insert into team_memberships (team_id, user_id, role, status)
--   select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt
--    where pt.player_id = p_id and pt.left_on is null
--   on conflict (team_id, user_id, role)
--   do update set left_on = null, status = 'confirmed';
--   perform public.record_code_attempt('claim_or_link_guardian', true);
--   return p_id;
-- end $$;
