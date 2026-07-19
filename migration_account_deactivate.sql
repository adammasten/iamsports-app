-- ============================================================
-- Account deactivate/reactivate (reversible "take a break").
--
-- Adds a soft deactivated_at flag to user_profiles + two SECURITY DEFINER RPCs
-- to set/clear it. user_profiles has no client UPDATE policy (writes go through
-- SECURITY DEFINER functions — mirrors set_my_display_name), so the app calls
-- these RPCs rather than updating the table directly.
--
-- Reversible by design: reactivate_my_account() runs on the next login (see the
-- name-capture gate in app/_layout.tsx). Distinct from ACCOUNT DELETION, which
-- is the delete-account Edge Function (supabase/functions/delete-account).
-- Idempotent.
-- ============================================================

BEGIN;

alter table user_profiles add column if not exists deactivated_at timestamptz;

create or replace function deactivate_my_account()
returns void
language sql
security definer
set search_path = public
as $$
  insert into user_profiles (user_id, deactivated_at, updated_at)
  values (auth.uid(), now(), now())
  on conflict (user_id) do update set deactivated_at = now(), updated_at = now();
$$;

create or replace function reactivate_my_account()
returns void
language sql
security definer
set search_path = public
as $$
  update user_profiles set deactivated_at = null, updated_at = now()
  where user_id = auth.uid();
$$;

grant execute on function deactivate_my_account() to authenticated;
grant execute on function reactivate_my_account() to authenticated;

notify pgrst, 'reload schema';

COMMIT;
