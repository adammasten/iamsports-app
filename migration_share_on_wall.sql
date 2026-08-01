-- migration_share_on_wall.sql
--
-- Option A — a single `on_wall` flag replaces the guardian-authored-duplicate-row
-- model for a kid's wall. A player-audience share to a kid is now either:
--   on_wall = false  -> in the family's "Shared with you" (awaiting their choice)
--   on_wall = true   -> on the kid's wall (visible to EVERY linked guardian)
--
-- Rules:
--  * A guardian's OWN share to their kid goes straight on the wall (they control
--    the account) -> on_wall = true at insert.
--  * A coach's (or any non-guardian's) share to the kid lands off-wall
--    (on_wall = false) in "Shared with you" until a guardian flips it.
--  * No duplicate rows: putting-on / taking-off the wall flips the flag on the
--    SAME share row, and the note rides that one row -> every guardian sees the
--    same wall and the same note.
--  * Only a linked guardian of the target kid (or super admin) may change the
--    wall — a coach can share TO a kid but can never place content on the wall.
--
-- Family-wide read already works: shares_read grants the 'player' branch to any
-- linked parent of target_player_id, so no RLS change is needed here.

alter table shares add column if not exists on_wall boolean not null default false;

-- Backfill: preserve today's walls. Under the OLD model a wall post was a
-- player-audience share authored by a linked guardian of the target kid.
update shares s
set on_wall = true
where s.audience = 'player'
  and s.target_player_id is not null
  and exists (
    select 1 from parent_player_links ppl
    where ppl.player_id = s.target_player_id
      and ppl.parent_user_id = s.shared_by_user_id
  );

-- post_to_wall: unchanged permission gates; the only change is the INSERT now
-- stamps on_wall for player-audience posts (guardian -> wall, other -> inbox).
create or replace function public.post_to_wall(p_content_type share_content, p_content_id uuid, p_audience share_audience, p_target_player_id uuid, p_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  new_id uuid;
  team_scoped boolean := (p_target_player_id is null);
  goes_on_wall boolean := false;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_audience = 'player' then
    if p_target_player_id is null then
      raise exception 'A target player is required for an inbox send';
    end if;
    if not (
      is_super_admin()
      or exists (select 1 from parent_player_links ppl
                 where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid)
      or exists (select 1 from player_teams pt
                 where pt.player_id = p_target_player_id and is_team_coach(pt.team_id))
      or exists (select 1 from player_teams pt
                 join team_memberships tm on tm.team_id = pt.team_id
                 where pt.player_id = p_target_player_id
                   and tm.user_id = uid and tm.status = 'confirmed' and tm.role = 'player')
    ) then
      raise exception 'Not allowed: cannot send to this player''s inbox';
    end if;

    -- A guardian's own post goes straight on the wall; anyone else's waits in
    -- the family's "Shared with you" until a guardian puts it up.
    goes_on_wall := is_super_admin()
      or exists (select 1 from parent_player_links ppl
                 where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid);

  elsif p_audience = 'coaches' then
    if p_team_id is null then
      raise exception 'A team is required to post to the coaches board';
    end if;
    if p_target_player_id is not null then
      raise exception 'Coaches board posts are team-scoped and cannot target a player';
    end if;
    if not (is_super_admin() or is_team_coach(p_team_id)) then
      raise exception 'Not allowed: not a coach of this team';
    end if;

  elsif p_audience = 'team' and team_scoped then
    if p_team_id is null then
      raise exception 'A team is required to post to a team wall';
    end if;
    if not (is_super_admin() or is_team_coach(p_team_id)) then
      raise exception 'Not allowed: not a coach of this team';
    end if;

  elsif p_audience = 'public' and team_scoped then
    if p_team_id is null then
      raise exception 'A team is required for a team public post';
    end if;
    if not (is_super_admin() or is_team_coach(p_team_id)) then
      raise exception 'Not allowed: not a coach of this team';
    end if;

  else
    if not is_super_admin() and not exists (
      select 1 from parent_player_links ppl
      where ppl.player_id = p_target_player_id and ppl.parent_user_id = uid
    ) then
      raise exception 'Not allowed: not a linked parent of this player';
    end if;
  end if;

  if p_audience = 'team' and not team_scoped then
    if p_team_id is null then
      raise exception 'A team is required to post to a team audience';
    end if;
    if not exists (select 1 from player_teams pt
                   where pt.player_id = p_target_player_id and pt.team_id = p_team_id) then
      raise exception 'Player is not on the specified team';
    end if;
  end if;

  select id into new_id
  from shares
  where content_type      = p_content_type
    and content_id        = p_content_id
    and audience          = p_audience
    and target_player_id  is not distinct from p_target_player_id
    and shared_by_user_id = uid
    and team_id           is not distinct from p_team_id;
  if new_id is not null then
    return new_id;
  end if;

  insert into shares (content_type, content_id, audience, target_player_id, shared_by_user_id, team_id, on_wall)
  values (p_content_type, p_content_id, p_audience, p_target_player_id, uid, p_team_id, goes_on_wall)
  returning id into new_id;

  -- NOTIFY: a NEW share to a kid's inbox/wall → that kid's OTHER guardians.
  -- Only fires on the insert path (a duplicate re-post returns early above), so
  -- re-posting never re-notifies. Team/coaches/public posts intentionally don't.
  if p_audience = 'player' then
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_target_player_id),
      'share_to_kid', uid, p_target_player_id, p_team_id, p_content_type::text, p_content_id
    );
  end if;

  return new_id;
end;
$function$;

-- set_share_on_wall: a linked guardian of the target kid (or super admin) moves
-- a player-audience share on/off that kid's wall. Gated so a coach who shared TO
-- the kid can never place it on the wall themselves.
create or replace function public.set_share_on_wall(p_share_id uuid, p_on_wall boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  tgt uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select target_player_id into tgt
  from shares
  where id = p_share_id and audience = 'player';
  if tgt is null then
    raise exception 'Not a player share, or share not found';
  end if;

  if not (
    is_super_admin()
    or exists (select 1 from parent_player_links ppl
               where ppl.player_id = tgt and ppl.parent_user_id = uid)
  ) then
    raise exception 'Not allowed: only the kid''s family can change the wall';
  end if;

  update shares set on_wall = p_on_wall where id = p_share_id;
end;
$function$;

notify pgrst, 'reload schema';
