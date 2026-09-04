-- Signup hardening: require First name + Last name + an 18+ confirmation.
--
-- The app is adults-only (guardians/coaches manage youth footage; kids are not
-- users). This captures a real first/last name (was a single free-text "name"
-- box that accepted junk like "Adam.Adyem") and an affirmative "I am 18 or older"
-- attestation at the first-run gate, before any app access.
--
-- Enforcement lives at the universal NameCaptureGate (app/_layout.tsx), which runs
-- for EVERY new user regardless of signup path (email+password OR the passwordless
-- email-code flow) — so both paths are covered. Existing users are re-prompted once
-- (adult_confirmed_at starts null); their old display_name pre-fills the fields.

alter table public.user_profiles
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists adult_confirmed_at timestamptz;

-- Replaces set_my_display_name for the new gate. Requires first + last + the 18+
-- attestation; keeps display_name = "First Last" so every existing reader (shares,
-- rosters, comments) is unchanged. Idempotent on adult_confirmed_at (first stamp wins).
create or replace function public.set_my_profile(p_first text, p_last text, p_adult boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
        f text := nullif(btrim(p_first), '');
        l text := nullif(btrim(p_last),  '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if f is null or l is null then raise exception 'Please enter your first and last name.'; end if;
  if p_adult is not true then raise exception 'You must confirm you are 18 or older to use IamSports.'; end if;

  update public.user_profiles
     set first_name = f,
         last_name  = l,
         display_name = f || ' ' || l,
         adult_confirmed_at = coalesce(adult_confirmed_at, now()),
         updated_at = now()
   where user_id = uid;
  if not found then
    insert into public.user_profiles (user_id, first_name, last_name, display_name, adult_confirmed_at)
    values (uid, f, l, f || ' ' || l, now());
  end if;
end
$function$;
