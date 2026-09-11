-- Migration: 032_manutencao_planos
-- Substitui manutencao_planos_preventivos (import bruto do SIGMA: bem/serviço/sequência,
-- sem código/nome/checklist/responsável/HH, "última execução" mutada em cada
-- programação) por um cadastro rico de verdade, com um ledger de ciclos que impede
-- gerar duas ordens pro mesmo ciclo de um plano (antes disso não existia: um plano já
-- programado uma vez sumia da lista de sugestões pra sempre, mesmo com a próxima
-- ocorrência vencendo meses depois — ver planosJaProgramados() em
-- manutencao-programacao.component.ts).
-- RLS permissiva a nível SQL, mesmo padrão do resto da Programação de Manutenção: quem
-- pode editar de fato (Admin, pro cadastro de plano) é decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE SEQUENCE IF NOT EXISTS manutencao_planos_codigo_seq;

CREATE TABLE IF NOT EXISTS manutencao_planos (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo                TEXT          NOT NULL UNIQUE DEFAULT ('PM-' || lpad(nextval('manutencao_planos_codigo_seq')::text, 4, '0')),
  nome                  TEXT          NOT NULL,
  equipamento           TEXT          NOT NULL,
  tag_kks               TEXT,
  area                  TEXT          NOT NULL, -- 'ELETRICA' | 'MECANICA' | 'APOIO'
  especialidade         TEXT,
  descricao             TEXT          NOT NULL,
  atividades            TEXT[]        NOT NULL DEFAULT '{}', -- checklist
  periodicidade_valor   INTEGER       NOT NULL,
  periodicidade_unidade TEXT          NOT NULL, -- 'Dia(s)' | 'Semana(s)' | 'Mes(es)'
  data_inicial          DATE          NOT NULL,
  responsavel           TEXT,
  tempo_estimado_horas  DECIMAL(5,2),
  hh_estimado           DECIMAL(6,2),
  observacoes           TEXT,
  ativo                 BOOLEAN       NOT NULL DEFAULT true,
  numero_os_reservado   TEXT,
  criado_por_id         UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome       TEXT          NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  atualizado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  atualizado_por_nome   TEXT,
  atualizado_em         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planos_equipamento ON manutencao_planos (equipamento);
CREATE INDEX IF NOT EXISTS idx_planos_area        ON manutencao_planos (area);

ALTER TABLE manutencao_planos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_planos" ON manutencao_planos
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_planos" ON manutencao_planos
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_update_planos" ON manutencao_planos
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_planos" ON manutencao_planos
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- Ledger de duplicidade: uma linha por ocorrência já programada de um plano.
-- UNIQUE(plano_id, data_prevista) é o que impede gerar duas ordens pro mesmo ciclo.
-- Sem coluna de semana de propósito: a semana real de uma ordem preventiva é a que o
-- humano escolheu no modal (pode ser diferente da semana ISO da data prevista, ex.
-- programação adiantada/atrasada) — pra saber em que semana foi programado, faz join
-- em ordem_id -> manutencao_programacao.semana_inicio.
CREATE TABLE IF NOT EXISTS manutencao_ciclos (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  plano_id       UUID          NOT NULL REFERENCES manutencao_planos(id) ON DELETE CASCADE,
  data_prevista  DATE          NOT NULL,
  ordem_id       UUID          REFERENCES manutencao_programacao(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (plano_id, data_prevista)
);

CREATE INDEX IF NOT EXISTS idx_ciclos_plano ON manutencao_ciclos (plano_id);

ALTER TABLE manutencao_ciclos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_ciclos" ON manutencao_ciclos
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_ciclos" ON manutencao_ciclos
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Ordem gerada de um plano carrega o checklist junto (copiado no momento da
-- programação) -- null pra OS que não nasceu de um plano.
ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS checklist TEXT[];

-- Repontar o vínculo existente: plano_preventivo_id referenciava a tabela antiga: a
-- tabela antiga fica no banco intacta (não usada, não apagada -- reversível se algo
-- der errado), o vínculo passa a apontar pra manutencao_planos. Nome do constraint é o
-- default do Postgres pra FK sem nome explícito, criada em
-- 028_manutencao_planos_preventivos.sql.
ALTER TABLE manutencao_programacao
  DROP CONSTRAINT IF EXISTS manutencao_programacao_plano_preventivo_id_fkey;
ALTER TABLE manutencao_programacao
  ADD CONSTRAINT manutencao_programacao_plano_preventivo_id_fkey
  FOREIGN KEY (plano_preventivo_id) REFERENCES manutencao_planos(id) ON DELETE SET NULL;

-- Migra os planos já cadastrados (import do SIGMA) pro modelo novo. codigo sai da
-- sequence acima (ordem determinística por área/bem/serviço/sequência). Sem campo de
-- nome/descrição livre na tabela antiga -- nome_manut cobre os dois por enquanto,
-- editável depois pelo cadastro novo.
INSERT INTO manutencao_planos (
  nome, equipamento, tag_kks, area, especialidade, descricao,
  periodicidade_valor, periodicidade_unidade, data_inicial, responsavel,
  ativo, numero_os_reservado, criado_por_id, criado_por_nome, created_at
)
SELECT
  nome_manut,
  nome_bem,
  bem,
  area,
  nome_servico,
  nome_manut,
  periodicidade_valor,
  periodicidade_unidade,
  COALESCE(ultima_execucao, created_at::date, CURRENT_DATE),
  tecnico_apoio,
  ativo,
  numero_os_reservado,
  criado_por_id,
  criado_por_nome,
  created_at
FROM manutencao_planos_preventivos
ORDER BY area, bem, servico, sequencia;
