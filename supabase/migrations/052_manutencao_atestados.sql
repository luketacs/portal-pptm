-- Migration: 052_manutencao_atestados
-- Período de atestado médico de um técnico (Elétrica/Mecânica) — mesmo padrão de
-- manutencao_ferias (025): diferente de Folga (por semana, um lançamento por vez),
-- atestado costuma durar vários dias seguidos, às vezes cruzando semanas, então fica
-- num cadastro à parte por técnico/período. A tela usa isso pra avisar/bloquear quando
-- alguém tenta programar uma atividade pro técnico dentro do período de atestado dele,
-- e pra descontar da capacidade (dia inteiro fora, igual férias — diferente de exame
-- médico, que só desconta HORAS_EXAME_MEDICO do dia). RLS permissiva a nível SQL,
-- mesmo padrão do resto da Programação de Manutenção: quem pode cadastrar de fato
-- (qualquer um com permissão de editar a semana) é decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_atestados (
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

CREATE INDEX IF NOT EXISTS idx_manutencao_atestados_tecnico ON manutencao_atestados (tecnico_nome);
CREATE INDEX IF NOT EXISTS idx_manutencao_atestados_periodo  ON manutencao_atestados (data_inicio, data_fim);

ALTER TABLE manutencao_atestados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_manutencao_atestados" ON manutencao_atestados
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_manutencao_atestados" ON manutencao_atestados
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_manutencao_atestados" ON manutencao_atestados
  FOR DELETE USING (auth.uid() IS NOT NULL);
