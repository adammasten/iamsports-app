-- ============================================================
-- 20260928230000_process_notifications_cron_auth.sql
--
-- Closes anonymous internet access to the process-notifications Edge Function.
--
-- THE GAP. process-notifications ran verify_jwt=false with NO auth gate at all — its
-- handler did not even read the request:
--     Deno.serve(async () => { expand(); dispatchPush(); dispatchSms(); ... })
-- and its pg_cron job sent only a Content-Type header. So any caller on the internet
-- could trigger privileged work: service-role reads/writes over notification_outbox
-- and schedule_notifications, plus outbound HTTP to Expo and web-push — and, once
-- TWILIO_* is configured, the SMS sender. Verified before this change: an anonymous
-- POST returned 200 {"expanded":0,"dispatched":0,"sms":0}.
--
-- WHAT IT COULD NOT DO, for accurate scoping: it could not create notifications,
-- bypass quiet hours, send before send_after, duplicate rows (expansion upserts on
-- dedupe_key with ignoreDuplicates, and both dispatchers claim rows with an atomic
-- update ... where status='queued'), or read user data (the response is only counts).
-- So this was an unauthenticated trigger of privileged work and a cost/DoS
-- amplification vector, not a data breach.
--
-- THE MODEL. Mirrors purge-deleted, the existing in-repo idiom for a cron-invoked
-- Edge Function: a dedicated high-entropy secret lives in Vault, pg_cron reads it
-- inline and sends it as `Authorization: Bearer <secret>`, and the function reads the
-- expected value through a SECURITY DEFINER RPC granted only to service_role. One
-- source of truth means rotation is a single UPDATE, with no chance of the function
-- and the cron job drifting apart.
--
-- Chosen over a separate Edge-Function env secret deliberately: two copies of the
-- same secret in two systems is the configuration that silently breaks on rotation.
-- The cost is one extra ~50ms Vault read per minute, which is immaterial here.
--
-- THE SECRET VALUE IS GENERATED INSIDE THE DATABASE (gen_random_bytes) and is never
-- selected, logged, or returned — it does not pass through any client or transcript.
--
-- ORDERING NOTE: this migration creates the secret and starts SENDING the header, but
-- the function does not yet ENFORCE it. That order is intentional — the new header is
-- ignored by the currently deployed function, so there is no window in which cron is
-- rejected. The enforcing version of process-notifications is deployed immediately
-- after this migration.
-- ============================================================

-- 1. Dedicated Vault secret. 32 random bytes hex-encoded => 64 chars, matching the
--    entropy of the existing purge_secret / railway_operator_secret.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'process_notifications_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'process_notifications_secret',
      'Gate secret for the process-notifications Edge Function. pg_cron sends it as a Bearer token; the function verifies it via get_process_notifications_secret(). Rotate by updating this secret only — both sides read it from here.'
    );
  end if;
end $$;

-- 2. Reader RPC. SECURITY DEFINER with an empty search_path, exactly like
--    get_purge_secret(). Only the function's service-role client may call it.
create or replace function public.get_process_notifications_secret()
returns text
language sql
security definer
set search_path to ''
as $function$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'process_notifications_secret' limit 1;
$function$;

-- Lock it down: no anon, no authenticated, no PUBLIC. Only service_role (the Edge
-- Function's own client) and the owner. Mirrors get_purge_secret's ACL.
revoke all on function public.get_process_notifications_secret() from public;
revoke all on function public.get_process_notifications_secret() from anon;
revoke all on function public.get_process_notifications_secret() from authenticated;
grant execute on function public.get_process_notifications_secret() to service_role;

-- 3. Cron now authenticates. cron.schedule() upserts by jobname, so this replaces the
--    existing unauthenticated job in place. Schedule ('* * * * *') and body are
--    unchanged; only the Authorization header is added.
select cron.schedule(
  'process-notifications',
  '* * * * *',
  $cron$
  select net.http_post(
    url     := 'https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/process-notifications',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'process_notifications_secret'),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
