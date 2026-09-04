-- Migration: 026_manutencao_reuniao
-- Adiciona horário e local à tabela de Programação de Manutenção — usado só pelo
-- novo tipo 'reuniao' (aviso de reunião lançado em lote pra toda a equipe, igual
-- feriado, mas sem bloquear o resto da agenda do dia). Colunas ficam nulas pros
-- outros tipos (ordem/folga/treinamento/exame_medico).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS reuniao_horario TEXT,
  ADD COLUMN IF NOT EXISTS reuniao_local   TEXT;
