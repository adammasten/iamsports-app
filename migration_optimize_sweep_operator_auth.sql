-- migration_optimize_sweep_operator_auth.sql
--
-- WHY. public.sweep_stalled_optimizes() re-fires a stalled video optimize every 2 minutes
-- (pg_cron job `sweep-stalled-optimizes`) by POSTing to the Railway render server. It sent
-- NO authorization header, because Railway had no authentication at all. Railway's
-- /optimize now requires either a user JWT or the operator secret, and a pg_cron job has
-- no user identity — so the sweep must present the operator secret.
--
-- Without this migration, enabling Railway auth silently breaks the self-healing sweep:
-- uploads stop becoming playable and nothing surfaces an error.
--
-- THE SECRET IS NOT IN THIS FILE. It is read at call time from Vault, the same pattern the
-- `purge-deleted-daily` cron job already uses for `purge_secret`. Store it ONCE, by hand,
-- and never in a committed file or a migration:
--
--     select vault.create_secret(
--       '<the Railway OPERATOR_SECRET value>',
--       'railway_operator_secret',
--       'Operator secret for Railway /optimize + maintenance routes'
--     );
--
-- To rotate later:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'railway_operator_secret'),
--       '<new value>'
--     );
--
-- ORDER OF OPERATIONS (both directions are safe):
--   * Apply this migration BEFORE Railway enforcement and the sweep keeps working either
--     way: Railway ignores an unknown header while REQUIRE_USER_AUTH is off.
--   * If the Vault secret is missing, the function REFUSES to fire and returns -1 WITHOUT
--     incrementing optimize_attempts. That matters: firing unauthenticated would 401 and
--     burn one of only 5 attempts per video every 2 minutes, permanently abandoning videos
--     within ~10 minutes. Failing closed and loudly is the safe behaviour.
--
-- REVERT. The previous definition is preserved at the bottom of this file; running that
-- block restores the exact prior function. No schema, table, column, cron schedule, RLS
-- policy or grant is touched by this migration — it replaces one function body.

create or replace function public.sweep_stalled_optimizes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id     uuid;
  v_url    text;
  v_secret text;
begin
  -- Operator secret first: if it is not configured, do NOT fire and do NOT consume an
  -- attempt. Returns -1 so a caller (or a log reader) can tell "not configured" apart
  -- from "nothing to do" (0) and "fired one" (1).
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'railway_operator_secret';

  if v_secret is null or length(v_secret) = 0 then
    raise log 'sweep_stalled_optimizes: railway_operator_secret is not set in Vault — refusing to fire an unauthenticated optimize';
    return -1;
  end if;

  select id, url into v_id, v_url
  from public.videos
  where deleted_at is null
    and original_url is null
    and url not ilike '%-720%'
    and upload_status = 'ready'
    and created_at < now() - interval '5 minutes'
    and (optimize_last_attempt_at is null
         or optimize_last_attempt_at < now() - interval '30 minutes')
    and optimize_attempts < 5
  order by created_at
  limit 1
  for update skip locked;

  if v_id is null then
    return 0;
  end if;

  perform net.http_post(
    url     := 'https://web-production-1bf7f.up.railway.app/optimize',
    headers := jsonb_build_object(
                 'Content-Type',      'application/json',
                 'x-operator-secret', v_secret
               ),
    body    := jsonb_build_object('key', v_url)
  );

  update public.videos
     set optimize_attempts        = optimize_attempts + 1,
         optimize_last_attempt_at = now()
   where id = v_id;

  raise log 'sweep_stalled_optimizes: re-fired optimize for video % (key %)', v_id, v_url;
  return 1;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- REVERT (previous definition, verbatim — run only to roll back):
--
-- create or replace function public.sweep_stalled_optimizes()
-- returns integer language plpgsql security definer set search_path to 'public'
-- as $function$
-- declare
--   v_id  uuid;
--   v_url text;
-- begin
--   select id, url into v_id, v_url
--   from public.videos
--   where deleted_at is null
--     and original_url is null
--     and url not ilike '%-720%'
--     and upload_status = 'ready'
--     and created_at < now() - interval '5 minutes'
--     and (optimize_last_attempt_at is null
--          or optimize_last_attempt_at < now() - interval '30 minutes')
--     and optimize_attempts < 5
--   order by created_at
--   limit 1
--   for update skip locked;
--
--   if v_id is null then
--     return 0;
--   end if;
--
--   perform net.http_post(
--     url     := 'https://web-production-1bf7f.up.railway.app/optimize',
--     headers := '{"Content-Type":"application/json"}'::jsonb,
--     body    := jsonb_build_object('key', v_url)
--   );
--
--   update public.videos
--      set optimize_attempts        = optimize_attempts + 1,
--          optimize_last_attempt_at = now()
--    where id = v_id;
--
--   raise log 'sweep_stalled_optimizes: re-fired optimize for video % (key %)', v_id, v_url;
--   return 1;
-- end;
-- $function$;
