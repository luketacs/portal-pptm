-- Migration: 036_manutencao_planos_loto_padrao
-- Alguns planos (ex.: testes operacionais que precisam do equipamento rodando, não
-- desligado) sempre exigem o mesmo status de LOTO toda vez que são programados -- em
-- vez de a pessoa lembrar de selecionar isso manualmente na Nova OS toda vez, o plano
-- guarda um "LOTO padrão" que já vem pré-preenchido (ver programarDaPreventiva no
-- componente de Programação). Mesmas 3 opções já usadas na Nova OS (LOTO_OPCOES):
-- 'LOTO' | 'SEM LOTO' | 'FUNCIONANDO'. null = sem padrão, continua em branco como hoje.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_planos
  ADD COLUMN IF NOT EXISTS loto_padrao TEXT;
