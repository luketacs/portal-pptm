-- Migration: 005_fix_audit_logs_rls
-- Corrige as políticas RLS da tabela audit_logs para que Admin veja TODOS os registros.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1. Remove políticas antigas (se existirem) para recriar corretamente
DROP POLICY IF EXISTS "Admins podem ler audit_logs"                        ON audit_logs;
DROP POLICY IF EXISTS "Usuarios autenticados podem inserir em audit_logs"  ON audit_logs;

-- 2. Garante que RLS está habilitado
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. Admin pode ler TODOS os logs (sem filtro de user_id)
CREATE POLICY "admin_select_all_audit_logs" ON audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id   = auth.uid()
        AND profiles.role = 'Admin'
    )
  );

-- 4. Qualquer usuário autenticado pode inserir seus próprios logs
CREATE POLICY "authenticated_insert_audit_logs" ON audit_logs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Verificação: lista as políticas ativas na tabela
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'audit_logs';
