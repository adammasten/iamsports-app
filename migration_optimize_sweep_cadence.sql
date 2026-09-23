-- Tighten the optimize sweep so a stalled video is picked up in minutes, not half
-- an hour. Two changes, no structural change to the sweep itself.
--
-- 1. Cron every 2 minutes instead of 5.
-- 2. The "settle" gate drops from 30 minutes to 5. The original 30 was a guess at
--    "past a normal job's runtime", to avoid re-firing while a legitimate transcode
--    was still running. That caution is no longer needed: Railway's /optimize
--    (server commit 6f933c9) returns the EXISTING jobId for a key already being
--    optimized and starts nothing, so firing during a job is a cheap no-op. The
--    5 minutes that remain just avoid racing the client's own kickoff.
--
-- The per-row backoff stays at 30 minutes and the give-up cap stays at 5 attempts,
-- so this makes DETECTION faster without making RETRIES more aggressive.

create or replace function public.sweep_stalled_optimizes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id  uuid;
  v_url text;
begin
  -- ONE row per tick, deliberately: N concurrent CPU-bound transcodes on a single
  -- Railway container is exactly what /optimize-all avoids by running sequentially.
  select id, url into v_id, v_url
  from public.videos
  where deleted_at is null
    and original_url is null             -- never processed
    and url not ilike '%-720%'           -- legacy rows: an optimized key with a NULL original_url
    and upload_status = 'ready'          -- bytes are CONFIRMED landed. NOT "<> 'failed'":
                                         -- that lets 'uploading' through, and a multi-GB
                                         -- game sits in 'uploading' far longer than the
                                         -- age gate — we'd hand Railway a partial file.
    and created_at < now() - interval '5 minutes'    -- don't race the client's own kickoff
    and (optimize_last_attempt_at is null
         or optimize_last_attempt_at < now() - interval '30 minutes')  -- per-row backoff
    and optimize_attempts < 5            -- give up; >= 5 needs a human (Retry in the UI)
  order by created_at
  limit 1
  for update skip locked;

  if v_id is null then
    return 0;
  end if;

  -- pg_net is async and its response storage is UNLOGGED, so the reply is
  -- deliberately not depended on: success is proven by the row no longer matching
  -- this filter once Railway sets original_url.
  perform net.http_post(
    url     := 'https://web-production-1bf7f.up.railway.app/optimize',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object('key', v_url)
  );

  update public.videos
     set optimize_attempts        = optimize_attempts + 1,
         optimize_last_attempt_at = now()
   where id = v_id;

  raise log 'sweep_stalled_optimizes: re-fired optimize for video % (key %)', v_id, v_url;
  return 1;
end;
$fn$;

revoke execute on function public.sweep_stalled_optimizes() from public;
revoke execute on function public.sweep_stalled_optimizes() from anon;
revoke execute on function public.sweep_stalled_optimizes() from authenticated;

-- Re-schedule: same job name, so this replaces the existing 5-minute entry.
select cron.schedule(
  'sweep-stalled-optimizes',
  '*/2 * * * *',
  $cron$ select public.sweep_stalled_optimizes(); $cron$
);
