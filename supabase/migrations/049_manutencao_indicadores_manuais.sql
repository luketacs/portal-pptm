-- Indicadores anuais que NÃO dão pra calcular a partir de manutencao_programacao —
-- vêm de fora do Portal (ex.: Disponibilidade Global Anual dos equipamentos, Dias/Navio
-- de logística) e por isso são digitados à mão, um valor por ano/indicador. Usados só
-- pra alimentar o índice de atingimento de meta (régua de PLR) no Consolidado do Ano
-- da tela Acompanhamento de Indicadores Semanais, junto com Atendimento à Programação/
-- Cumprimento do Plano (esses dois continuam 100% calculados ao vivo, não usam esta
-- tabela).
CREATE TABLE IF NOT EXISTS manutencao_indicadores_manuais (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  ano                 INTEGER       NOT NULL,
  -- Chave fixa do indicador — 'disponibilidade_global_anual' | 'dias_navio' por ora,
  -- validado na camada de serviço Angular (não trava aqui, pra não precisar de
  -- migration nova cada vez que um indicador manual novo for adicionado).
  chave               TEXT          NOT NULL,
  valor               NUMERIC       NOT NULL,
  atualizado_por_id    UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  atualizado_por_nome  TEXT          NOT NULL,
  atualizado_em        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(ano, chave)
);

ALTER TABLE manutencao_indicadores_manuais ENABLE ROW LEVEL SECURITY;

-- RLS permissiva (mesmo padrão do resto do módulo de Manutenção neste projeto) — regra
-- de negócio real (Admin-only pra editar) fica na camada de serviço Angular, não SQL.
DROP POLICY IF EXISTS "auth_read_indicadores_manuais" ON manutencao_indicadores_manuais;
CREATE POLICY "auth_read_indicadores_manuais" ON manutencao_indicadores_manuais
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_insert_indicadores_manuais" ON manutencao_indicadores_manuais;
CREATE POLICY "auth_insert_indicadores_manuais" ON manutencao_indicadores_manuais
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_update_indicadores_manuais" ON manutencao_indicadores_manuais;
CREATE POLICY "auth_update_indicadores_manuais" ON manutencao_indicadores_manuais
  FOR UPDATE USING (auth.uid() IS NOT NULL);
