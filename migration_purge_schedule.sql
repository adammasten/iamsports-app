-- =====================================================================
-- Schedule the 30-day purge. APPLIED LIVE via the Supabase MCP (cron.schedule).
--
-- Auth: the cron authenticates to the purge-deleted edge function with the
-- NARROW 'purge_secret' (see migration_purge_secret_and_reader.sql), read from
-- Vault at call time — NOT the service-role key. pg_cron + pg_net + supabase_vault
-- are enabled; the edge function purge-deleted is deployed and gated on that
-- secret. This whole file was applied by Claude via the MCP — no manual step.
-- =====================================================================

-- Runs daily at 04:00 UTC. Reads the gate secret from Vault and POSTs to the
-- edge function, which purges only rows soft-deleted > 30 days ago.
select cron.schedule(
  'purge-deleted-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url     := 'https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/purge-deleted',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_secret'),
      'Content-Type',  'application/json'
    )
  );
  $$
);

-- To verify / manage later:
--   select * from cron.job;                          -- see the schedule
--   select * from cron.job_run_details order by start_time desc limit 5;  -- recent runs
--   select id, status_code, content from net._http_response order by id desc limit 5;  -- function replies
--   select cron.unschedule('purge-deleted-daily');   -- remove it
-- =====================================================================
