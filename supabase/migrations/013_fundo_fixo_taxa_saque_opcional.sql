-- Migration: 013_fundo_fixo_taxa_saque_opcional
-- A taxa do saque só é conhecida quando a fatura do cartão fecha — não no
-- momento do saque. Torna a coluna opcional (NULL = "ainda não sei") e
-- adiciona a política de UPDATE que faltava para poder preenchê-la depois.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_saques ALTER COLUMN taxa DROP NOT NULL;
ALTER TABLE fundo_fixo_saques ALTER COLUMN taxa DROP DEFAULT;

-- 'saque' = saque real do cartão (entra no total do mês, pra bater com a fatura).
-- 'ajuste_inicial' = saldo que a pessoa já tinha em mãos antes de começar a usar o
-- portal — soma no saldo em caixa, mas NÃO é um lançamento do cartão, então não
-- deve entrar no total do mês que precisa bater com a fatura.
ALTER TABLE fundo_fixo_saques
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'saque';

DROP POLICY IF EXISTS "auth_update_fundo_fixo_saques" ON fundo_fixo_saques;
CREATE POLICY "auth_update_fundo_fixo_saques" ON fundo_fixo_saques
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_delete_fundo_fixo_saques" ON fundo_fixo_saques;
CREATE POLICY "auth_delete_fundo_fixo_saques" ON fundo_fixo_saques
  FOR DELETE USING (auth.uid() IS NOT NULL);
