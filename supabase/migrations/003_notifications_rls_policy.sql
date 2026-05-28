-- Migration: 003_notifications_rls_policy
-- Permite que usuários autenticados insiram notificações para qualquer destinatário
-- (necessário para que admins possam notificar solicitantes sobre materiais, status, etc.)
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- Verificar e adicionar política se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notifications'
      AND policyname = 'Authenticated users can insert notifications'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Authenticated users can insert notifications"
        ON notifications
        FOR INSERT
        WITH CHECK (auth.uid() IS NOT NULL)
    $pol$;
  END IF;
END;
$$;
