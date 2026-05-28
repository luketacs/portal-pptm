-- Migration: 002_audit_logs
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   TEXT         NOT NULL DEFAULT 'Sistema',
  event_type  TEXT         NOT NULL,   -- 'login', 'logout', 'password_change', 'request_created', etc.
  resource_type TEXT,                  -- 'auth', 'request', 'material', 'user'
  resource_id   TEXT,                  -- UUID or code do recurso afetado
  description TEXT         NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id     ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type  ON audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource    ON audit_logs (resource_type, resource_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Apenas Admin pode ler todos os logs
CREATE POLICY "Admins podem ler audit_logs" ON audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );

-- Qualquer usuário autenticado pode inserir (para registrar seus próprios eventos)
CREATE POLICY "Usuarios autenticados podem inserir em audit_logs" ON audit_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
