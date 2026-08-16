-- Coaches' Corner PIN (team-required, per-coach PIN).
--
-- A team admin/head coach can REQUIRE a PIN to open Coaches' Corner for that team.
-- When required, each coach sets their own 4–8 digit PIN and must enter it to view
-- the (aggregated) Coaches' Corner. This is a CASUAL shared-device lock — the data
-- itself is already RLS-scoped to team coaches; the PIN just stops a kid poking a
-- coach's unlocked phone. The PIN is bcrypt-hashed (pgcrypto) and only ever checked
-- server-side; the hash never leaves the database.

alter table public.teams
  add column if not exists require_coaches_pin boolean not null default false;

alter table public.user_profiles
  add column if not exists coaches_pin_hash text;

-- Team admin/head coach toggles the requirement for their team.
create or replace function public.set_team_coaches_pin_required(p_team_id uuid, p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from team_memberships
    where team_id = p_team_id and user_id = auth.uid()
      and role in ('admin','head_coach') and status = 'confirmed'
  ) then
    raise exception 'Only a team admin or head coach can change this';
  end if;
  update teams set require_coaches_pin = p_required where id = p_team_id;
end $$;

-- The caller sets/changes their own PIN (4–8 digits).
create or replace function public.set_coaches_pin(p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  update user_profiles
    set coaches_pin_hash = crypt(p_pin, gen_salt('bf'))
    where user_id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;
end $$;

-- Verify the caller's PIN (returns true/false; never reveals the hash).
create or replace function public.verify_coaches_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  select coaches_pin_hash into h from user_profiles where user_id = auth.uid();
  if h is null then return false; end if;
  return h = crypt(p_pin, h);
end $$;

-- Client gate helper: is a PIN required for me (any team I coach requires it), and
-- have I set one yet?
create or replace function public.coaches_pin_status()
returns json language plpgsql security definer set search_path = public as $$
declare req boolean; has boolean;
begin
  select exists (
    select 1 from team_memberships tm
    join teams t on t.id = tm.team_id
    where tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach','coach') and tm.status = 'confirmed'
      and t.require_coaches_pin = true
  ) into req;
  select coaches_pin_hash is not null into has from user_profiles where user_id = auth.uid();
  return json_build_object('required', coalesce(req, false), 'has_pin', coalesce(has, false));
end $$;

grant execute on function public.set_team_coaches_pin_required(uuid, boolean) to authenticated;
grant execute on function public.set_coaches_pin(text)                       to authenticated;
grant execute on function public.verify_coaches_pin(text)                    to authenticated;
grant execute on function public.coaches_pin_status()                        to authenticated;
