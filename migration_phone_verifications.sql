-- =====================================================================
-- Stage 6 UI: phone verification (OTP) + self opt-out.
-- APPLIED LIVE via the Supabase MCP (migration: phone_verifications + clear_my_phone).
-- One pending OTP per user, code stored HASHED with a 10-min expiry; written/read
-- only by the send-phone-code / check-phone-code edge functions (service role).
-- =====================================================================
create table public.phone_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.phone_verifications enable row level security;  -- service-role only

-- Self opt-out: clears the profile's phone + verification and opts the number out
-- (user_profiles has no self-UPDATE policy, so this SECURITY DEFINER RPC is the path).
create or replace function public.clear_my_phone() returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  select phone_number into v_phone from public.user_profiles where user_id = auth.uid();
  update public.user_profiles set phone_number = null, phone_verified_at = null where user_id = auth.uid();
  if v_phone is not null then
    insert into public.sms_opt_outs(phone_number, opted_out_at) values (v_phone, now())
    on conflict (phone_number) do update set opted_out_at = now(), opted_back_in_at = null;
  end if;
end;
$$;
grant execute on function public.clear_my_phone() to authenticated;
-- Edge fns: send-phone-code (Twilio, env-gated → 503 not_enabled until configured),
-- check-phone-code (records phone_verified_at + consent trail). Client: lib/core/phone.ts,
-- UI: app/text-alerts.tsx (with the required consent disclosure).
-- =====================================================================
