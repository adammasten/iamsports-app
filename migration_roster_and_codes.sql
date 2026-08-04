-- migration_roster_and_codes.sql — Phase A: roster & codes
-- ============================================================================
-- Revised after self-review:
--   • Guardian codes live in their OWN table (player_guardian_codes) readable
--     only by the kid's linked parents + the kid's team coaches — NOT by every
--     team member (the column-on-players version leaked a kid's code to any
--     teammate, who could then attach themselves as a co-guardian).
--   • claim_or_link_guardian locks the player row (FOR UPDATE) so the 4-guardian
--     cap can't be exceeded by concurrent claims.
--   • gen_join_code is not client-callable.
-- Model: parents own kids (create_kid, teamless); coaches may hold a roster spot
-- (placeholder) so stats can start pre-claim; two codes — teams.join_code
-- (kid → roster) and a per-kid guardian code (co-guardian attach / placeholder
-- claim, create-once-then-attach, cap 4). Parent-forbidden writes (player_teams,
-- parent_player_links) go through SECURITY DEFINER RPCs, like create_kid.
-- ============================================================================


-- ── 1. Code generator (INTERNAL — not client-callable) ──────────────────────
create or replace function public.gen_join_code(len int default 6)
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, len);
$$;
revoke execute on function public.gen_join_code(int) from anon, authenticated, public;


-- ── 2. Team join code (column; teams_read is already member-scoped) ─────────
alter table public.teams add column if not exists join_code text;
create unique index if not exists teams_join_code_key
  on public.teams (join_code) where join_code is not null;

do $$
declare r record; c text;
begin
  for r in select id from public.teams where join_code is null loop
    loop c := public.gen_join_code(6); exit when not exists (select 1 from public.teams where join_code = c); end loop;
    update public.teams set join_code = c where id = r.id;
  end loop;
end $$;


-- ── 3. Guardian codes — SEPARATE, access-controlled table ───────────────────
create table if not exists public.player_guardian_codes (
  player_id  uuid primary key references public.players(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);
alter table public.player_guardian_codes enable row level security;

-- Readable ONLY by the kid's linked parents, the kid's team coaches, or a super
-- admin — never all team members. No write policies: writes are definer/service
-- only. (A coach reading it can re-share a placeholder's code.)
drop policy if exists player_guardian_codes_read on public.player_guardian_codes;
create policy player_guardian_codes_read on public.player_guardian_codes for select
  using (
    is_super_admin()
    or is_linked_parent(player_id)
    or is_team_coach((select p.team_id from public.players p where p.id = player_guardian_codes.player_id))
  );

-- Backfill a code for every existing player.
do $$
declare r record; c text;
begin
  for r in
    select p.id from public.players p
    where not exists (select 1 from public.player_guardian_codes g where g.player_id = p.id)
  loop
    loop c := public.gen_join_code(6); exit when not exists (select 1 from public.player_guardian_codes where code = c); end loop;
    insert into public.player_guardian_codes (player_id, code) values (r.id, c);
  end loop;
end $$;


-- ── 4. create_kid — also mints a guardian code (into the new table) ─────────
create or replace function public.create_kid(name text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(name, ''));
  new_id uuid;
  c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if clean_name = '' then raise exception 'Kid name is required'; end if;

  insert into players (name, team_id, user_id) values (clean_name, null, null) returning id into new_id;
  insert into parent_player_links (parent_user_id, player_id, relationship) values (uid, new_id, 'parent');

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return new_id;
end $$;


-- ── 5. Parent attaches THEIR kid to a team via the team code ────────────────
create or replace function public.join_team_with_code(p_code text, p_player_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); t_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_player_id) then
    raise exception 'You are not a guardian of this player';
  end if;
  select id into t_id from teams where join_code = upper(trim(p_code));
  if t_id is null then raise exception 'Invalid team code'; end if;

  insert into player_teams (player_id, team_id, added_by_user_id)
  values (p_player_id, t_id, uid)
  on conflict (player_id, team_id) do nothing;

  update players set team_id = t_id where id = p_player_id and team_id is null;
  return t_id;
end $$;


-- ── 6. Coach holds a roster spot (placeholder + its guardian code) ──────────
-- SUPERSEDED: this version raises "column reference player_id is ambiguous" (the
-- returns-table OUT var collides with player_teams.player_id in ON CONFLICT).
-- Fixed in migration_fix_roster_placeholder_ambiguous.sql (adds
-- #variable_conflict use_column). Keep them in sync if you touch this.
create or replace function public.create_roster_placeholder(p_team_id uuid, p_name text, p_jersey text default null)
returns table (player_id uuid, guardian_code text)
language plpgsql security definer set search_path to 'public' as $$
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
  on conflict (player_id, team_id) do nothing;

  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  insert into player_guardian_codes (player_id, code) values (new_id, c);

  return query select new_id, c;
end $$;


-- ── 7. Claim a placeholder OR attach as co-guardian — same code, atomic cap 4 ──
create or replace function public.claim_or_link_guardian(p_code text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p_id uuid; n int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;

  -- Serialize concurrent claims for this kid so the 4-guardian cap holds.
  perform 1 from players where id = p_id for update;

  if exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
    return p_id;  -- already a guardian → idempotent success
  end if;

  select count(*) into n from parent_player_links where player_id = p_id;
  if n >= 4 then raise exception 'This player already has the maximum of 4 guardians'; end if;

  insert into parent_player_links (parent_user_id, player_id, relationship)
  values (uid, p_id, case when n = 0 then 'parent' else 'guardian' end);

  return p_id;
end $$;


grant execute on function public.join_team_with_code(text, uuid)             to authenticated;
grant execute on function public.create_roster_placeholder(uuid, text, text) to authenticated;
grant execute on function public.claim_or_link_guardian(text)                to authenticated;

notify pgrst, 'reload schema';
