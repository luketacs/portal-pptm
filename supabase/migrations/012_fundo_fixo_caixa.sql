-- Migration: 012_fundo_fixo_caixa
-- Controle de saques em dinheiro do cartão (o admin saca, fica com o valor em
-- caixa e paga/reembolsa compras em dinheiro) e da forma de pagamento de cada
-- compra, para que o total do mês no portal bata com a fatura do cartão.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1. Forma como a compra foi paga (definida só no momento de registrar a compra)
ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT NOT NULL DEFAULT 'cartao';
  -- 'cartao' | 'dinheiro_caixa' | 'reembolso'

-- 1b. Exclusão de solicitações (a política de DELETE não existia na migration 010).
-- Como as demais políticas desta tabela, é permissiva no banco — a regra de que só
-- Admin pode excluir é aplicada na camada da aplicação (mesmo padrão de purchase_requests).
DROP POLICY IF EXISTS "auth_delete_fundo_fixo" ON fundo_fixo_solicitacoes;
CREATE POLICY "auth_delete_fundo_fixo" ON fundo_fixo_solicitacoes
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- 2. Saques do cartão (viram dinheiro em caixa; a taxa de saque também entra na fatura)
CREATE TABLE IF NOT EXISTS fundo_fixo_saques (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  valor               DECIMAL(12,2) NOT NULL,
  taxa                DECIMAL(12,2) NOT NULL DEFAULT 0,
  data_saque          DATE          NOT NULL DEFAULT CURRENT_DATE,
  mes_referencia      TEXT          NOT NULL,   -- 'YYYY-MM' — mês em que o saque cai na fatura
  observacoes         TEXT,
  registrado_por_id   UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  registrado_por_nome TEXT          NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundo_fixo_saques_mes ON fundo_fixo_saques(mes_referencia);

ALTER TABLE fundo_fixo_saques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_fundo_fixo_saques"   ON fundo_fixo_saques;
DROP POLICY IF EXISTS "auth_insert_fundo_fixo_saques" ON fundo_fixo_saques;

CREATE POLICY "auth_read_fundo_fixo_saques" ON fundo_fixo_saques
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_insert_fundo_fixo_saques" ON fundo_fixo_saques
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
