-- =====================================================================
-- Schedule the 30-day purge (run in the Supabase SQL editor by Adam).
-- Needs the SERVICE-ROLE key, which Claude doesn't have — that's why this
-- one step is yours. pg_cron + pg_net are already enabled; the edge function
-- purge-deleted is already deployed and gated to the service-role key.
-- =====================================================================

-- 1) Store the service-role key in Vault (ONCE). Get it from:
--    Supabase Dashboard → Project Settings → API → "service_role" secret.
select vault.create_secret('PASTE_SERVICE_ROLE_KEY_HERE', 'service_role_key');

-- 2) Schedule the purge daily at 04:00 UTC. It calls the edge function with the
--    key from Vault; the function only touches rows soft-deleted > 30 days ago.
select cron.schedule(
  'purge-deleted-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url     := 'https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/purge-deleted',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type',  'application/json'
    )
  );
  $$
);

-- To verify / manage later:
--   select * from cron.job;                          -- see the schedule
--   select * from cron.job_run_details order by start_time desc limit 5;  -- recent runs
--   select cron.unschedule('purge-deleted-daily');   -- remove it
-- =====================================================================
