-- Migration: 029_manutencao_parada_planta
-- Registro de quando a planta fica parada (a empresa não opera 24h/dia, às vezes fica
-- meses parada) — enquanto ativo, os planos preventivos de ciclo curto (dias/semanas)
-- passam a ser calculados como mensais (não faz sentido inspeção semanal de
-- equipamento parado), ver src/utils/manutencao-preventivas.ts. Só um registro deve
-- estar "aberto" (data_fim null) por vez — controlado no app, não é feature de auto-
-- gerenciamento por múltiplos usuários simultâneos.
-- RLS permissiva a nível SQL, mesmo padrão do resto da Programação de Manutenção:
-- só Admin vê/altera de fato — decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_parada_planta (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  data_inicio       DATE          NOT NULL,
  data_fim          DATE,                    -- null = parada em andamento
  criado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome   TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE manutencao_parada_planta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_parada_planta" ON manutencao_parada_planta
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_parada_planta" ON manutencao_parada_planta
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_update_parada_planta" ON manutencao_parada_planta
  FOR UPDATE USING (auth.uid() IS NOT NULL);
