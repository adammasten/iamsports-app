-- Season rosters — PHASE 1: roster spells
-- Plan: docs/SEASON_ROSTERS_PLAN.md
--
-- Rosters gain a time dimension. `player_teams` becomes a SPELL table: a kid can
-- have many dated memberships on one team (2025, then 2026), instead of exactly
-- one row forever.
--
-- WHY: two product promises rest on knowing who was on a team WHEN —
--   1. "Film follows the kid, even after they leave" (durable family access), and
--   2. "Show me the 3rd-grade-spring roster".
-- Neither is answerable today. `UNIQUE (player_id, team_id)` is what blocks it.
--
-- ALSO FIXES A LIVE BUG: join_team_with_code rejoined with
--   `on conflict (player_id, team_id) do update set left_at = null`
-- which ERASED the departure — a kid who left and came back was recorded as
-- continuously rostered. Rejoining now inserts a NEW spell and the old one stands.
--
-- SEASON IS NOT THE KEY. `season_id` is added as an optional PIN only. Dates are
-- the key, because `games.game_date` is 18/18 populated while `games.season_id` is
-- 6/18 and all 5 seasons had NULL windows. See the plan doc for why keying on
-- season_id was rejected (forces a season to exist before anyone can join, and
-- cannot express mid-season joins/leaves — the actual requirement).
--
-- `left_at` IS DEPRECATED BUT STILL MAINTAINED. A trigger keeps it in sync with
-- `left_on` so the four app files that read `.is('left_at', null)`
-- (box-score.tsx, (tabs)/roster.tsx, kid.tsx, lib/core/schedule.ts) keep working
-- with ZERO app changes. Phase 5 flips those readers to `left_on` and drops the
-- column. Do not add new readers of `left_at`.

-- ---------------------------------------------------------------------------
-- 1. Spell columns
-- ---------------------------------------------------------------------------
alter table public.player_teams
  add column if not exists joined_on date,
  add column if not exists left_on   date,
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

-- Backfill from the system timestamps that were standing in for domain dates.
-- `created_at` is when the ROW was inserted, not when the kid joined — which is
-- exactly why the two Centex Attack Regents games (2026-08-10/11, roster entered
-- 08-13) have no lineup. Coaches can correct `joined_on` afterwards; that is the
-- point of making it a real, editable field.
update public.player_teams set joined_on = created_at::date where joined_on is null;
update public.player_teams
   set left_on = greatest(left_at::date, created_at::date)
 where left_at is not null and left_on is null;

alter table public.player_teams
  alter column joined_on set not null,
  alter column joined_on set default current_date;

alter table public.player_teams
  drop constraint if exists player_teams_spell_ck;
alter table public.player_teams
  add constraint player_teams_spell_ck check (left_on is null or left_on >= joined_on);

-- ---------------------------------------------------------------------------
-- 2. Allow history: at most ONE CURRENT spell, unlimited past ones
-- ---------------------------------------------------------------------------
alter table public.player_teams drop constraint if exists player_teams_player_id_team_id_key;

create unique index if not exists player_teams_current_key
  on public.player_teams (player_id, team_id) where left_on is null;

-- Spell lookups are "which spell covers this date" — index for that.
create index if not exists player_teams_spell_idx
  on public.player_teams (team_id, player_id, joined_on, left_on);

-- ---------------------------------------------------------------------------
-- 3. Keep the deprecated left_at in sync (see header)
-- ---------------------------------------------------------------------------
create or replace function public.sync_player_teams_left_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.left_at := case
    when new.left_on is null then null
    else coalesce(new.left_at, new.left_on::timestamptz)
  end;
  return new;
end $$;

drop trigger if exists trg_sync_player_teams_left_at on public.player_teams;
create trigger trg_sync_player_teams_left_at
  before insert or update on public.player_teams
  for each row execute function public.sync_player_teams_left_at();

-- ---------------------------------------------------------------------------
-- 4. Spell helper — the one place "was this kid on this team then" is decided
-- ---------------------------------------------------------------------------
create or replace function public.was_on_roster(p_player_id uuid, p_team_id uuid, p_on date)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from player_teams pt
    where pt.player_id = p_player_id
      and pt.team_id   = p_team_id
      and pt.joined_on <= p_on
      and (pt.left_on is null or pt.left_on >= p_on)
  );
$$;
grant execute on function public.was_on_roster(uuid, uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The four upserts
--    Conflict target must name the partial index's predicate.
-- ---------------------------------------------------------------------------

-- 5a. Coach adds a kid. A CURRENT spell updates its jersey; if the kid only has
--     PAST spells this starts a new one rather than resurrecting the old.
create or replace function public.attach_kid_to_team(p_player_id uuid, p_team_id uuid, p_jersey_number text default null::text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); new_id uuid; was_new boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_super_admin() and not is_team_coach(p_team_id) then
    raise exception 'Only a coach or admin of this team can add players';
  end if;
  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (p_player_id, p_team_id, nullif(trim(coalesce(p_jersey_number, '')), ''), uid)
  on conflict (player_id, team_id) where left_on is null do update
    set jersey_number = excluded.jersey_number
  returning id, (xmax = 0) into new_id, was_new;
  update tags tg set name = case when split_part(p.name, ' ', 1) like '#%'
    then split_part(p.name, ' ', 1)
    else split_part(p.name, ' ', 1) || coalesce(' #' || nullif(trim(p_jersey_number), ''), '') end
  from players p
  where tg.player_id = p_player_id and tg.team_id = p_team_id and tg.category = 'players' and p.id = p_player_id;
  if was_new then
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_player_id),
      'kid_added_to_team', uid, p_player_id, p_team_id, 'team', p_team_id
    );
  end if;
  return new_id;
end $function$;

-- 5b. Guardian joins a team by code. THE REJOIN FIX: previously
--     `do update set left_at = null`, which erased the departure. Now a current
--     spell is left alone and a returning kid gets a NEW spell.
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
  on conflict (team_id, user_id, role) do nothing;
  return t_id;
end $function$;

-- 5c. Placeholder roster spot (the player row is brand new, so no conflict is
--     possible — the predicate is kept only so every upsert reads the same).
create or replace function public.create_roster_placeholder(p_team_id uuid, p_name text, p_jersey text default null::text)
returns table(player_id uuid, guardian_code text)
language plpgsql security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare uid uuid := auth.uid(); new_id uuid; c text; v_name text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Only a team coach can add roster spots'; end if;

  v_name := coalesce(nullif(trim(p_name), ''), '#' || nullif(trim(p_jersey), ''));
  if v_name is null then raise exception 'A name or jersey number is required'; end if;

  insert into players (name, team_id, jersey_number)
  values (v_name, p_team_id, nullif(trim(p_jersey), ''))
  returning id into new_id;

  insert into player_teams (player_id, team_id, jersey_number, added_by_user_id)
  values (new_id, p_team_id, nullif(trim(p_jersey), ''), uid)
  on conflict (player_id, team_id) where left_on is null do nothing;

  loop c := gen_join_code(8); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return query select new_id, c;
end $function$;

-- 5d. Claiming a roster spot requires the kid to be CURRENTLY rostered, not
--     merely to have played there in some past season.
create or replace function public.claim_roster_spot(p_code text, p_player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
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

  insert into parent_player_links (parent_user_id, player_id, relationship)
  values (uid, p_player_id, 'parent');

  insert into team_memberships (team_id, user_id, role, status)
  values (t_id, uid, 'parent', 'confirmed')
  on conflict (team_id, user_id, role) do nothing;

  return p_player_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 6. Leaving now writes the DOMAIN date (the trigger mirrors it into left_at)
-- ---------------------------------------------------------------------------
create or replace function public.leave_team(p_player_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_team_coach(p_team_id) or is_super_admin()) then
    raise exception 'Not allowed to leave this team';
  end if;
  update player_teams set left_on = greatest(current_date, joined_on)
  where player_id = p_player_id and team_id = p_team_id and left_on is null;
end $function$;

create or replace function public.remove_roster_placeholder(p_player_id uuid, p_team_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid();
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
    update player_teams set left_on = greatest(current_date, joined_on)
    where player_id = p_player_id and team_id = p_team_id and left_on is null;
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
-- 7. Lineup snapshot becomes DATE-AWARE
--    This is the direct fix for the orphaned-lineup class of bug: the snapshot
--    used "currently active roster" at the moment the game row was inserted, so
--    a coach who uploads Saturday's film before entering the roster got an EMPTY
--    lineup, permanently. Now it snapshots whoever was rostered ON THE GAME DATE,
--    so correcting a kid's joined_on afterwards makes future snapshots right.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_game_lineup()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare d date := coalesce(NEW.game_date, current_date);
begin
  insert into game_lineups (game_id, player_id, added_by_user_id)
  select NEW.id, pt.player_id, auth.uid()
  from player_teams pt
  where pt.team_id = NEW.team_id
    and pt.joined_on <= d
    and (pt.left_on is null or pt.left_on >= d)
  on conflict do nothing;
  return NEW;
end $function$;

-- The lineup editor offers the roster AS OF THE GAME DATE (plus anyone already
-- in the lineup), instead of only the currently-active roster.
create or replace function public.get_game_lineup_editor(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); t uuid; d date; result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id, coalesce(game_date, current_date) into t, d from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then raise exception 'Only a team coach can edit the lineup'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', x.player_id, 'label', x.label, 'in_lineup', x.in_lineup) order by x.label), '[]'::jsonb)
  into result
  from (
    select distinct on (p.id)
           p.id as player_id,
           case when split_part(p.name, ' ', 1) like '#%' then p.name
                else p.name || coalesce(' #' || nullif(trim(pt.jersey_number), ''), '') end as label,
           exists (select 1 from game_lineups gl where gl.game_id = p_game_id and gl.player_id = p.id) as in_lineup
    from players p
    join player_teams pt on pt.player_id = p.id and pt.team_id = t
    where (pt.joined_on <= d and (pt.left_on is null or pt.left_on >= d))
       or exists (select 1 from game_lineups gl where gl.game_id = p_game_id and gl.player_id = p.id)
    order by p.id, pt.joined_on desc
  ) x;
  return result;
end $function$;

-- set_game_lineup: a kid may be added if they hold ANY spell on the team (a past
-- season counts — you are editing history).
create or replace function public.set_game_lineup(p_game_id uuid, p_player_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select team_id into t from games where id = p_game_id;
  if t is null then raise exception 'Game not found'; end if;
  if not (is_team_coach(t) or is_super_admin()) then raise exception 'Only a team coach can edit the lineup'; end if;

  delete from game_lineups
  where game_id = p_game_id and player_id <> all(coalesce(p_player_ids, '{}'::uuid[]));

  insert into game_lineups (game_id, player_id, added_by_user_id)
  select p_game_id, pid, uid
  from unnest(coalesce(p_player_ids, '{}'::uuid[])) as pid
  where exists (select 1 from player_teams pt where pt.player_id = pid and pt.team_id = t)
  on conflict do nothing;
end $function$;

-- ---------------------------------------------------------------------------
-- 8. Remaining left_at readers → left_on (behaviour identical, one source now)
-- ---------------------------------------------------------------------------
create or replace function public.kid_team_audience(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()
          or is_team_coach((select team_id from players where id = p_player_id))) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'team_id', pt.team_id,
               'team_name', coalesce(te.name, 'Team'),
               'member_count', (
                 select count(distinct tm2.user_id)
                 from team_memberships tm2
                 where tm2.team_id = pt.team_id and tm2.status = 'confirmed'
               ),
               'coaches', coalesce((
                 select jsonb_agg(c order by c->>'name')
                 from (
                   select distinct on (tm.user_id)
                          jsonb_build_object(
                            'user_id', tm.user_id,
                            'name', coalesce(up.display_name, 'Coach'),
                            'role', tm.role,
                            'is_you', tm.user_id = uid
                          ) as c
                   from team_memberships tm
                   left join user_profiles up on up.user_id = tm.user_id
                   where tm.team_id = pt.team_id
                     and tm.status = 'confirmed'
                     and tm.role in ('admin','head_coach','coach')
                   order by tm.user_id,
                            case tm.role
                              when 'admin' then 1
                              when 'head_coach' then 2
                              else 3
                            end
                 ) d
               ), '[]'::jsonb)
             )
             order by coalesce(te.name, 'Team')
           )
    from player_teams pt
    left join teams te on te.id = pt.team_id
    where pt.player_id = p_player_id
      and pt.left_on is null
  ), '[]'::jsonb);
end $function$;

create or replace function public.list_player_guardians(p_team_id uuid, p_player_id uuid)
returns table(user_id uuid, display_name text, email text, relationship text, team_role membership_role)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not (is_super_admin() or exists (
    select 1 from team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach') and tm.status = 'confirmed'
  )) then
    raise exception 'not authorized';
  end if;
  if not exists (
    select 1 from player_teams pt
    where pt.player_id = p_player_id and pt.team_id = p_team_id and pt.left_on is null
  ) then
    raise exception 'player not on this team';
  end if;
  return query
    select ppl.parent_user_id,
           coalesce(nullif(trim(up.display_name), ''), 'Guardian') as display_name,
           au.email::text as email,
           ppl.relationship,
           (select tm.role from team_memberships tm
             where tm.team_id = p_team_id and tm.user_id = ppl.parent_user_id
             order by (case tm.role when 'admin' then 0 when 'head_coach' then 1
                                    when 'coach' then 2 when 'parent' then 3 else 4 end)
             limit 1) as team_role
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    left join auth.users au on au.id = ppl.parent_user_id
    where ppl.player_id = p_player_id
    order by 2;
end $function$;
