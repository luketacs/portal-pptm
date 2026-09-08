-- Migration: 028_manutencao_planos_preventivos
-- Cadastro nativo do plano mestre de manutenção preventiva (equipamento + periodicidade
-- + última execução). Substitui a dependência do SIGMA pra saber quem está vencendo: a
-- análise feita nesta conversa provou que a geração automática de OS preventiva no
-- SIGMA praticamente parou desde set/2025 (caiu ~97% do ritmo normal), então o Portal
-- passa a calcular sozinho a "próxima data" de cada plano (ultima_execucao +
-- periodicidade, calculado em runtime — ver src/utils/manutencao-preventivas.ts) e
-- mostrar isso na Programação, independente do SIGMA ter criado OS ou não.
-- RLS permissiva a nível SQL, mesmo padrão do resto da Programação de Manutenção:
-- quem pode editar de fato (Admin/Solicitante) é decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_planos_preventivos (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  bem                   TEXT          NOT NULL, -- código do equipamento no SIGMA
  nome_bem              TEXT          NOT NULL,
  servico               TEXT          NOT NULL, -- ex.: "REFP01"
  nome_servico          TEXT          NOT NULL, -- ex.: "P-REFRIGERACAO-PREVENTIVA"
  sequencia             TEXT          NOT NULL, -- ex.: "001"
  nome_manut            TEXT          NOT NULL, -- nome da tarefa (ex.: "P-R-1M ...")
  area                  TEXT          NOT NULL, -- 'ELETRICA' | 'MECANICA' | 'APOIO' (já mapeado a partir da Área Manut. do SIGMA)
  tecnico_apoio         TEXT,                    -- só quando area='APOIO': 'SERVPLEX' (ex-REFR) ou 'OPERAÇÃO' (ex-OPER)
  periodicidade_valor   INTEGER       NOT NULL,
  periodicidade_unidade TEXT          NOT NULL, -- 'Dia(s)' | 'Semana(s)' | 'Mes(es)'
  ultima_execucao       DATE,                    -- null = nunca executada (conta como já vencido)
  ativo                 BOOLEAN       NOT NULL DEFAULT true,
  criado_por_id         UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome       TEXT          NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  atualizado_em         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planos_preventivos_bem  ON manutencao_planos_preventivos (bem);
CREATE INDEX IF NOT EXISTS idx_planos_preventivos_area ON manutencao_planos_preventivos (area);

ALTER TABLE manutencao_planos_preventivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_planos_preventivos" ON manutencao_planos_preventivos
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_planos_preventivos" ON manutencao_planos_preventivos
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_update_planos_preventivos" ON manutencao_planos_preventivos
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_planos_preventivos" ON manutencao_planos_preventivos
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- Vínculo entre a OS criada na Programação e o plano preventivo que ela cumpre — deixa
-- excluir da lista "Preventivas da semana" o que já foi programado, e avançar o plano
-- certo sem precisar adivinhar por equipamento/texto. null pra qualquer OS que não
-- veio desse fluxo (a grande maioria).
ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS plano_preventivo_id UUID REFERENCES manutencao_planos_preventivos(id) ON DELETE SET NULL;
