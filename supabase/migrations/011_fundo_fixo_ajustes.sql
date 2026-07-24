-- Migration: 011_fundo_fixo_ajustes
-- 1) Campo de link do produto (compras pela internet)
-- 2) Corrige via SQL o bucket/políticas de Storage do Fundo Fixo — a criação manual
--    pelo Dashboard (migration 010) ficou incompleta e gerou o erro
--    "new row violates row-level security policy" ao anexar orçamento/nota fiscal.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1. Link do produto
ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS link_produto TEXT;

-- 2. Garante que o bucket existe com a configuração correta (cria ou corrige)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fundo-fixo-anexos', 'fundo-fixo-anexos', true, 15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public              = true,
  file_size_limit      = 15728640,
  allowed_mime_types   = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

-- 3. Políticas de storage.objects para o bucket (a causa real do erro de RLS)
DROP POLICY IF EXISTS "fundo_fixo_anexos_insert" ON storage.objects;
DROP POLICY IF EXISTS "fundo_fixo_anexos_select" ON storage.objects;

CREATE POLICY "fundo_fixo_anexos_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'fundo-fixo-anexos' AND auth.uid() IS NOT NULL);

CREATE POLICY "fundo_fixo_anexos_select" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'fundo-fixo-anexos');

-- Verificação: confirma que as políticas foram criadas
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'fundo_fixo%';
