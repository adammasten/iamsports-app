-- ============================================================
-- RLS helper functions — idempotent (CREATE OR REPLACE).
-- Used by RLS policies to gate access by super-admin status and
-- to resolve the effective (possibly impersonated) user id.
-- Both are SECURITY DEFINER + STABLE with a locked search_path.
-- Depends on super_admins (migration_superadmin_audit.sql).
-- ============================================================

-- 1. is_super_admin() — true when the current user is a super admin.
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = auth.uid());
$$;

-- 2. effective_user_id() — the user the current user is acting as
--    (impersonation target) when set, otherwise the current user.
CREATE OR REPLACE FUNCTION effective_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT acting_as_user_id FROM super_admins WHERE user_id = auth.uid()),
    auth.uid()
  );
$$;

-- Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
