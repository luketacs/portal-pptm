-- Os backfills anteriores (045/047) só recuperavam categoria_indicador copiando de
-- OUTRA ordem já classificada (espelho <-> origem). Não ajudam quando a ordem de
-- Apoio nunca teve nenhuma classificação em lugar nenhum (nem ela, nem seu espelho) —
-- caso comum na semana de estreia do sistema (S37/2026), antes do costume de escolher
-- a categoria no formulário.
--
-- Convenção real do sistema (confirmada pelo usuário): Apoio programa por
-- equipe/empresa, não por técnico individual, e tecnico_nome é o nome dessa equipe —
-- SERVPLEX = Refrigeração, OPERAÇÃO = Limp Operacional, BMS = SPCI. Classifica direto
-- a partir disso, sem precisar de nenhuma outra ordem como referência.
UPDATE manutencao_programacao
SET categoria_indicador = 'REFRIGERACAO'
WHERE area = 'APOIO' AND categoria_indicador IS NULL AND tecnico_nome ILIKE '%SERVPLEX%';

UPDATE manutencao_programacao
SET categoria_indicador = 'LIMP_OPERACIONAL'
WHERE area = 'APOIO' AND categoria_indicador IS NULL AND tecnico_nome ILIKE '%OPERA%';

UPDATE manutencao_programacao
SET categoria_indicador = 'SPCI'
WHERE area = 'APOIO' AND categoria_indicador IS NULL AND tecnico_nome ILIKE '%BMS%';
