-- Migration: 025_manutencao_ferias
-- Período de férias de um técnico (Elétrica/Mecânica) — diferente de Folga (que é
-- por semana, um lançamento por vez), férias costuma durar várias semanas, então
-- fica num cadastro à parte por técnico/período. A tela usa isso pra avisar/bloquear
-- quando alguém tenta programar uma atividade pro técnico dentro do período de
-- férias dele. RLS permissiva a nível SQL, mesmo padrão do resto da Programação de
-- Manutenção: quem pode cadastrar de fato (só Admin) é decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_ferias (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tecnico_nome      TEXT          NOT NULL,
  tecnico_matricula TEXT,
  area              TEXT          NOT NULL,   -- 'ELETRICA' | 'MECANICA'
  data_inicio       DATE          NOT NULL,
  data_fim          DATE          NOT NULL,
  criado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome   TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_manutencao_ferias_tecnico ON manutencao_ferias (tecnico_nome);
CREATE INDEX IF NOT EXISTS idx_manutencao_ferias_periodo  ON manutencao_ferias (data_inicio, data_fim);

ALTER TABLE manutencao_ferias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_manutencao_ferias" ON manutencao_ferias
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_manutencao_ferias" ON manutencao_ferias
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_manutencao_ferias" ON manutencao_ferias
  FOR DELETE USING (auth.uid() IS NOT NULL);
