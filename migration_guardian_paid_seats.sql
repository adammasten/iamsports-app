-- migration_guardian_paid_seats.sql
-- Paid 5th+ guardian seat.
--
-- BACKGROUND: a kid is capped at 4 guardians. That cap already existed and is
-- enforced inside claim_or_link_guardian (count parent_player_links, row-locked
-- on players). This migration does NOT introduce the cap — it adds a way to
-- exceed it by one seat at a time, purchased by the person redeeming the code.
--
-- MODEL (decided 2026-09-02): the REDEEMER pays. A seat is an entitlement for
-- ONE (player, user) pair, not a generic +1 on the kid. Grandma buys a seat for
-- Jackson; that seat lets Grandma past the wall and nobody else. This keeps the
-- 4-guardian cap meaningful — you can't buy "6 slots" and hand them around.
--
-- REVOCATION: a seat is revoked the moment that guardian link goes away, via a
-- trigger on parent_player_links (NOT inside remove_guardian) so EVERY removal
-- path is covered — the RPC, a direct delete, a future admin tool, a cascade.
-- Without this, a guardian removed for cause could re-redeem the code forever on
-- their old seat. Revocation is deliberately NOT an automatic refund: a removed
-- guardian loses the seat, and a refund/comp is a manual decision (grant again
-- with source='comp').
--
-- PAYMENT: there is no purchase rail yet (RevenueCat is post-App-Store-launch).
-- grant_guardian_seat is therefore super-admin-only today, which makes every
-- seat a comp. When RevenueCat lands, a verified-purchase Edge Function calls
-- the SAME function with the service role and source='purchase' — no rework in
-- the cap logic, the trigger, or the UI.

-- ---------------------------------------------------------------------------
-- 1. Seat grants
-- ---------------------------------------------------------------------------
create table if not exists public.player_guardian_seats (
  id                 uuid primary key default gen_random_uuid(),
  player_id          uuid not null references public.players(id) on delete cascade,
  granted_to_user_id uuid not null references auth.users(id)     on delete cascade,
  source             text not null check (source in ('purchase', 'comp')),
  external_txn_id    text,                       -- RevenueCat / App Store txn; null for comps
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz
);

-- One LIVE seat per (player, user). Revoked rows stay for the audit trail, so
-- the uniqueness is partial rather than a plain unique constraint.
create unique index if not exists player_guardian_seats_live_key
  on public.player_guardian_seats (player_id, granted_to_user_id)
  where revoked_at is null;

create index if not exists player_guardian_seats_player_idx
  on public.player_guardian_seats (player_id) where revoked_at is null;

alter table public.player_guardian_seats enable row level security;

-- Read: the person the seat belongs to, that kid's guardians, super admin.
-- No insert/update/delete policy at all — writes go exclusively through the
-- SECURITY DEFINER functions below, so a client can never mint itself a seat.
drop policy if exists player_guardian_seats_read on public.player_guardian_seats;
create policy player_guardian_seats_read on public.player_guardian_seats for select
  using (
    is_super_admin()
    or granted_to_user_id = (select auth.uid())
    or is_linked_parent(player_id)
  );

-- ---------------------------------------------------------------------------
-- 2. Revoke the seat whenever the guardian link goes away (any path)
-- ---------------------------------------------------------------------------
create or replace function public.revoke_guardian_seat_on_unlink()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.player_guardian_seats
     set revoked_at = now()
   where player_id = old.player_id
     and granted_to_user_id = old.parent_user_id
     and revoked_at is null;
  return old;
end $$;

drop trigger if exists trg_revoke_guardian_seat on public.parent_player_links;
create trigger trg_revoke_guardian_seat
  after delete on public.parent_player_links
  for each row execute function public.revoke_guardian_seat_on_unlink();

-- ---------------------------------------------------------------------------
-- 3. Grant a seat (comp today; the purchase webhook calls this later)
-- ---------------------------------------------------------------------------
create or replace function public.grant_guardian_seat(
  p_player_id       uuid,
  p_user_id         uuid,
  p_source          text default 'comp',
  p_external_txn_id text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); seat_id uuid;
begin
  -- Today only a super admin can mint a seat. The future purchase path runs as
  -- the service role (auth.uid() is null there), which is why that case is
  -- allowed explicitly rather than falling through to the super-admin check.
  if uid is not null and not is_super_admin() then
    raise exception 'Not allowed to grant a guardian seat';
  end if;

  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'No such player';
  end if;

  if exists (select 1 from parent_player_links
              where player_id = p_player_id and parent_user_id = p_user_id) then
    raise exception 'That person is already a guardian of this player';
  end if;

  insert into player_guardian_seats
    (player_id, granted_to_user_id, source, external_txn_id, granted_by_user_id)
  values
    (p_player_id, p_user_id, p_source, p_external_txn_id, uid)
  on conflict (player_id, granted_to_user_id) where revoked_at is null
  do nothing
  returning id into seat_id;

  if seat_id is null then
    select id into seat_id from player_guardian_seats
     where player_id = p_player_id and granted_to_user_id = p_user_id and revoked_at is null;
  end if;

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'grant_guardian_seat', p_user_id, 'player_guardian_seats', seat_id,
          jsonb_build_object('player_id', p_player_id, 'source', p_source,
                             'external_txn_id', p_external_txn_id));

  return seat_id;
end $$;
grant execute on function public.grant_guardian_seat(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cap check honours a live seat
--    Unchanged from the previous definition except the `n >= 4` branch.
-- ---------------------------------------------------------------------------
create or replace function public.claim_or_link_guardian(p_code text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p_id uuid; n int; has_seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
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
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt where pt.player_id = p_id
  on conflict (team_id, user_id, role) do nothing;

  return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Preview tells the UI whether this viewer can get in, and how
--    Adds has_seat + can_buy_seat. Existing keys are unchanged so the current
--    client keeps working if it ships ahead of the new screen.
-- ---------------------------------------------------------------------------
create or replace function public.preview_guardian_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p_id uuid; nm text; n int; mine boolean; seat boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;
  select split_part(name, ' ', 1) into nm from players where id = p_id;
  select count(*) into n from parent_player_links where player_id = p_id;
  select exists (select 1 from parent_player_links where player_id = p_id and parent_user_id = uid) into mine;
  select exists (
    select 1 from player_guardian_seats
     where player_id = p_id and granted_to_user_id = uid and revoked_at is null
  ) into seat;
  return jsonb_build_object(
    'player_id', p_id,
    'first_name', nm,
    'guardian_count', n,
    'already_mine', mine,
    'has_seat', seat,
    -- `full` keeps its original meaning (the free 4 are gone) so existing UI is
    -- unaffected; a viewer holding a seat is full-but-not-blocked.
    'full', n >= 4,
    'can_buy_seat', (n >= 4 and not mine and not seat)
  );
end $$;

notify pgrst, 'reload schema';
