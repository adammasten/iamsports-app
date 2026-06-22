-- ============================================================
-- post_to_wall — widen the permission gate for INBOX SENDS ONLY (audience='player').
--
-- Until now post_to_wall allowed exactly one set of senders for EVERY audience:
-- super-admin OR a linked parent of the target player. That single audience-
-- agnostic check (migration_post_to_wall_team.sql lines 75-81) is too tight for
-- inbox sends — a coach or teammate on the player's team should be able to send
-- content to that player's inbox, not just the player's parent.
--
-- This recreates the SAME 5-arg post_to_wall verbatim EXCEPT the permission
-- block, which is split by audience:
--   * p_audience = 'player'  (inbox send)  → WIDENED to exactly: super-admin, OR
--       linked parent of the player, OR a confirmed COACH/ADMIN of a team the
--       player is on (is_team_coach → role in admin/head_coach/coach), OR a
--       confirmed TEAMMATE (role = 'player') on a team the player is on. This
--       deliberately EXCLUDES follower and parent-role memberships — a follower
--       must NOT be able to send to a minor's inbox. Scoped through the
--       player_teams junction to teams THIS player actually belongs to.
--   * everything else (public/team/coaches → wall posts) → UNCHANGED: super-admin
--       OR linked parent only.
--
-- The team-validation block, get-or-create, insert, return, and the function
-- signature are all unchanged. Same 5-arg signature ⇒ a plain CREATE OR REPLACE
-- (no DROP needed) and no app changes.
--
-- Depends on: shares, parent_player_links, player_teams, team_memberships,
--   is_super_admin() (migration_rls_helpers), is_team_coach()
--   (migration_rls_lockdown_3_clips), enums share_content / share_audience.
--
-- Idempotent: safe to re-run (CREATE OR REPLACE; grants re-applied).
-- ============================================================

create or replace function post_to_wall(
  p_content_type     share_content,
  p_content_id       uuid,
  p_audience         share_audience,
  p_target_player_id uuid,
  p_team_id          uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_audience = 'player' then
    -- INBOX SEND — widened. Allowed senders to a player's inbox:
    --   super-admin, OR linked parent of the player, OR a confirmed COACH/ADMIN
    --   (is_team_coach → admin/head_coach/coach) of a team the player is on, OR a
    --   confirmed player-role TEAMMATE of a team the player is on. Followers and
    --   other parent-role members are NOT allowed. Coach/teammate is gated through
    --   the player_teams junction so it's scoped to teams THIS player belongs to.
    if not (
      is_super_admin()
      or exists (
        select 1 from parent_player_links ppl
        where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid
      )
      -- coach/admin of a team the player is on
      or exists (
        select 1 from player_teams pt
        where pt.player_id = p_target_player_id
          and is_team_coach(pt.team_id)
      )
      -- confirmed teammate (player-role) on a team the player is on
      or exists (
        select 1 from player_teams pt
        join team_memberships tm on tm.team_id = pt.team_id
        where pt.player_id = p_target_player_id
          and tm.user_id = uid
          and tm.status = 'confirmed'
          and tm.role = 'player'
      )
    ) then
      raise exception 'Not allowed: cannot send to this player''s inbox';
    end if;
  else
    -- WALL POSTS (public/team/coaches) — UNCHANGED. Parent or super-admin only.
    if not is_super_admin() and not exists (
      select 1 from parent_player_links ppl
      where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid
    ) then
      raise exception 'Not allowed: not a linked parent of this player';
    end if;
  end if;

  -- A 'team' post must name a team the kid is actually on.
  if p_audience = 'team' then
    if p_team_id is null then
      raise exception 'A team is required to post to a team audience';
    end if;
    if not exists (
      select 1 from player_teams pt
      where pt.player_id = p_target_player_id
        and pt.team_id   = p_team_id
    ) then
      raise exception 'Player is not on the specified team';
    end if;
  end if;

  -- Get-or-create THIS caller's own wall row, keyed on team_id too so a team
  -- post and a public post of the same content are distinct rows.
  select id into new_id
  from shares
  where content_type      = p_content_type
    and content_id        = p_content_id
    and audience          = p_audience
    and target_player_id  = p_target_player_id
    and shared_by_user_id = uid
    and team_id is not distinct from p_team_id;
  if new_id is not null then
    return new_id;
  end if;

  insert into shares (content_type, content_id, audience, target_player_id, shared_by_user_id, team_id)
  values (p_content_type, p_content_id, p_audience, p_target_player_id, uid, p_team_id)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function post_to_wall(share_content, uuid, share_audience, uuid, uuid) from public, anon;
grant execute on function post_to_wall(share_content, uuid, share_audience, uuid, uuid) to authenticated;

-- Schema cache trap — force PostgREST to reload (see CLAUDE.md).
notify pgrst, 'reload schema';
