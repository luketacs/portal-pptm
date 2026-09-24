-- Semana 40 (2026-09-28) ficou sem nenhuma preventiva de refrigeração (SERVPLEX): as
-- únicas dela eram os P-R-6M do Prédio 25, que a migration 060 juntou com o 1M de
-- outubro. A semana 40 estava fora do rebalanceamento da 058 (programação em andamento).
--
-- Adianta em 7 dias o grupo das cabines das Stackers 01/02 (SRC91EAD10AH004 /
-- SRC91EAD20AH004, grupo de vizinhos confirmado), que saía na semana 2026-10-05: o grupo
-- inteiro passa pro dia 28, sempre junto. Só antecipa — nenhum plano fica atrasado.
--   Semana 40:  P-R-1M, P-R-3M e P-R-6M cabine STR 01 + P-R-1M e P-R-3M cabine STR 02
--   Semana 41:  fica o grupo SUP2 do pátio de carvão (P-R-1M/3M/6M AC90SAG03AH502)
-- O P-R-6M da cabine STR 02 (2027-01-05) vai pra 2026-12-28, pra continuar no mesmo dia
-- do 1M do grupo.
--
-- Mesma proteção da 060: plano que já tem ciclo programado a partir da semana 40 fica
-- como está.

BEGIN;

ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;

CREATE FUNCTION pg_temp.programado_desde_40(p uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM manutencao_ciclos c WHERE c.plano_id = p AND c.data_prevista >= '2026-09-28')
$$;

UPDATE manutencao_planos SET data_inicial = '2026-09-28'
 WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = ANY(ARRAY[
    '8c9a851c-88c2-4a73-ab3e-1332f07356f3', -- PM-0181 P-R-1M ARCOND CABINE STR 01
    '742b3414-1b2c-475d-8904-de45c997cd60', -- PM-0182 P-R-6M ARCOND CABINE STR 01
    '530b86a6-cc0e-40fc-8a39-cb33cc810c3c', -- PM-0183 P-R-3M ARCOND CABINE STR 01
    '48e837cc-958b-48fe-895e-b8a2397c0f19', -- PM-0185 P-R-3M ARCOND CABINE STR 02
    '9c1ff258-52d8-45f9-9c26-9cd88e8cb87e'  -- PM-0186 P-R-1M ARCOND CABINE STR 02
  ]::uuid[]);

UPDATE manutencao_planos SET data_inicial = '2026-12-28'
 WHERE ativo AND NOT pg_temp.programado_desde_40(id)
   AND id = '47893625-51a0-4d61-952b-48fc7264903c'; -- PM-0184 P-R-6M ARCOND CABINE STR 02

ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;

COMMIT;
