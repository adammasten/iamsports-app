-- C.5 step 2 (Adam, 2026-09-25): close F14. Coach status must never by itself grant
-- raw mutation authority over guardianship.
--
-- ARCHITECTURE RULE THIS ENFORCES
--   team membership  ≠  child guardianship  ≠  child identity
--
-- THE HOLE
--   parent_player_links_insert WITH CHECK was:
--     is_super_admin() OR EXISTS (select 1 from players p
--                                 where p.id = player_id and is_team_coach(p.team_id))
--   There was NO requirement that parent_user_id = auth.uid(). A coach of the child's
--   legacy team could therefore insert a guardian link for ANY user id, granting that
--   account permanent parent-level access to that child — film, clips, photo, the kid's
--   wall, guardian codes, notifications. UPDATE and DELETE carried the same coach
--   branch, so a coach could also re-point or remove a family's link.
--
-- WHY THIS IS COMPATIBILITY-SAFE (verified)
--   Every function that writes parent_player_links is SECURITY DEFINER, which bypasses
--   RLS entirely:
--       create_kid, claim_roster_spot, claim_or_link_guardian, remove_guardian, merge_players
--   and NO client code writes the table directly (grepped across app/, lib/,
--   components/, hooks/, context.tsx — zero .insert/.update/.delete/.upsert).
--   So removing the coach branches cannot break any RPC or any installed build.
--
--   One read-path consequence, handled: roster.tsx reads this table for guardian
--   COUNTS. The read policy keeps a coach branch for now so that count keeps working
--   on builds <= 66; tightening the read to a counts-only RPC is Slice C's work, not
--   C.5's. C.5 closes the *mutation* hole, which is the escalation link.

-- INSERT: you may only ever create a link for YOURSELF. Everything else goes through
-- a SECURITY DEFINER RPC that applies its own rules (guardian codes, the 4-guardian
-- cap, paid seats), or through super-admin repair.
drop policy if exists parent_player_links_insert on public.parent_player_links;
create policy parent_player_links_insert on public.parent_player_links
  for insert
  with check (
    public.is_super_admin()
    or parent_user_id = (select auth.uid())
  );

-- UPDATE: your own row only (e.g. receives_logistics_alerts), or super admin.
-- Coach branch removed.
drop policy if exists parent_player_links_update on public.parent_player_links;
create policy parent_player_links_update on public.parent_player_links
  for update
  using (
    public.is_super_admin()
    or parent_user_id = (select auth.uid())
  )
  with check (
    public.is_super_admin()
    or parent_user_id = (select auth.uid())
  );

-- DELETE: self-unlink only, or super admin. Removing ANOTHER guardian stays in
-- remove_guardian() (primary-guardian rules) or the new admin recovery RPCs.
-- Coach branch removed.
drop policy if exists parent_player_links_delete on public.parent_player_links;
create policy parent_player_links_delete on public.parent_player_links
  for delete
  using (
    public.is_super_admin()
    or parent_user_id = (select auth.uid())
  );

notify pgrst, 'reload schema';
