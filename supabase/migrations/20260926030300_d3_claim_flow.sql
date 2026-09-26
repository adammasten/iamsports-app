-- ============================================================================
-- Slice D3 — CLAIM FLOW REWORK: existing child first, idempotent, claim != authority
--
-- THE INVERSION BEING FIXED
--   Today join-team.tsx offers "pick a roster spot" or "add a new player", and
--   claim_roster_spot makes the FIRST adult to type a team code the child's permanent
--   primary guardian. A parent whose child is already in IamSports is nudged toward
--   creating a SECOND child record, and whoever gets there first owns the child.
--
-- WHAT THIS MIGRATION PROVIDES (the client wiring is in the same slice, app/join-team.tsx)
--   1. my_claimable_children()          — the caller's existing children, offered FIRST,
--                                         unconditionally, never gated on name similarity.
--   2. create_kid(p_name, p_request_id) — idempotent. A double-tap, a retry after a timeout
--                                         and a resubmit all collapse onto ONE child.
--   3. create_kid_and_join_team(...)    — ONE transaction, replacing the client's two
--                                         sequential RPCs, which could orphan a child if the
--                                         second call failed.
--   4. create_roster_placeholder(..., p_request_id) — same idempotency for the coach side.
--   5. claim_existing_child_for_roster_spot(...) — "this IS my child": links the family to
--                                         the roster spot and, when the family already has a
--                                         separate record for that child, routes the
--                                         consolidation through D1's reconcile_players under
--                                         authority-matrix case 3. Never creates a duplicate.
--   6. claim_roster_spot / claim_or_link_guardian — a code now authorises ENTRY only. The
--                                         claimant is linked as claimed_unverified with NO
--                                         management capability.
--
-- BUILD 68 COMPATIBILITY
--   Every existing signature is preserved and keeps working: create_kid(name),
--   create_roster_placeholder(p_team_id, p_name, p_jersey), claim_roster_spot(p_code,
--   p_player_id), claim_or_link_guardian(p_code), join_team_with_code(p_code, p_player_id).
--   New capability is added as NEW overloads/functions, never by changing an old one's shape.
--   The one deliberate semantic change is D2's: claiming no longer confers authority.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXISTING CHILDREN, OFFERED FIRST
--    Deliberately returns the caller's children with no name filtering of any kind: names are
--    a discovery signal, never identity, and a parent knows their own child on sight.
-- ----------------------------------------------------------------------------
create or replace function public.my_claimable_children()
returns table (
  player_id     uuid,
  name          text,
  photo_path    text,
  grad_class    text,
  identity_state text,
  i_manage      boolean,
  teams         jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.name, p.photo_path, p.grad_class, p.identity_state,
         l.can_manage_guardians,
         coalesce((
           select jsonb_agg(jsonb_build_object('team_id', pt.team_id, 'team_name', t.name)
                            order by t.name)
           from player_teams pt left join teams t on t.id = pt.team_id
           where pt.player_id = p.id and pt.left_on is null
         ), '[]'::jsonb)
    from parent_player_links l
    join players p on p.id = l.player_id
   where l.parent_user_id = auth.uid()
     and p.merged_into_id is null
   order by p.name;
$function$;

comment on function public.my_claimable_children() is
  'The caller''s existing children, for the existing-child-first claim interstitial (Slice D3 / plan v2 §11). No name matching: a parent recognises their own child, and names are never identity.';

grant execute on function public.my_claimable_children() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. IDEMPOTENT CHILD CREATION
--    The creator of a child IS the originating family authority, so they -- and only in this
--    one case -- receive can_manage_guardians immediately. There is no coach and no prior
--    manager to corroborate against, and refusing here would leave a family unable to manage
--    a child they created.
-- ----------------------------------------------------------------------------
create or replace function public.create_kid(p_name text, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid        uuid := auth.uid();
  clean_name text := trim(coalesce(p_name, ''));
  new_id     uuid;
  c          text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if clean_name = '' then raise exception 'Kid name is required'; end if;

  -- Idempotency, scoped to the creating user so a caller cannot probe someone else's
  -- request id and be handed back a player_id they have no business seeing.
  if p_request_id is not null then
    select id into new_id from players
     where created_by_user_id = uid and creation_request_id = p_request_id;
    if new_id is not null then return new_id; end if;
  end if;

  insert into players (name, team_id, created_by_user_id, creation_request_id, identity_state)
  values (clean_name, null, uid, p_request_id, 'verified')
  returning id into new_id;

  insert into parent_player_links (parent_user_id, player_id, relationship,
                                   can_manage_guardians, verified_at, verified_by_user_id,
                                   verification_basis)
  values (uid, new_id, 'parent', true, now(), uid, 'created_by_this_guardian');

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return new_id;
exception
  -- Lost a race with a concurrent identical request: return the row the winner created.
  when unique_violation then
    if p_request_id is not null then
      select id into new_id from players
       where created_by_user_id = uid and creation_request_id = p_request_id;
      if new_id is not null then return new_id; end if;
    end if;
    raise;
end $function$;

comment on function public.create_kid(text, uuid) is
  'Idempotent child creation (Slice D3 / plan v2 §3.1). Same (caller, request_id) returns the same child instead of creating another. The creator receives guardian-management authority: they are the originating family and there is nobody else to corroborate against.';

grant execute on function public.create_kid(text, uuid) to authenticated, service_role;

-- The legacy one-argument signature keeps working for installed builds. It generates its own
-- request id, so it is exactly as non-idempotent as today -- not worse -- and it now also
-- grants the creator management authority, matching the new overload.
create or replace function public.create_kid(name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.create_kid(name, gen_random_uuid());
end $function$;

comment on function public.create_kid(text) is
  'DEPRECATED shim for installed builds (Slice D3). Forwards to create_kid(text, uuid) with a server-generated request id, so it is non-idempotent exactly as before. New clients pass their own request id.';

-- ----------------------------------------------------------------------------
-- 3. ONE TRANSACTION FOR "ADD MY CHILD AND JOIN THIS TEAM"
--    join-team.tsx called create_kid then join_team_with_code as two RPCs; a failure between
--    them left a child attached to nothing and no way for the parent to tell.
-- ----------------------------------------------------------------------------
create or replace function public.create_kid_and_join_team(
  p_name text, p_code text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); v_player uuid; v_team uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select id into v_team from teams
   where join_code = upper(trim(p_code))
     and (join_code_expires_at is null or join_code_expires_at > now());
  if v_team is null then raise exception 'Invalid team code'; end if;

  v_player := public.create_kid(p_name, p_request_id);

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (v_player, v_team, uid)
  on conflict (player_id, team_id) where left_on is null do nothing;

  insert into team_memberships (team_id, user_id, role, status)
  values (v_team, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do update set left_on = null, status = 'confirmed';

  return jsonb_build_object('player_id', v_player, 'team_id', v_team);
end $function$;

grant execute on function public.create_kid_and_join_team(text, text, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. IDEMPOTENT ROSTER PLACEHOLDER (coach side)
--    A coach double-tapping "Add player" made two roster slots, which is one of the ways the
--    real duplicates got created in the first place.
-- ----------------------------------------------------------------------------
-- NOTE: p_jersey and p_request_id carry NO DEFAULTS here on purpose. With defaults, a
-- three-argument call would match BOTH this function and the legacy three-argument signature
-- below, and Postgres would reject it as "function is not unique" -- breaking every Build 68
-- "Add player" tap. The legacy shape is preserved as its own explicit function instead.
create or replace function public.create_roster_placeholder(
  p_team_id uuid, p_name text, p_jersey text, p_request_id uuid)
returns table(player_id uuid, guardian_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare uid uuid := auth.uid(); new_id uuid; c text; v_name text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can add roster spots'; end if;

  if p_request_id is not null then
    select p.id, g.code into new_id, c
      from players p left join player_guardian_codes g on g.player_id = p.id
     where p.created_by_user_id = uid and p.creation_request_id = p_request_id;
    if new_id is not null then
      return query select new_id, c;
      return;
    end if;
  end if;

  v_name := coalesce(nullif(trim(p_name), ''), '#' || nullif(trim(p_jersey), ''));
  if v_name is null then raise exception 'A name or jersey number is required'; end if;

  insert into players (name, team_id, jersey_number, created_by_user_id, creation_request_id,
                       identity_state)
  values (v_name, p_team_id, nullif(trim(p_jersey), ''), uid, p_request_id, 'provisional')
  returning id into new_id;

  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (new_id, p_team_id, nullif(trim(p_jersey), ''), uid)
  on conflict (player_id, team_id) where left_on is null do nothing;

  loop c := gen_join_code(8); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return query select new_id, c;
end $function$;

-- Keep the exact 3-argument shape Build 68 calls. (A DEFAULT on the 4th parameter would make
-- create_roster_placeholder(uuid,text,text) ambiguous with this legacy signature, so the
-- legacy form is defined explicitly as its own function that forwards.)
drop function if exists public.create_roster_placeholder(uuid, text, text);
create or replace function public.create_roster_placeholder(
  p_team_id uuid, p_name text, p_jersey text)
returns table(player_id uuid, guardian_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query select * from public.create_roster_placeholder(p_team_id, p_name, p_jersey, null::uuid);
end $function$;

grant execute on function public.create_roster_placeholder(uuid, text, text) to authenticated, service_role;
grant execute on function public.create_roster_placeholder(uuid, text, text, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. "THIS IS MY EXISTING CHILD" — the heart of the inversion fix
--
--    The parent has a team code and is looking at a coach-created roster spot. Instead of
--    creating a second child, they pick the child they already have. Two cases:
--
--      a) the roster spot is UNCLAIMED -> link the family to it and, because the family
--         already holds a separate record for the same human, consolidate the two through
--         reconcile_players under authority-matrix case 3 (the team code IS the coach-side
--         authorization, exactly as claim_roster_spot already relies on it).
--      b) the roster spot is ALREADY the same player -> no-op, idempotent.
--
--    Nothing is destroyed: the coach-created record is tombstoned, and every clip, tag,
--    lineup, stat and spell it carried moves onto the family's child.
-- ----------------------------------------------------------------------------
create or replace function public.claim_existing_child_for_roster_spot(
  p_code             text,
  p_roster_player_id uuid,
  p_existing_player_id uuid,
  p_request_id       uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  v_team uuid;
  v_result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('claim_existing_child_for_roster_spot');

  select id into v_team from teams
   where join_code = upper(trim(p_code))
     and (join_code_expires_at is null or join_code_expires_at > now());
  if v_team is null then
    perform public.record_code_attempt('claim_existing_child_for_roster_spot', false);
    raise exception 'Invalid team code';
  end if;

  if not exists (select 1 from parent_player_links
                  where parent_user_id = uid and player_id = p_existing_player_id) then
    raise exception 'That is not one of your children';
  end if;

  -- IDEMPOTENCY IS CHECKED FIRST, BEFORE the roster-membership test. A successful
  -- consolidation MOVES the roster spot's spell onto the family's child, so the retired id no
  -- longer has a spell on the team -- meaning a retry (network drop, double tap) would fail the
  -- membership test and surface "That player is not on this team" even though the merge had
  -- already succeeded. Resolving the identity first makes the retry a clean no-op.
  if p_roster_player_id = p_existing_player_id
     or public.resolve_player_id(p_roster_player_id) = p_existing_player_id then
    insert into team_memberships (team_id, user_id, role, status)
    values (v_team, uid, 'parent', 'confirmed')
    on conflict (team_id, user_id, role) do update set left_on = null, status = 'confirmed';
    perform public.record_code_attempt('claim_existing_child_for_roster_spot', true);
    return jsonb_build_object('status','already_linked','player_id', p_existing_player_id);
  end if;

  if not exists (select 1 from player_teams
                  where team_id = v_team and player_id = p_roster_player_id and left_on is null) then
    raise exception 'That player is not on this team';
  end if;


  -- Consolidate the coach's record INTO the family's child. reconcile_players re-checks
  -- authority itself (case 3) and refuses if the roster spot turns out to belong to another
  -- family, so this wrapper cannot be used to absorb someone else's child.
  v_result := public.reconcile_players(
    p_keep            => p_existing_player_id,
    p_retire          => p_roster_player_id,
    p_request_id      => p_request_id,
    p_dry_run         => false,
    p_claim_team_code => p_code,
    p_acknowledge_conflicts => true);

  insert into team_memberships (team_id, user_id, role, status)
  values (v_team, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do update set left_on = null, status = 'confirmed';

  perform public.record_code_attempt('claim_existing_child_for_roster_spot', true);
  return jsonb_build_object('status','reconciled', 'player_id', p_existing_player_id,
                            'reconciliation', v_result);
end $function$;

revoke execute on function public.claim_existing_child_for_roster_spot(text, uuid, uuid, uuid) from public, anon;
grant  execute on function public.claim_existing_child_for_roster_spot(text, uuid, uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. A CODE AUTHORISES ENTRY, NOT AUTHORITY
--    Both claim paths keep their signatures and their C.5 throttling. The only change is
--    that the claimant is no longer promoted to the child's manager by arriving first.
-- ----------------------------------------------------------------------------
create or replace function public.claim_roster_spot(p_code text, p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('claim_roster_spot');

  select id into t_id from teams
   where join_code = upper(trim(p_code))
     and (join_code_expires_at is null or join_code_expires_at > now());
  if t_id is null then raise exception 'Invalid team code'; end if;
  if not exists (select 1 from player_teams
                  where team_id = t_id and player_id = p_player_id and left_on is null) then
    raise exception 'That player is not on this team';
  end if;

  perform 1 from players where id = p_player_id for update;

  if exists (select 1 from parent_player_links where player_id = p_player_id) then
    raise exception 'This player is already claimed — ask their family for their invite code to be added.';
  end if;

  -- D2/D3: linked, but NOT the child's manager. A team code is a shared secret that a whole
  -- team holds; it cannot be the thing that hands one adult permanent authority over a child.
  -- Authority arrives via coach_confirm_guardian_claim, an existing manager, or support.
  insert into parent_player_links (parent_user_id, player_id, relationship, can_manage_guardians)
  values (uid, p_player_id, 'guardian', false);

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;

  perform public.record_code_attempt('claim_roster_spot', true);
  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'claim_roster_spot', uid, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'team_id', t_id,
                             'granted_management', false));

  -- Tell the coaches of that team that someone claimed the spot, so confirmation is a
  -- prompt rather than something a coach has to go looking for.
  perform notify_users(
    array(select tm.user_id from team_memberships tm
           where tm.team_id = t_id and tm.status = 'confirmed'
             and tm.role in ('admin','head_coach','coach')),
    'guardian_claim_awaiting_confirmation', uid, p_player_id, t_id, 'player', p_player_id);

  return p_player_id;
end $function$;

create or replace function public.claim_or_link_guardian(p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); p_id uuid; n int; has_seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.code_attempt_guard('claim_or_link_guardian');

  select player_id into p_id from player_guardian_codes
   where code = upper(trim(p_code)) and (expires_at is null or expires_at > now());
  if p_id is null then raise exception 'Invalid code'; end if;

  perform 1 from players where id = p_id for update;

  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
    select count(*) into n from parent_player_links where player_id = p_id;
    select exists (
      select 1 from player_guardian_seats
       where player_id = p_id and granted_to_user_id = uid and revoked_at is null
    ) into has_seat;
    if n >= 4 and not has_seat then
      raise exception 'This player already has the maximum of 4 guardians';
    end if;

    -- D2/D3: entry only. Arrival order no longer decides who controls the child.
    insert into parent_player_links (parent_user_id, player_id, relationship, can_manage_guardians)
    values (uid, p_id, 'guardian', false);

    update player_guardian_codes set last_used_at = now() where player_id = p_id;
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );
    insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
    values (uid, 'claim_or_link_guardian', uid, 'parent_player_links', p_id,
            jsonb_build_object('player_id', p_id, 'granted_management', false));

    -- If nobody manages this child yet, ask that team's coaches to confirm the claimant.
    if not exists (select 1 from parent_player_links
                    where player_id = p_id and can_manage_guardians) then
      perform notify_users(
        array(select distinct tm.user_id from player_teams pt
                join team_memberships tm on tm.team_id = pt.team_id
               where pt.player_id = p_id and pt.left_on is null
                 and tm.status = 'confirmed' and tm.role in ('admin','head_coach','coach')),
        'guardian_claim_awaiting_confirmation', uid, p_id, null, 'player', p_id);
    end if;
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt
   where pt.player_id = p_id and pt.left_on is null
  on conflict (team_id, user_id, role)
  do update set left_on = null, status = 'confirmed';

  perform public.record_code_attempt('claim_or_link_guardian', true);
  return p_id;
end $function$;

notify pgrst, 'reload schema';
