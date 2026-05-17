-- Impersonation audit log
CREATE TABLE IF NOT EXISTS impersonation_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  target_user_id UUID NOT NULL REFERENCES auth.users(id),
  target_display_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ
);

-- Index for querying by admin
CREATE INDEX IF NOT EXISTS idx_impersonation_audit_admin ON impersonation_audit_log(admin_id);

-- Index for querying by target user
CREATE INDEX IF NOT EXISTS idx_impersonation_audit_target ON impersonation_audit_log(target_user_id);

-- RLS: only admins can read, service role can do everything
ALTER TABLE impersonation_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role has full access (edge function uses service role)
CREATE POLICY "Service role can do everything" ON impersonation_audit_log
  FOR ALL USING (auth.role() = 'service_role');

-- Admins can read their own impersonation history
CREATE POLICY "Admins can read own history" ON impersonation_audit_log
  FOR SELECT USING (auth.uid() = admin_id);
