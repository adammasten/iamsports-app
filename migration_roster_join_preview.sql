-- migration_roster_join_preview.sql — Phase A pt3 (applied as roster_join_preview_and_claim)
-- The dedup join flow: a parent enters the team code, SEES the roster (first name +
-- jersey + claimed-status only), and TAPS their kid to claim an unclaimed spot —
-- instead of blindly creating a duplicate. Already-claimed kids are off-limits via
-- the shared team code (co-guardians use the per-kid code), so a stranger holding
-- the team code can't attach themselves to someone else's child.

create or replace function public.preview_roster_by_code(p_code text)
returns table (team_id uuid, team_name text, player_id uuid, first_name text, jersey_number text, claimed boolean)
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t_id uuid; t_name text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id, name into t_id, t_name from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;
  return query
    select t_id, t_name, p.id,
           split_part(p.name, ' ', 1) as first_name,
           pt.jersey_number,
           exists (select 1 from parent_player_links l where l.player_id = p.id) as claimed
    from player_teams pt
    join players p on p.id = pt.player_id
    where pt.team_id = t_id
    order by p.name;
end $$;
grant execute on function public.preview_roster_by_code(text) to authenticated;


create or replace function public.claim_roster_spot(p_code text, p_player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id into t_id from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;
  if not exists (select 1 from player_teams where team_id = t_id and player_id = p_player_id) then
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
end $$;
grant execute on function public.claim_roster_spot(text, uuid) to authenticated;
