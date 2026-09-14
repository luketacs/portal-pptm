-- Complementa 045_manutencao_programacao_categoria_indicador_backfill_espelhos.sql:
-- aquele backfill só cobria espelhos com número de OS preenchido (casava por
-- numero_os + semana_inicio). Ordens "sem OS" (sem_os = true, numero_os NULL — comum
-- em atividades de apoio que ainda não têm número oficial do SIGMA) não tinham como
-- casar por número, então ficaram de fora e continuaram "Não classificado".
--
-- Aqui casa por descrição + semana (os 3 espelhos — confirmarApoio/apoio por empresa/
-- criarApoioTecnicosSeNecessario — sempre copiam a descrição literal da OS principal),
-- só entre ordens SEM número de OS. Mesma regra de não sobrescrever nada que já tenha
-- valor.
UPDATE manutencao_programacao AS destino
SET categoria_indicador = origem.categoria_indicador
FROM manutencao_programacao AS origem
WHERE destino.categoria_indicador IS NULL
  AND destino.area = 'APOIO'
  AND (destino.numero_os IS NULL OR TRIM(destino.numero_os) = '')
  AND origem.id <> destino.id
  AND origem.categoria_indicador IS NOT NULL
  AND origem.semana_inicio = destino.semana_inicio
  AND origem.descricao = destino.descricao;
