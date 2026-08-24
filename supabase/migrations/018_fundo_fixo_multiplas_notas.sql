-- Migration: 018_fundo_fixo_multiplas_notas
-- Permite anexar mais de uma nota fiscal por compra do Fundo Fixo. nota_fiscal_url
-- (uma só) vira nota_fiscal_urls (array) -- migra o valor já existente pro array,
-- pra não perder as notas já anexadas antes dessa mudança.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS nota_fiscal_urls TEXT[] NOT NULL DEFAULT '{}';

UPDATE fundo_fixo_solicitacoes
  SET nota_fiscal_urls = ARRAY[nota_fiscal_url]
  WHERE nota_fiscal_url IS NOT NULL AND nota_fiscal_urls = '{}';
