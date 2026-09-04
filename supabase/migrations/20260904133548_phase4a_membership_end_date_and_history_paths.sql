-- Season rosters — PHASE 4a/4b: departures keep history, stop future access
-- Plan: docs/SEASON_ROSTERS_PLAN.md
--
-- THE CASE (Adam's words): Lars played for Centex Attack Brandon last year and
-- doesn't this year. We un-associate him today. His family must keep ALL film
-- from while he played, forever — and see NOTHING the team films afterwards.
--
-- Phases 1–3 already deliver that for videos, clips, games and lineups (the spell
-- decides per game, by date). Two things still break it, in OPPOSITE directions:
--
--  1. TOO MUCH. `leave_team` never touched `team_memberships`, so a departed
--     family kept a confirmed 'parent' membership forever — and `is_team_member`
--     grants all current team content. They'd see next season's film.
--
--  2. TOO LITTLE. `highlight_reels` has NO family path at all
--     (`super_admin OR creator OR team_coach OR a share exists`) and `shares`
--     only has the `player` audience. The moment membership ends, every reel and
--     every team-wall post from their own era goes dark — the opposite of the
--     promise. This is why "just delete the membership on leave" was WRONG and
--     was retracted.
--
-- FIX: membership gains an end date (so the 38 policies across 24 tables that
-- call is_team_member correctly treat a departed person as a non-member and they
-- lose LIVE surfaces — schedule, messages, tags, current roster), and reels +
-- shares gain family-history paths so their ERA stays visible on its own merit.
--
-- `is_team_member` semantics are NOT otherwise changed — only ended memberships
-- are excluded, which is exactly the intent.

-- ---------------------------------------------------------------------------
-- 1. Membership gets an end date
-- ---------------------------------------------------------------------------
alter table public.team_memberships add column if not exists left_on date;

create index if not exists team_memberships_current_idx
  on public.team_memberships (team_id, user_id) where left_on is null;

create or replace function public.is_team_member(t uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = t
      AND user_id = auth.uid()
      AND status = 'confirmed'
      AND left_on IS NULL
  );
$function$;

create or replace function public.is_team_coach(check_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  SELECT EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_id = check_team_id
      AND user_id = auth.uid()
      AND status = 'confirmed'
      AND left_on IS NULL
      AND role IN ('admin','head_coach','coach')
  );
$function$;

-- ---------------------------------------------------------------------------
-- 2. Closing a kid's spell closes their guardians' membership — but only when
--    that guardian has no OTHER current kid on the same team.
--    Mirrors the cleanup remove_guardian already does.
-- ---------------------------------------------------------------------------
create or replace function public.close_orphaned_parent_memberships(p_team_id uuid, p_on date)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update team_memberships tm
     set left_on = p_on
   where tm.team_id = p_team_id
     and tm.role = 'parent'
     and tm.left_on is null
     and not exists (
       select 1
       from parent_player_links ppl
       join player_teams pt on pt.player_id = ppl.player_id
       where ppl.parent_user_id = tm.user_id
         and pt.team_id = p_team_id
         and pt.left_on is null
     );
end $$;

-- Leaving must also drop the kid from lineups of games they will NEVER play.
--
-- Caught by the Phase 4a test suite: snapshot_game_lineup fires on games INSERT
-- and snapshots whoever is rostered ON THE GAME DATE — including for games
-- scheduled in the FUTURE. So a coach who schedules October's game in September
-- puts every current kid in its lineup; when one leaves in September, the
-- additive `OR lineup` branch of is_roster_parent then grants that family
-- permanent access to a game their kid never played.
--
-- Prune FUTURE lineups only (game_date > left_on). Past lineups are history and
-- must stay — they are what keeps the family's era visible. Undated games are
-- left alone rather than guessed at. Done as a trigger so every path that closes
-- a spell is covered, not just the two RPCs.
create or replace function public.prune_future_lineups_on_leave()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.left_on is not null
     and (old.left_on is null or old.left_on is distinct from new.left_on) then
    delete from game_lineups gl
    using games g
    where gl.game_id = g.id
      and gl.player_id = new.player_id
      and g.team_id    = new.team_id
      and g.game_date is not null
      and g.game_date  > new.left_on;
  end if;
  return new;
end $$;

drop trigger if exists trg_prune_future_lineups on public.player_teams;
create trigger trg_prune_future_lineups
  after update of left_on on public.player_teams
  for each row execute function public.prune_future_lineups_on_leave();

create or replace function public.leave_team(p_player_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); d date := current_date;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to leave this team';
  end if;
  update player_teams set left_on = greatest(d, joined_on)
  where player_id = p_player_id and team_id = p_team_id and left_on is null;
  perform close_orphaned_parent_memberships(p_team_id, d);
end $function$;

create or replace function public.remove_roster_placeholder(p_player_id uuid, p_team_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); d date := current_date;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Only a team coach can remove roster spots';
  end if;

  if exists (select 1 from parent_player_links where player_id = p_player_id)
     or exists (select 1 from videos where player_id = p_player_id)
     or exists (select 1 from game_lineups where player_id = p_player_id)
     or exists (select 1 from clip_tags ct join tags t on t.id = ct.tag_id
                where t.player_id = p_player_id) then
    update player_teams set left_on = greatest(d, joined_on)
    where player_id = p_player_id and team_id = p_team_id and left_on is null;
    perform close_orphaned_parent_memberships(p_team_id, d);
    return 'left';
  end if;

  delete from player_teams where player_id = p_player_id and team_id = p_team_id;
  if not exists (select 1 from player_teams where player_id = p_player_id) then
    delete from tags where player_id = p_player_id and category = 'players';
    delete from players where id = p_player_id;
    return 'deleted';
  end if;
  return 'detached';
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Coming BACK must reopen the membership.
--    Both join paths insert with `on conflict (team_id,user_id,role) do nothing`
--    — against a CLOSED membership row that silently left them locked out.
-- ---------------------------------------------------------------------------
create or replace function public.join_team_with_code(p_code text, p_player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_player_id) then
    raise exception 'You are not a guardian of this player';
  end if;
  select id into t_id from teams
   where join_code = upper(trim(p_code))
     and (join_code_expires_at is null or join_code_expires_at > now());
  if t_id is null then raise exception 'Invalid team code'; end if;

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (p_player_id, t_id, uid)
  on conflict (player_id, team_id) where left_on is null do nothing;

  update players set team_id = t_id where id = p_player_id and team_id is null;

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role)
  do update set left_on = null, status = 'confirmed';
  return t_id;
end $function$;

create or replace function public.claim_or_link_guardian(p_code text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); p_id uuid; n int; has_seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
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
    insert into parent_player_links (parent_user_id, player_id, relationship)
    values (uid, p_id, case when n = 0 then 'parent' else 'guardian' end);
    update player_guardian_codes set last_used_at = now() where player_id = p_id;
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt
   where pt.player_id = p_id and pt.left_on is null
  on conflict (team_id, user_id, role)
  do update set left_on = null, status = 'confirmed';

  return p_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. FAMILY HISTORY PATHS — reels and shares survive on their own merit
-- ---------------------------------------------------------------------------

-- A reel belongs to a family's era if ANY of its source clips came from a game
-- their kid was rostered for. DECIDED with Adam: scope by the reel's CONTENT,
-- not its render date — a season highlight reel rendered in October, about last
-- season's games, IS visible to a family who played that season ("all the film
-- from when he played").
create or replace function public.is_roster_reel_parent(p_reel_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from highlight_reels r
    join clips  c on c.id = any(r.source_clip_ids)
    join videos v on v.id = c.video_id
    where r.id = p_reel_id
      and v.game_id is not null
      and is_roster_film_parent(v.game_id)
  );
$$;

-- A share is era-visible when the CONTENT it points at is. This keeps team-wall
-- history readable after a family leaves, without inventing a second date rule —
-- the content's own era decides.
create or replace function public.is_roster_share_parent(p_share_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from shares s
    where s.id = p_share_id and (
      (s.content_type = 'game'  and is_roster_film_parent(s.content_id))
      or (s.content_type = 'reel' and is_roster_reel_parent(s.content_id))
      or (s.content_type = 'video' and exists (
            select 1 from videos v where v.id = s.content_id
              and v.game_id is not null and is_roster_film_parent(v.game_id)))
      or (s.content_type = 'clip' and exists (
            select 1 from clips c join videos v on v.id = c.video_id
             where c.id = s.content_id
               and v.game_id is not null and is_roster_film_parent(v.game_id)))
    )
  );
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname in ('is_roster_reel_parent','is_roster_share_parent',
                        'close_orphaned_parent_memberships')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Wire the history paths into reads + playback
-- ---------------------------------------------------------------------------
drop policy if exists highlight_reels_read on public.highlight_reels;
create policy highlight_reels_read on public.highlight_reels for select using (
  is_super_admin()
  or created_by_user_id = (select auth.uid())
  or is_team_coach(team_id)
  or is_roster_reel_parent(id)                       -- NEW: family keeps its era
  or exists (
    select 1 from shares s
    where s.content_type = 'reel'::share_content
      and s.content_id = highlight_reels.id
      and s.visible
      and (
        s.shared_by_user_id = (select auth.uid())
        or (s.audience = 'team'::share_audience    and is_team_member(s.team_id))
        or (s.audience = 'coaches'::share_audience and is_team_coach(s.team_id))
        or (s.audience = 'player'::share_audience and exists (
              select 1 from parent_player_links ppl
              where ppl.player_id = s.target_player_id
                and ppl.parent_user_id = (select auth.uid())))
      )
  )
);

drop policy if exists shares_read on public.shares;
create policy shares_read on public.shares for select using (
  is_super_admin()
  or shared_by_user_id = (select auth.uid())
  or (audience = 'team'::share_audience    and is_team_member(team_id))
  or (audience = 'team'::share_audience    and is_roster_share_parent(id))  -- NEW
  or (audience = 'coaches'::share_audience and is_team_coach(team_id))
  or (audience = 'player'::share_audience
      and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = shares.target_player_id
                    and ppl.parent_user_id = (select auth.uid()))
      and (on_wall = true or is_primary_guardian(target_player_id)))
);

create or replace function public.authorize_reel_playback(p_reel_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); r highlight_reels%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from highlight_reels where id = p_reel_id;
  if not found then raise exception 'Reel not found'; end if;
  if r.storage_path is null then raise exception 'Reel has no file yet'; end if;
  if r.deleted_at is not null then raise exception 'This reel was deleted'; end if;
  if is_super_admin() or r.created_by_user_id = uid or is_team_coach(r.team_id) then return r.storage_path; end if;
  -- Family whose kid was rostered for a game this reel draws from.
  if is_roster_reel_parent(p_reel_id) then return r.storage_path; end if;
  if exists (select 1 from shares s
       where s.content_type = 'reel' and s.content_id = r.id
         and ( is_super_admin() or s.shared_by_user_id = uid
            or (s.audience='team'    and is_team_member(s.team_id))
            or (s.audience='coaches' and is_team_coach(s.team_id))
            or (s.audience='player'  and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid)))
     ) then return r.storage_path; end if;
  raise exception 'Not allowed to view this reel';
end $function$;
