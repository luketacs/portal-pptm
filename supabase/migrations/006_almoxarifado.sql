-- Migration: 006_almoxarifado
-- Módulo de Controle de Movimentações do Almoxarifado
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- ── Movimentações (entradas e saídas do almoxarifado) ──────────────────────
CREATE TABLE IF NOT EXISTS almox_movimentacoes (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_codigo  TEXT         NOT NULL,
  produto_desc    TEXT,
  unidade         TEXT,
  grupo           TEXT,
  custo_medio     DECIMAL(15,4) DEFAULT 0,
  saldo_qtd       DECIMAL(15,3) DEFAULT 0,
  data_operacao   DATE,
  documento_num   TEXT,
  qtd_entrada     DECIMAL(15,3) DEFAULT 0,
  qtd_saida       DECIMAL(15,3) DEFAULT 0,
  referencia      TEXT,
  created_at      TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_almox_mov_codigo   ON almox_movimentacoes (produto_codigo);
CREATE INDEX IF NOT EXISTS idx_almox_mov_data      ON almox_movimentacoes (data_operacao DESC);
CREATE INDEX IF NOT EXISTS idx_almox_mov_entrada   ON almox_movimentacoes (qtd_entrada)
  WHERE qtd_entrada > 0;

-- ── Solicitações de Autorização (SAs) de retirada ──────────────────────────
CREATE TABLE IF NOT EXISTS almox_solicitacoes (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  sa_numero       TEXT         NOT NULL,
  produto_codigo  TEXT         NOT NULL,
  qtd_solicitada  DECIMAL(15,3) DEFAULT 0,
  qtd_atendida    DECIMAL(15,3) DEFAULT 0,
  ordem_produto   TEXT,
  ordem_id        TEXT,
  recebedor       TEXT,
  status          TEXT         DEFAULT 'aberta',  -- 'aberta' | 'encerrada'
  created_at      TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_almox_sa_numero  ON almox_solicitacoes (sa_numero);
CREATE INDEX IF NOT EXISTS idx_almox_sa_codigo  ON almox_solicitacoes (produto_codigo);
CREATE INDEX IF NOT EXISTS idx_almox_sa_status  ON almox_solicitacoes (status);

-- ── Log de importações ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS almox_importacoes (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo            TEXT         NOT NULL,  -- 'movimentacoes' | 'solicitacoes'
  nome_arquivo    TEXT,
  total_registros INTEGER      DEFAULT 0,
  importado_por   UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  importado_em    TIMESTAMPTZ  DEFAULT now()
);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE almox_movimentacoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE almox_solicitacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE almox_importacoes    ENABLE ROW LEVEL SECURITY;

-- Todos os usuários autenticados podem ler
CREATE POLICY "auth_read_almox_mov"  ON almox_movimentacoes  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_read_almox_sa"   ON almox_solicitacoes   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_read_almox_imp"  ON almox_importacoes    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Apenas Admin pode inserir/deletar (feito via service role na API)
-- (a API usa service_role_key que bypassa RLS)
