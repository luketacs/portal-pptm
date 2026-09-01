-- Migration: 020_manutencao_programacao
-- Programação semanal de manutenção (Elétrica e Mecânica), nativa no Portal —
-- antes só existia em planilhas Excel (uma por área, uma aba por semana). RLS
-- permissiva a nível SQL, igual ao padrão do Fundo Fixo: quem pode criar/editar/
-- excluir de fato (só Admin) é decidido no app, não aqui no banco.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_programacao (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  area              TEXT          NOT NULL,   -- 'ELETRICA' | 'MECANICA'
  semana_inicio     DATE          NOT NULL,   -- segunda-feira da semana (chave de agrupamento/filtro)
  numero_os         TEXT,                     -- número da OS no SIGMA, quando já existir
  descricao         TEXT          NOT NULL,
  equipamento       TEXT,
  recursos          TEXT,                     -- ajudante / segunda pessoa, texto livre
  loto              TEXT,                     -- texto livre por enquanto (ex.: "LOTO", "Não")
  area_atuacao      TEXT,
  duracao_horas     DECIMAL(5,2),
  tecnico_nome      TEXT          NOT NULL,
  tecnico_matricula TEXT,                     -- vem junto do nome ao selecionar em matriculas.json
  dias_previstos    DATE[]        NOT NULL DEFAULT '{}', -- datas concretas dentro da semana
  status            TEXT          NOT NULL DEFAULT 'pendente', -- pendente | em_execucao | concluida | cancelada
  observacoes       TEXT,
  criado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome   TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manutencao_prog_area    ON manutencao_programacao (area);
CREATE INDEX IF NOT EXISTS idx_manutencao_prog_semana  ON manutencao_programacao (semana_inicio);
CREATE INDEX IF NOT EXISTS idx_manutencao_prog_status  ON manutencao_programacao (status);
CREATE INDEX IF NOT EXISTS idx_manutencao_prog_tecnico ON manutencao_programacao (tecnico_nome);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE manutencao_programacao ENABLE ROW LEVEL SECURITY;

-- Leitura: todos os usuários autenticados (útil pra deixar aberto numa TV/quadro
-- compartilhado, como já acontece com Apontamentos) — a tela restringe as ações
-- de criar/editar/excluir a Admin no app.
CREATE POLICY "auth_read_manutencao_programacao" ON manutencao_programacao
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_insert_manutencao_programacao" ON manutencao_programacao
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_manutencao_programacao" ON manutencao_programacao
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_delete_manutencao_programacao" ON manutencao_programacao
  FOR DELETE USING (auth.uid() IS NOT NULL);
