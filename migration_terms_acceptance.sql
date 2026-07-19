-- ============================================================
-- Terms/EULA acceptance (App Store Guideline 1.2 — users must affirmatively
-- agree to a EULA prohibiting objectionable content + abusive users before
-- posting). Stored on user_profiles; the TermsGate in app/_layout.tsx blocks
-- the app until accepted. user_profiles has no client UPDATE policy, so the
-- write goes through a SECURITY DEFINER RPC (mirrors set_my_display_name).
-- Idempotent.
-- ============================================================

BEGIN;

alter table user_profiles add column if not exists accepted_terms_at      timestamptz;
alter table user_profiles add column if not exists accepted_terms_version int;

create or replace function accept_terms(p_version int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into user_profiles (user_id, accepted_terms_at, accepted_terms_version, updated_at)
  values (auth.uid(), now(), p_version, now())
  on conflict (user_id) do update
    set accepted_terms_at = now(), accepted_terms_version = excluded.accepted_terms_version, updated_at = now();
$$;

grant execute on function accept_terms(int) to authenticated;

notify pgrst, 'reload schema';

COMMIT;
