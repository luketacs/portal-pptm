-- Migration: 017_fundo_fixo_reembolso
-- Controla se uma compra paga via 'reembolso' (a pessoa pagou do próprio bolso) já
-- teve o dinheiro devolvido a ela pelo caixa. Fica pendente entre meses até ser
-- marcado — não depende do mes_referencia da compra original.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS reembolsado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS data_reembolso TIMESTAMPTZ;
