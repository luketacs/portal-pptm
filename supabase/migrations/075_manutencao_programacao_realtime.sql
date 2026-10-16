-- Migration: 075_manutencao_programacao_realtime
-- Aviso "Esta tela está desatualizada" na Programação: a tela assina as mudanças de
-- manutencao_programacao pelo Supabase Realtime (postgres_changes), e isso só funciona
-- com a tabela na publicação supabase_realtime. Idempotente — pode rodar de novo.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'manutencao_programacao'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.manutencao_programacao;
  END IF;
END $$;
