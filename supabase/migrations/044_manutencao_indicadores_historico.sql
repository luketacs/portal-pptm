-- Histórico de indicadores semanais (Atendimento à Programação / Cumprimento do Plano)
-- de ANTES da Programação nativa existir (antes da S37/2026) — vinha só da planilha
-- "Painel de Indicadores de PCM" que era anexada manualmente pro Relatório Semanal PCM
-- (src/components/admin/relatorio-semanal-pcm/). Sem essa tabela, a Evolução ao Longo
-- do Ano/Consolidado do Ano da tela Acompanhamento de Indicadores Semanais só teriam
-- as poucas semanas já calculadas ao vivo desde que a Programação nativa começou.
--
-- Importado uma vez (ver "Importar histórico" na tela de Indicadores Semanais, reusa o
-- mesmo leitor de planilha do Relatório PCM), depois fica gravado — não precisa
-- reimportar toda vez. Semana com dado tanto aqui quanto calculado ao vivo (raro,
-- deveria só acontecer perto da virada S36→S37/2026): o cálculo ao vivo sempre vence.
CREATE TABLE IF NOT EXISTS manutencao_indicadores_historico (
  id                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  semana_inicio      DATE          NOT NULL, -- segunda-feira da semana (mesmo padrão de manutencao_programacao.semana_inicio)
  -- 'GERAL' = soma de todas as áreas daquela semana; senão uma categoria específica
  -- (mesmos valores de manutencao_programacao.categoria_indicador). Usa 'GERAL' em vez
  -- de NULL porque UNIQUE trata NULL como sempre distinto — não bloquearia duplicata.
  categoria          TEXT          NOT NULL DEFAULT 'GERAL',
  atendimento        NUMERIC       NOT NULL,
  cumprimento        NUMERIC       NOT NULL,
  importado_por_id   UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  importado_por_nome TEXT          NOT NULL,
  importado_em       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(semana_inicio, categoria)
);

ALTER TABLE manutencao_indicadores_historico ENABLE ROW LEVEL SECURITY;

-- RLS permissiva (mesmo padrão de todo o módulo de Manutenção neste projeto) — regra
-- de negócio real (Admin-only pra importar) fica na camada de serviço Angular, não SQL.
DROP POLICY IF EXISTS "auth_read_indicadores_historico" ON manutencao_indicadores_historico;
CREATE POLICY "auth_read_indicadores_historico" ON manutencao_indicadores_historico
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_insert_indicadores_historico" ON manutencao_indicadores_historico;
CREATE POLICY "auth_insert_indicadores_historico" ON manutencao_indicadores_historico
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_update_indicadores_historico" ON manutencao_indicadores_historico;
CREATE POLICY "auth_update_indicadores_historico" ON manutencao_indicadores_historico
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_delete_indicadores_historico" ON manutencao_indicadores_historico;
CREATE POLICY "auth_delete_indicadores_historico" ON manutencao_indicadores_historico
  FOR DELETE USING (auth.uid() IS NOT NULL);
