-- Migration: 022_manutencao_programacao_tipo_servico
-- Guarda o "Tipo de Serviço" da OS (CORRETIVA/PREVENTIVA/MELHORIA) — presente em
-- todas as versões da planilha de programação, mas que ainda não tinha campo próprio
-- aqui. Mesmo padrão de status: texto livre, o SIGMA já informa esse valor pra OS
-- existentes (auto-preenchido via api/sigma-ordens-proxy.js).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS tipo_servico TEXT;
