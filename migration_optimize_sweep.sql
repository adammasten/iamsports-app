-- Optimize sweep: self-healing retry for videos that uploaded but never got
-- processed into a streamable 720p faststart copy.
--
-- WHY: optimize is kicked off by a single fire-and-forget fetch from the phone
-- (lib/native/optimize.ts). If that one request never lands — backgrounding, a
-- network change, a Railway restart — nothing retries and nothing notices. The
-- video sits upload_status='ready' with a raw url that will not stream in a
-- browser, silently and permanently. This sweep is the safety net.
--
-- Railway's /optimize is idempotent as of server commit 6f933c9 (in-flight
-- dedupe by object key + an already-optimized pre-check), so re-firing for a
-- job that is still running returns the SAME jobId and starts nothing. That is
-- why this sweep is safe to run on a schedule.

-- ── 1. Data repair: "Full Game" (d35160ee) ─────────────────────────────────
-- Two live videos rows point at the SAME storage object. One has original_url
-- set correctly; this one was left NULL (a duplicate row pointing at an already
-- optimized object). A NULL original_url is how the sweep recognises "never
-- processed", so this row would look eligible forever — and because Railway
-- updates by `.eq('url', key)`, re-optimizing it would repoint BOTH rows and
-- destroy the healthy one's master reference. Fill in the blank so the anomaly
-- is gone rather than relying on a filename check to dodge it.
update public.videos
   set original_url = 'team-7f1122bd-f2e6-4006-adf7-728ff3709cc5-1786734647909-0.mp4'
 where id = 'd35160ee-1413-45ea-856b-fd0bd44b5941'
   and original_url is null;

-- ── 2. The sweep's memory ──────────────────────────────────────────────────
-- Without these, a video that can NEVER succeed (before 2026-09-22 that was
-- every vertically-shot video) is retried every 5 minutes forever: no backoff,
-- no give-up, no visibility. Additive and nullable-safe — no app build reads
-- them, so installed clients are unaffected.
alter table public.videos
  add column if not exists optimize_attempts integer not null default 0,
  add column if not exists optimize_last_attempt_at timestamptz;

comment on column public.videos.optimize_attempts is
  'How many times the sweep has re-fired /optimize for this row. Caps retries; >= 5 means it needs a human.';
comment on column public.videos.optimize_last_attempt_at is
  'When the sweep last re-fired /optimize for this row. Drives the 30-minute backoff.';

-- ── 3. The sweep ───────────────────────────────────────────────────────────
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
  -- ONE row per tick, deliberately. Firing every eligible row at once would
  -- start N concurrent CPU-bound transcodes on a single Railway container —
  -- the same reason /optimize-all processes sequentially.
  select id, url into v_id, v_url
  from public.videos
  where deleted_at is null
    and original_url is null             -- never processed
    and url not ilike '%-720%'           -- belt-and-braces: not already an optimized key
    and upload_status <> 'failed'        -- dead/abandoned uploads are not ours to fix
    and created_at < now() - interval '30 minutes'   -- past a normal job's runtime
    and (optimize_last_attempt_at is null
         or optimize_last_attempt_at < now() - interval '30 minutes')  -- backoff
    and optimize_attempts < 5            -- give up; >= 5 is a human's problem
  order by created_at
  limit 1
  for update skip locked;

  if v_id is null then
    return 0;
  end if;

  -- Fire and record. pg_net is async and its response storage is UNLOGGED, so
  -- we deliberately do not depend on the reply: success is proven by the row no
  -- longer matching this filter (Railway sets original_url when it finishes).
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

-- Not callable by clients: this is cron-only plumbing, and SECURITY DEFINER
-- functions grant EXECUTE to public by default.
revoke execute on function public.sweep_stalled_optimizes() from public;
revoke execute on function public.sweep_stalled_optimizes() from anon;
revoke execute on function public.sweep_stalled_optimizes() from authenticated;

-- ── 4. Schedule it ─────────────────────────────────────────────────────────
select cron.schedule(
  'sweep-stalled-optimizes',
  '*/5 * * * *',
  $cron$ select public.sweep_stalled_optimizes(); $cron$
);
