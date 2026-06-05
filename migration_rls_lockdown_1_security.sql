-- ============================================================
-- RLS lockdown 1 of N — SECURITY TABLES.
-- Replaces the allow_all placeholder policies on the two
-- security-control tables with real policies:
--
--   super_admins     — full access (SELECT/INSERT/UPDATE/DELETE)
--                      restricted to existing super admins only.
--   admin_audit_log  — append-only: any authenticated user may
--                      INSERT; only super admins may SELECT; no
--                      UPDATE/DELETE policy exists, so (with RLS
--                      enabled) updates and deletes are denied to
--                      everyone going through the API.
--
-- Depends on: migration_superadmin_audit.sql (tables) and
--             migration_rls_helpers.sql (is_super_admin()).
-- ============================================================

-- super_admins: super-admin-only full access
DROP POLICY IF EXISTS allow_all_super_admins ON super_admins;
CREATE POLICY super_admins_full_access ON super_admins
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- admin_audit_log: append-only, super-admin read
DROP POLICY IF EXISTS allow_all_admin_audit_log ON admin_audit_log;
CREATE POLICY audit_read_superadmin ON admin_audit_log
  FOR SELECT
  USING (is_super_admin());
CREATE POLICY audit_insert_authenticated ON admin_audit_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
