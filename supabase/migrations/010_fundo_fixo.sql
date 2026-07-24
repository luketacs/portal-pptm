-- Migration: 010_fundo_fixo
-- Controle do Fundo Fixo (cartão corporativo, limite mensal de R$ 3.000)
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS fundo_fixo_solicitacoes (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitante_id    UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  solicitante_nome  TEXT          NOT NULL,
  setor             TEXT          NOT NULL,   -- 'Manutenção' | 'Operação' | 'Infraestrutura' | 'Outros'
  fornecedor        TEXT,
  material          TEXT          NOT NULL,   -- descrição do que será/foi comprado
  valor_estimado    DECIMAL(12,2) NOT NULL DEFAULT 0,
  valor_final       DECIMAL(12,2),            -- preenchido quando a nota fiscal é anexada
  orcamento_url     TEXT,
  nota_fiscal_url   TEXT,
  observacoes       TEXT,
  status            TEXT          NOT NULL DEFAULT 'pendente', -- pendente | aprovado | recusado | comprado
  aprovador_id      UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  aprovador_nome    TEXT,
  motivo_recusa     TEXT,
  mes_referencia    TEXT          NOT NULL,   -- 'YYYY-MM' — mês da fatura do cartão
  data_solicitacao  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  data_aprovacao    TIMESTAMPTZ,
  data_compra       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundo_fixo_status  ON fundo_fixo_solicitacoes (status);
CREATE INDEX IF NOT EXISTS idx_fundo_fixo_mes     ON fundo_fixo_solicitacoes (mes_referencia);
CREATE INDEX IF NOT EXISTS idx_fundo_fixo_solic   ON fundo_fixo_solicitacoes (solicitante_id);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE fundo_fixo_solicitacoes ENABLE ROW LEVEL SECURITY;

-- Leitura: todos os usuários autenticados (a tela filtra "minhas" vs "todas" no app,
-- do mesmo jeito que já é feito em purchase_requests)
CREATE POLICY "auth_read_fundo_fixo" ON fundo_fixo_solicitacoes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Criação: qualquer usuário autenticado pode registrar sua própria solicitação
CREATE POLICY "auth_insert_fundo_fixo" ON fundo_fixo_solicitacoes
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Atualização (aprovar/recusar/anexar nota fiscal): usuários autenticados —
-- a validação de quem pode fazer qual transição (Admin aprova/recusa; o próprio
-- solicitante ou Admin anexa a nota fiscal) é feita no app, no mesmo padrão já
-- usado em purchase_requests/request.service.ts.
CREATE POLICY "auth_update_fundo_fixo" ON fundo_fixo_solicitacoes
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- STORAGE: execute os passos abaixo no Supabase Dashboard
-- Storage > New Bucket
-- ============================================================
--
-- Bucket: fundo-fixo-anexos
--   Name: fundo-fixo-anexos
--   Public: true
--   Allowed MIME types: application/pdf, image/jpeg, image/png, image/webp
--   Max file size: 15 MB
--
-- Policies (iguais às usadas em material-photos/material-datasheets):
--
-- Policy: Allow authenticated users to upload (INSERT)
--   Target: Authenticated users
--   Policy expression: auth.uid() IS NOT NULL
--
-- Policy: Allow public read (SELECT)
--   Target: Public
--   Policy expression: true
-- ============================================================
