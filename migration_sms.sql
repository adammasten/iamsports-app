-- =====================================================================
-- Stage 6 scaffolding: SMS (Twilio). APPLIED LIVE via the Supabase MCP
-- (migration: sms_scaffolding). Backend only — sends nothing until the Twilio
-- secrets (TWILIO_ACCOUNT_SID / _AUTH_TOKEN / _FROM) are set AND A2P 10DLC clears.
-- See SMS_A2P_REGISTRATION.md.
-- =====================================================================
alter table public.user_profiles add column if not exists phone_number text;
alter table public.user_profiles add column if not exists phone_verified_at timestamptz;
alter table public.user_profiles add column if not exists phone_consent_at timestamptz;      -- compliance: proof of opt-in
alter table public.user_profiles add column if not exists phone_consent_source text;

-- Opt-outs at the PHONE-NUMBER level (numbers move between families). Managed by the
-- sms-inbound webhook (STOP/START). Service-role only.
create table public.sms_opt_outs (
  phone_number text primary key,
  opted_out_at timestamptz not null default now(),
  opted_back_in_at timestamptz
);
alter table public.sms_opt_outs enable row level security;

-- SMS-eligible recipients = normal event recipients who ALSO have a verified,
-- consented phone that isn't opted out.
create or replace function public.resolve_event_sms_recipients(p_event_id uuid, p_exclude uuid default null)
returns table (recipient_user_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select r.recipient_user_id, up.phone_number
  from public.resolve_event_recipients(p_event_id, p_exclude) r
  join public.user_profiles up on up.user_id = r.recipient_user_id
  where up.phone_number is not null and up.phone_verified_at is not null and up.phone_consent_at is not null
    and not exists (select 1 from public.sms_opt_outs o where o.phone_number = up.phone_number and o.opted_back_in_at is null);
$$;
grant execute on function public.resolve_event_sms_recipients(uuid, uuid) to service_role;

create or replace function public.sms_target(p_user_id uuid)
returns table (recipient_user_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select up.user_id, up.phone_number
  from public.user_profiles up
  where up.user_id = p_user_id
    and up.phone_number is not null and up.phone_verified_at is not null and up.phone_consent_at is not null
    and not exists (select 1 from public.sms_opt_outs o where o.phone_number = up.phone_number and o.opted_back_in_at is null);
$$;
grant execute on function public.sms_target(uuid) to service_role;
-- Worker process-notifications: dispatchSms() (Twilio, env-gated, → skipped:no_sms_config
-- until configured). Webhooks: sms-inbound (STOP/START), sms-status (delivery → 3-state).
-- =====================================================================
