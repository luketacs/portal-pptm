-- Migration: 007_apontamentos
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS apontamentos (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  id_sigma_os     TEXT,
  registrador     TEXT,
  executante      TEXT,          -- matrícula do executor
  solicitante     TEXT,
  area_manutencao TEXT,
  numero_pt       TEXT,
  status_operacao TEXT,
  data            DATE,
  hora_inicial    TEXT,
  hora_final      TEXT,
  intervalo       TEXT,
  feedback        TEXT,
  status_usuario  TEXT,
  equipe          TEXT,
  supervisor      TEXT,
  operador_sala   TEXT,
  operador_campo  TEXT,
  empresa         TEXT,
  os_protheus     TEXT,
  horas           DECIMAL(6,2)  DEFAULT 0,
  importado_em    TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apontamentos_data       ON apontamentos (data DESC);
CREATE INDEX IF NOT EXISTS idx_apontamentos_executante ON apontamentos (executante);
CREATE INDEX IF NOT EXISTS idx_apontamentos_status     ON apontamentos (status_operacao);

ALTER TABLE apontamentos ENABLE ROW LEVEL SECURITY;

-- Todos autenticados podem ler
CREATE POLICY "auth_read_apontamentos" ON apontamentos
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Log de importações
CREATE TABLE IF NOT EXISTS apontamentos_importacoes (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  nome_arquivo    TEXT,
  total_registros INTEGER      DEFAULT 0,
  importado_por   UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  importado_em    TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE apontamentos_importacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_ap_imp" ON apontamentos_importacoes
  FOR SELECT USING (auth.uid() IS NOT NULL);
