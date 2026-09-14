-- O Consolidado do Ano (tela Acompanhamento de Indicadores Semanais) somava só as
-- semanas calculadas ao vivo (S37/2026 em diante) — as semanas importadas da planilha
-- ("Painel de Indicadores de PCM", ver 044_manutencao_indicadores_historico.sql)
-- gravavam só o % (atendimento/cumprimento), sem a contagem bruta por trás. Sem a
-- contagem não dá pra somar "quantidade de ordens" no ano inteiro (só dá pra ter uma
-- média de percentuais, que não bate com a planilha) — por isso o Consolidado do Ano
-- ficava bem abaixo do valor real, faltando o ano inteiro antes da Programação nativa.
ALTER TABLE manutencao_indicadores_historico
  ADD COLUMN IF NOT EXISTS programadas         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS executadas          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nao_executadas      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planejadas_plano    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS executadas_plano    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nao_executadas_plano INTEGER NOT NULL DEFAULT 0;

-- Linhas importadas antes deste fix ficam com contagem 0 (só o % antigo continua
-- válido) até serem reimportadas — o botão "Importar histórico" já faz upsert por
-- semana_inicio+categoria, então basta rodar a mesma planilha de novo.
