-- Migration: 021_manutencao_programacao_tipo
-- Permite lançar folga e treinamento de um colaborador na programação semanal, além
-- de OS normal — usa a mesma tabela (reaproveita técnico/semana/dias já existentes),
-- só marca o tipo do lançamento. 'ordem' é o padrão pra não quebrar as linhas já
-- existentes.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'ordem'; -- 'ordem' | 'folga' | 'treinamento'

CREATE INDEX IF NOT EXISTS idx_manutencao_prog_tipo ON manutencao_programacao (tipo);
