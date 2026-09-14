-- A migration 038 reprogramou todo o backlog (planos sem nenhum ciclo ainda) pra uma
-- única data (2026-09-21, primeira semana aberta) — mas como "próxima execução" sem
-- ciclo é a própria data_inicial, e a sugestão só casa na janela exata da semana
-- selecionada (ver preventivaVencendo em src/utils/manutencao-preventivas.ts), isso
-- empilhou os 748 planos inteiros na semana 39 e deixou toda semana seguinte vazia.
--
-- Redistribui o mesmo backlog ao longo de várias semanas, 25 planos por semana POR
-- ÁREA — mesmo tamanho de lote já usado no painel de sugestões
-- (LOTE_PREVENTIVAS_POR_SEMANA_NOVO em manutencao-programacao.component.ts), pra que
-- tudo que vence numa semana caiba no que o painel já mostra, sem sobra escondida.
-- Dentro de cada área, prioriza ciclo mais longo primeiro (perder uma anual pesa mais
-- que perder uma mensal — mesma regra já combinada com o usuário pra ordenação da
-- fila), desempatando por código pra ordem determinística.
WITH fila AS (
  SELECT
    p.id,
    ROW_NUMBER() OVER (
      PARTITION BY p.area
      ORDER BY
        (CASE p.periodicidade_unidade
           WHEN 'Dia(s)' THEN p.periodicidade_valor
           WHEN 'Semana(s)' THEN p.periodicidade_valor * 7
           ELSE p.periodicidade_valor * 30
         END) DESC,
        p.codigo
    ) - 1 AS posicao
  FROM manutencao_planos p
  WHERE p.ativo = true
    AND NOT EXISTS (SELECT 1 FROM manutencao_ciclos c WHERE c.plano_id = p.id)
)
UPDATE manutencao_planos m
SET data_inicial = (DATE '2026-09-21' + ((fila.posicao / 25) * 7) * INTERVAL '1 day')::date
FROM fila
WHERE m.id = fila.id;
