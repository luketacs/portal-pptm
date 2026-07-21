-- Migration: 009_almox_saldo_real
-- Saldo real do almoxarifado (relatório "Listagem do Browse" / posição de estoque do ERP)
-- Usado para conferir se o saldo calculado em "Aguardando Retirada" bate com o saldo físico real.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS almox_saldo_real (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_codigo  TEXT         NOT NULL,
  produto_desc    TEXT,
  grupo           TEXT,
  custo_medio     DECIMAL(15,4) DEFAULT 0,
  saldo_qtd       DECIMAL(15,3) DEFAULT 0,
  created_at      TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_almox_saldo_real_codigo ON almox_saldo_real (produto_codigo);

ALTER TABLE almox_saldo_real ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_almox_saldo_real" ON almox_saldo_real FOR SELECT USING (auth.uid() IS NOT NULL);

-- Apenas Admin pode inserir/deletar (feito via service role na API)
