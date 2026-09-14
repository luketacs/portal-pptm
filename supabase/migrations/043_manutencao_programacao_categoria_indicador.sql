-- Suporte à tela "Acompanhamento de Indicadores Semanais" (indicadores calculados ao
-- vivo a partir das ordens do Portal, em vez do relatório antigo que lia planilha
-- Excel manual). O relatório antigo quebra a semana em mais categorias do que a área
-- de 3 valores que o Portal tem hoje (MECANICA/ELETRICA/APOIO) — Mecânica e Elétrica
-- mapeiam 1:1, mas Limp Operacional (Operação), Refrigeração (Servplex) e SPCI (BMS)
-- estão todas hoje misturadas dentro de APOIO, sem nada que as distinga.
--
-- Não amplia o tipo de `area` (isso quebraria as 3 telas de Programação por área que
-- já existem) — adiciona uma coluna nova, só pra esse indicador, com os 5 valores
-- finais confirmados com o usuário.
ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS categoria_indicador TEXT; -- 'MECANICA' | 'ELETRICA' | 'LIMP_OPERACIONAL' | 'REFRIGERACAO' | 'SPCI' | NULL

-- Mecânica e Elétrica não têm ambiguidade nenhuma — categoria = área, sempre.
UPDATE manutencao_programacao
SET categoria_indicador = area
WHERE area IN ('MECANICA', 'ELETRICA')
  AND categoria_indicador IS NULL;

-- Apoio: melhor esforço a partir do prefixo do nome/descrição (mesma convenção
-- herdada do SIGMA que já é usada nos códigos dos planos, ex. "P-R-1M..." =
-- Refrigeração, "P-OP-1M..." = Operação/Limp Operacional, "P-SPCI-1M..." = SPCI).
-- O que não bater com nenhum padrão fica NULL ("Não classificado" na tela nova) —
-- não força um valor errado, sinaliza que precisa de revisão manual.
UPDATE manutencao_programacao
SET categoria_indicador = 'REFRIGERACAO'
WHERE area = 'APOIO'
  AND categoria_indicador IS NULL
  AND (descricao ILIKE 'P-R-%' OR descricao ILIKE '%REFRIGERA%' OR descricao ILIKE '%SPLIT%' OR descricao ILIKE '%ARCOND%' OR descricao ILIKE '%AR COND%');

UPDATE manutencao_programacao
SET categoria_indicador = 'SPCI'
WHERE area = 'APOIO'
  AND categoria_indicador IS NULL
  AND (descricao ILIKE 'P-SPCI-%' OR descricao ILIKE '%SPCI%');

UPDATE manutencao_programacao
SET categoria_indicador = 'LIMP_OPERACIONAL'
WHERE area = 'APOIO'
  AND categoria_indicador IS NULL
  AND (descricao ILIKE 'P-OP-%' OR descricao ILIKE 'I-OP-%' OR descricao ILIKE '%OPERACAO%' OR descricao ILIKE '%LIMPEZA%');
