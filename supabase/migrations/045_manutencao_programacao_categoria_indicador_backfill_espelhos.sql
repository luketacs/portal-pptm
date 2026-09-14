-- Backfill pra corrigir dados já gravados antes do fix em
-- manutencao-programacao.component.ts (confirmarApoio / apoio por empresa /
-- criarApoioTecnicosSeNecessario): as três rotinas que espelham uma OS pra outra
-- agenda (+Apoio manual, apoio automático por empresa, ajudante marcado em
-- "Recursos") nunca mandavam categoria_indicador na cópia. O service só auto-deriva
-- esse campo a partir da área quando ela é Mecânica/Elétrica (sem ambiguidade); pra
-- Apoio, campo omitido = grava NULL — toda cópia de uma OS de Apoio nascia "Não
-- classificado" no indicador, mesmo com a OS original devidamente classificada.
--
-- Copia a categoria de qualquer outra ordem da MESMA semana com o MESMO número de OS
-- que já tenha classificação (a OS original ou outro espelho já corrigido) — não
-- sobrescreve nada que já tenha valor, só preenche os NULL que sobraram do bug.
UPDATE manutencao_programacao AS destino
SET categoria_indicador = origem.categoria_indicador
FROM manutencao_programacao AS origem
WHERE destino.categoria_indicador IS NULL
  AND destino.area = 'APOIO'
  AND destino.numero_os IS NOT NULL
  AND TRIM(destino.numero_os) <> ''
  AND origem.id <> destino.id
  AND origem.categoria_indicador IS NOT NULL
  AND origem.semana_inicio = destino.semana_inicio
  AND TRIM(origem.numero_os) = TRIM(destino.numero_os);
