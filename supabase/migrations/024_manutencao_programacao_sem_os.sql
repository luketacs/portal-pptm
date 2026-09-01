-- Migration: 024_manutencao_programacao_sem_os
-- Marca lançamentos do tipo "ordem" que não precisam (e nunca vão ter) número de OS
-- no SIGMA — ex.: revisão de planos de manutenção. Diferente de deixar o número em
-- branco sem marcar isso, que continua significando "OS existe mas ainda não foi
-- criada no ERP" (aparece como "CRIAR OS" na tela).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS sem_os BOOLEAN NOT NULL DEFAULT false;
