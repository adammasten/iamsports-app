-- =====================================================================
-- Narrow purge-only gate secret + reader for the purge-deleted edge function.
-- APPLIED LIVE via the Supabase MCP (migration: purge_secret_and_reader).
--
-- Why this exists: the daily purge cron must authenticate to the purge-deleted
-- edge function. Rather than store the god-mode service-role key in the cron
-- (the original plan, which needed a human to paste the key), the cron carries
-- THIS narrow secret, which grants nothing but "trigger the purge." The edge
-- function reads the same secret from Vault (via get_purge_secret) to compare.
-- The secret value below is redacted here — the real one lives only in Vault.
-- =====================================================================

-- 1) Store the gate secret in Vault (the real value was generated with
--    `openssl rand -hex 32` and stored via the MCP; do NOT commit it here).
select vault.create_secret('<REDACTED-32-BYTE-HEX>', 'purge_secret');

-- 2) SECURITY DEFINER reader so the edge function (service_role) can fetch the
--    secret to compare against the incoming bearer, without a broad Vault grant.
create or replace function public.get_purge_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'purge_secret' limit 1;
$$;

revoke all on function public.get_purge_secret() from public, anon, authenticated;
grant execute on function public.get_purge_secret() to service_role;
-- =====================================================================
