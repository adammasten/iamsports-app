-- ============================================================
-- Super admins & admin audit log — ADDITIVE ONLY. Nothing dropped.
-- Adds super_admins (with impersonation support) and an
-- admin_audit_log. Safe to re-run (idempotent): guarded with
-- IF NOT EXISTS / existence checks.
-- ============================================================

BEGIN;

-- 1. super_admins
CREATE TABLE IF NOT EXISTS super_admins (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at          timestamptz NOT NULL DEFAULT now(),
  note                text,
  acting_as_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. admin_audit_log
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action              text NOT NULL,
  target_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_table        text,
  target_id           uuid,
  detail              jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor   ON admin_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target  ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at);

-- 4. RLS — allow_all placeholders, matching the existing tables
ALTER TABLE super_admins    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'super_admins' AND policyname = 'allow_all_super_admins') THEN
    CREATE POLICY allow_all_super_admins ON super_admins FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_audit_log' AND policyname = 'allow_all_admin_audit_log') THEN
    CREATE POLICY allow_all_admin_audit_log ON admin_audit_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;

-- 5. Schema cache trap — force PostgREST to reload
NOTIFY pgrst, 'reload schema';
