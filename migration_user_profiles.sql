-- ============================================================
-- User profiles — adult (auth user) display names + shared-context name reads.
--
-- Adds a user_profiles table keyed 1:1 to auth.users, holding an adult user's
-- display_name (the name shown as "shared by …" on inbox/wall cards). Today no
-- table stores an adult's name; the auth user id is all the app has, so cards
-- fall back to a truncated UUID. This closes that gap.
--
-- Four parts:
--   1. user_profiles table (RLS enabled; self-read only — cross-user name reads
--      go exclusively through the gated function in part 3).
--   2. AFTER INSERT trigger on auth.users that auto-creates an empty profile row
--      for every new account, so BOTH signup paths (password signUp and OTP
--      signInWithOtp with shouldCreateUser) get a row with zero app changes.
--   3. get_user_display_name(p_user_id) — SECURITY DEFINER read gated to shared
--      context: self, a common linked player, a shared confirmed team, or super
--      admin. Anyone else gets null. This is the "names visible within shared
--      context only" guarantee.
--   4. set_my_display_name(p_name) — SECURITY DEFINER upsert for the caller's
--      own row only (auth.uid()).
--
-- Depends on: auth.users, parent_player_links + team_memberships (migration_step1),
--   is_super_admin() (migration_rls_helpers / migration_superadmin_audit).
--
-- Idempotent: safe to re-run (create table/function if-not-exists / or-replace,
--   drop-then-create trigger & policy, on-conflict upserts). authenticated-only
--   for the client RPCs.
-- ============================================================

-- 1. Table -----------------------------------------------------------------
create table if not exists user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table user_profiles enable row level security;

-- Direct table access is self-only (or super admin). Every cross-user name read
-- is funneled through get_user_display_name() below, which is SECURITY DEFINER
-- and therefore bypasses this policy under its own access gate. No INSERT/UPDATE
-- policy exists on purpose — writes happen via set_my_display_name() only.
drop policy if exists user_profiles_select_own on user_profiles;
create policy user_profiles_select_own on user_profiles
  for select
  using (user_id = auth.uid() or is_super_admin());

-- Supabase grants authenticated broad table privileges by default; RLS gates
-- them. Make the self-read grant explicit for clarity.
grant select on user_profiles to authenticated;

-- 2. Auto-create a profile row for every new auth user ---------------------
-- Trigger function: runs in the auth.users insert context (uses NEW.id, not
-- auth.uid()), so no null-auth guard applies here. on conflict keeps it safe if
-- a row already exists (e.g. re-run after backfill).
create or replace function ensure_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function ensure_user_profile();

-- Backfill rows for accounts that existed before this trigger. Idempotent.
insert into user_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- 3. Gated read — name only within shared context -------------------------
create or replace function get_user_display_name(p_user_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  shared boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  shared :=
    -- caller is the target
    uid = p_user_id
    -- caller is a super admin
    or is_super_admin()
    -- caller and target are both linked to a common player
    or exists (
      select 1
      from parent_player_links a
      join parent_player_links b on b.player_id = a.player_id
      where a.parent_user_id = uid
        and b.parent_user_id = p_user_id
    )
    -- caller and target share a confirmed team membership
    or exists (
      select 1
      from team_memberships a
      join team_memberships b on b.team_id = a.team_id
      where a.user_id = uid
        and b.user_id = p_user_id
        and a.status = 'confirmed'
        and b.status = 'confirmed'
    )
    -- caller is a linked parent of a player on a team where the target is a
    -- confirmed member (the "who shared it" case: parent sees the coach/member
    -- of their kid's team). Uses the player_teams junction, like post_to_wall.
    or exists (
      select 1
      from parent_player_links ppl
      join player_teams pt on pt.player_id = ppl.player_id
      join team_memberships tm on tm.team_id = pt.team_id
      where ppl.parent_user_id = uid
        and tm.user_id = p_user_id
        and tm.status = 'confirmed'
    );

  if not shared then
    return null;
  end if;

  return (select display_name from user_profiles where user_id = p_user_id);
end;
$$;

revoke all on function get_user_display_name(uuid) from public, anon;
grant execute on function get_user_display_name(uuid) to authenticated;

-- 4. Upsert the caller's own display name ----------------------------------
create or replace function set_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into user_profiles (user_id, display_name, updated_at)
  values (uid, p_name, now())
  on conflict (user_id)
  do update set display_name = excluded.display_name,
                updated_at   = now();
end;
$$;

revoke all on function set_my_display_name(text) from public, anon;
grant execute on function set_my_display_name(text) to authenticated;

-- Schema cache trap — force PostgREST to reload (see CLAUDE.md).
notify pgrst, 'reload schema';
