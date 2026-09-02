-- Close the kid-login doors (applied live 2026-09-02).
-- Kids are never app users (adult-only / Hudl model; guardians act for them). This
-- removes every RLS branch that granted access via a kid's OWN account and drops the
-- now-unused players.user_id column, so a kid can no longer be attached to an auth
-- account at all — by bug or by future code. Defense-in-depth before families onboard.
--
-- Verified before applying: 0 players had a user_id (no kid accounts), no app code
-- reads/writes players.user_id, and no function/view/matview depends on it. Only three
-- RLS policies referenced it (att_write, players_read, install_receipts_read); each
-- keeps its legitimate branches (coach / guardian / team member / super-admin / own).
-- The `player` membership_role remains in the enum but is RESERVED + UNUSED (0 holders,
-- no RLS grants through it) — documented so nobody wires it later.

alter policy att_write on public.event_attendance
  using (
    exists (select 1 from events e where e.id = event_attendance.event_id and is_team_coach(e.team_id))
    or exists (select 1 from parent_player_links ppl where ppl.player_id = event_attendance.player_id and ppl.parent_user_id = effective_user_id())
  )
  with check (
    exists (select 1 from events e where e.id = event_attendance.event_id and is_team_coach(e.team_id))
    or exists (select 1 from parent_player_links ppl where ppl.player_id = event_attendance.player_id and ppl.parent_user_id = effective_user_id())
  );

alter policy players_read on public.players
  using (
    is_super_admin() or is_team_member(team_id) or is_linked_parent(id)
  );

alter policy install_receipts_read on public.install_receipts
  using (
    is_super_admin()
    or (user_id = auth.uid())
    or exists (select 1 from installs i where i.id = install_receipts.install_id and is_team_coach(i.team_id))
  );

alter table public.players drop column if exists user_id;

comment on type membership_role is 'admin/head_coach/coach/parent/follower are live. player is RESERVED and UNUSED - kids are not app users; never grant access via it.';
