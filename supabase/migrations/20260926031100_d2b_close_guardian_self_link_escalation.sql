-- ============================================================================
-- Slice D2b — CRITICAL: CLOSE THE GUARDIAN SELF-LINK ESCALATION
--
-- FOUND BY THIS SLICE'S OWN ADVERSARIAL AUDIT (test_d_identity_security.sql, check A15).
-- Severity: critical. Child-safety. PRE-EXISTING, not introduced by Slice D -- it is the
-- shape C.5 left parent_player_links in when it closed F14 -- but Slice D is where it surfaced
-- and Slice D's entire authority model rests on the column it exposes.
--
-- THE CHAIN, reproduced end to end against the local database:
--
--   policy parent_player_links_insert  = is_super_admin() OR parent_user_id = auth.uid()
--   policy parent_player_links_update  = is_super_admin() OR parent_user_id = auth.uid()
--   policy parent_player_links_delete  = is_super_admin() OR parent_user_id = auth.uid()
--
--   C.5 tightened these from "a coach of players.team_id, with an ARBITRARY parent_user_id"
--   to "your own row", which correctly stopped a coach handing access to someone else. But
--   "your own row" has NO predicate tying the caller to the CHILD. So:
--
--   STEP 1  any authenticated user POSTs to /rest/v1/parent_player_links with
--             { parent_user_id: <themselves>, player_id: <any child's uuid> }
--           and is instantly a guardian. No code. No invitation. No coach. No team.
--           is_linked_parent() then returns TRUE, which grants family-level access to that
--           child's film, wall, share inbox, guardian list and profile.   -> VERIFIED ALLOWED
--
--   STEP 2  they PATCH their own row setting can_manage_guardians = true, because RLS is
--           row-level and cannot protect a single column. That is the Slice D2 authority
--           primitive, and is_primary_guardian() (read by the live shares_read policy) then
--           returns TRUE for them.                                        -> VERIFIED ALLOWED
--
--   STEP 3  eviction of the real parent was blocked, but ONLY by D2's new "a manager may not
--           remove another manager" rule. They remain a full co-manager of the child and can
--           remove any non-managing guardian.                             -> VERIFIED BLOCKED
--
--   A player uuid is not a secret: it appears in roster reads for every team member, and any
--   coach can read every child on their team. So step 1's input is readily available.
--
-- THE FIX — guardian links become DEFINER-ONLY
--   There is no legitimate client write to this table. Verified by grep: the ONE client
--   reference is a SELECT for guardian counts (app/(tabs)/roster.tsx:101). Every legitimate
--   insert already goes through a SECURITY DEFINER RPC that checks a secret or a relationship:
--       create_kid                -> you created the child
--       claim_roster_spot         -> you produced the team's join code
--       claim_or_link_guardian    -> you produced that child's guardian code
--   and every legitimate removal goes through remove_guardian / admin_remove_guardian, which
--   enforce the "never strand a family without a manager" rule that a direct DELETE bypasses.
--
--   So INSERT / UPDATE / DELETE become super-admin-only. Definer functions run as the table
--   owner and are unaffected. This does not weaken C.5 -- it strictly tightens the same three
--   policies C.5 narrowed.
--
-- BUILD 68 COMPATIBILITY: no client call path writes this table, so nothing breaks. The
-- guardian-count SELECT is untouched.
-- ============================================================================

drop policy if exists parent_player_links_insert on public.parent_player_links;
create policy parent_player_links_insert on public.parent_player_links
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists parent_player_links_update on public.parent_player_links;
create policy parent_player_links_update on public.parent_player_links
  for update to authenticated
  using (public.is_super_admin());

drop policy if exists parent_player_links_delete on public.parent_player_links;
create policy parent_player_links_delete on public.parent_player_links
  for delete to authenticated
  using (public.is_super_admin());

comment on table public.parent_player_links is
  'Guardian <-> child links. WRITES ARE DEFINER-ONLY (Slice D2b): a direct client INSERT let any authenticated user attach themselves as guardian to ANY child with no code, and a direct UPDATE let them self-grant can_manage_guardians. Create links via create_kid / claim_roster_spot / claim_or_link_guardian; remove via remove_guardian / admin_remove_guardian; change authority via grant_guardian_management / coach_confirm_guardian_claim / admin_set_primary_guardian.';

-- ----------------------------------------------------------------------------
-- BELT AND BRACES: a trigger, so the authority columns cannot be written from a client role
-- even if a future migration loosens the policies again.
--
-- SECURITY DEFINER functions execute as the table owner, so current_user is the owner there
-- and the legitimate RPCs pass straight through. A direct PostgREST write arrives as
-- `authenticated` / `anon` and is rejected.
-- ----------------------------------------------------------------------------
create or replace function public.guard_guardian_link_authority()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      raise exception 'Guardian links cannot be created directly. Use the claim flow (a team code or the child''s guardian code).'
        using errcode = 'insufficient_privilege';
    end if;
    if new.can_manage_guardians is distinct from old.can_manage_guardians
       or new.verified_at        is distinct from old.verified_at
       or new.verified_by_user_id is distinct from old.verified_by_user_id
       or new.verification_basis  is distinct from old.verification_basis
       or new.relationship        is distinct from old.relationship
       or new.player_id           is distinct from old.player_id
       or new.parent_user_id      is distinct from old.parent_user_id then
      raise exception 'Guardian authority cannot be changed directly. It is granted by an existing manager, a coach confirmation, or IamSports support.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_guard_guardian_link_authority on public.parent_player_links;
create trigger trg_guard_guardian_link_authority
  before insert or update on public.parent_player_links
  for each row execute function public.guard_guardian_link_authority();

-- ----------------------------------------------------------------------------
-- The ONE field a family legitimately owns on their own link row, exposed narrowly so that
-- nobody has to reopen the table to ship a notification preference later.
-- ----------------------------------------------------------------------------
create or replace function public.set_logistics_alerts(p_player_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update parent_player_links
     set receives_logistics_alerts = coalesce(p_enabled, true)
   where player_id = p_player_id and parent_user_id = uid;
  if not found then
    raise exception 'You are not a guardian of this player';
  end if;
end $function$;

grant execute on function public.set_logistics_alerts(uuid, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
