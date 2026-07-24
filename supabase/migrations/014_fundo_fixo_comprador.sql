-- Migration: 014_fundo_fixo_comprador
-- Permite ao Admin registrar uma solicitação em nome de outra pessoa (ex.: alguém
-- pediu por WhatsApp/pessoalmente) e escolher quem é o responsável por fazer a
-- compra — útil pra saber "pra quem direcionar" quando não é sempre a mesma pessoa.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS comprador_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comprador_nome TEXT;
