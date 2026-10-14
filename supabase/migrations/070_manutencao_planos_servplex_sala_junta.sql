-- Migration: 070_manutencao_planos_servplex_sala_junta
-- Reportado: P-R-6M da SERVPLEX aparecendo quase toda semana, voltando semanas depois de
-- cada ajuste. Causa: dentro do mesmo grupo de visita (mesmo KKS ou salas vizinhas, ver
-- GRUPOS_EQUIPAMENTO_VIZINHO em src/utils/manutencao-planos.ts), planos do MESMO período
-- ficaram em meses diferentes — a 040 usou a última manutenção real de cada split e a 060
-- só acertou o DIA do mês. Ex.: split 2 das salas elétricas STK com 6M em 12/11 e split 1
-- em 12/12. As 060/061 corrigiram só os grupos que estavam aparecendo naquela semana; os
-- outros apareceram depois, por isso parecia que o erro "voltava".
--
-- Regra (confirmada com o usuário em 2026-10-14, "sala junta"): em cada grupo, todos os
-- planos de mesmo período saem na MESMA data — a próxima execução mais cedo do grupo,
-- encaixada no calendário do plano-base (1M) do grupo. Só antecipa, nunca atrasa, com
-- duas exceções conhecidas:
--   - SUP2 Sala 46 (PM-0100/0101/0102): feito em 05/10; o ciclo cobre a ocorrência de
--     26/10, então a próxima vai pra 26/11 (1M), 26/01 (3M) e 26/04 (6M) — uma vez só,
--     depois segue junto com SUP1/Self.
--   - 6M cabine STR 01 (PM-0182): feito em 28/09, vai junto com o da STR 02 em 28/12 (3
--     meses depois, uma vez só) em vez de ficar sozinho em 28/03.
-- Novo grupo de vizinhos no código: Sala 46 (AC90SAG03AH501/502/503).
--
-- 6M da SERVPLEX por semana, out/2026-jun/2027 (semana: quantidade):
--   antes:  10-19(5) 10-26(1) 11-09(2) 11-23(1) 11-30(1) 12-07(3) 12-14(3) 12-28(4) 01-11(1)
--           01-25(2) 03-22(1) 04-05(1) 04-19(5) 04-26(1) 05-10(2) 05-24(1) 05-31(1) 06-07(3)
--           06-14(3) 06-28(1)
--   depois: 10-19(5) 10-26(2) 11-09(4) 11-23(3) 11-30(4) 12-14(3) 12-28(2) 01-11(1)
--           04-19(5) 04-26(3) 05-10(4) 05-24(3) 05-31(4) 06-14(3) 06-28(2)
-- Grupos diferentes continuam em semanas diferentes (nivelamento da 058) — o que acaba é
-- a mesma sala/grupo com 6M em visitas separadas.
--
-- Cada UPDATE confere a data_inicial atual (não sobrescreve ajuste feito depois da
-- exportação de 2026-10-14). Para impedir o desalinhamento de voltar: "Saúde dos planos"
-- ganhou o alerta "Fora da visita do grupo", que também aparece ao salvar o plano.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND codigo = 'PM-0108' AND data_inicial = '2027-01-02'; -- CCOT1 6M: próxima 2027-01-02 -> 2026-12-02
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0110' AND data_inicial = '2026-12-02'; -- CCOT2 3M: próxima 2026-12-02 -> 2026-11-02
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND codigo = 'PM-0111' AND data_inicial = '2027-01-02'; -- CCOT2 6M: próxima 2027-01-02 -> 2026-12-02
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND codigo = 'PM-0078' AND data_inicial = '2026-12-12'; -- STK01 S1 6M: próxima 2026-12-12 -> 2026-11-12
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND codigo = 'PM-0082' AND data_inicial = '2026-12-12'; -- STK02 S1 6M: próxima 2026-12-12 -> 2026-11-12
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND codigo = 'PM-0139' AND data_inicial = '2027-01-19'; -- TC07 3M: próxima 2027-01-19 -> 2026-12-19
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0100' AND data_inicial = '2026-10-05'; -- SUP2 1M: próxima 2026-11-05 -> 2026-11-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0101' AND data_inicial = '2026-10-05'; -- SUP2 3M: próxima 2027-01-05 -> 2027-01-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0102' AND data_inicial = '2026-10-05'; -- SUP2 6M: próxima 2027-04-05 -> 2027-04-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0103' AND data_inicial = '2026-11-09'; -- SL46 1M: próxima 2026-11-09 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0105' AND data_inicial = '2026-11-09'; -- SL46 3M: próxima 2026-11-09 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0104' AND data_inicial = '2026-12-09'; -- SL46 6M: próxima 2026-12-09 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND codigo = 'PM-0130' AND data_inicial = '2027-01-26'; -- OFIC 6M: próxima 2027-01-26 -> 2026-11-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0125' AND data_inicial = '2026-11-26'; -- COFRE 3M: próxima 2026-11-26 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0122' AND data_inicial = '2026-11-26'; -- PLAN 3M: próxima 2026-11-26 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND codigo = 'PM-0123' AND data_inicial = '2027-01-26'; -- PLAN 6M: próxima 2027-01-26 -> 2026-11-26
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0116' AND data_inicial = '2026-12-02'; -- PT 3M: próxima 2026-12-02 -> 2026-11-02
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND codigo = 'PM-0115' AND data_inicial = '2027-01-02'; -- PT 6M: próxima 2027-01-02 -> 2026-12-02
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0019' AND data_inicial = '2026-12-21'; -- P25-616 3M: próxima 2026-12-21 -> 2026-11-21
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0030' AND data_inicial = '2026-12-21'; -- P25-619 3M: próxima 2026-12-21 -> 2026-11-21
UPDATE manutencao_planos SET data_inicial = '2026-12-28' WHERE ativo AND codigo = 'PM-0182' AND data_inicial = '2026-09-28'; -- STR01 6M: próxima 2027-03-28 -> 2026-12-28
ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;
COMMIT;

-- Conferência: deve listar 21 planos com a data nova.
SELECT codigo, nome, data_inicial FROM manutencao_planos
 WHERE codigo IN ('PM-0108','PM-0110','PM-0111','PM-0078','PM-0082','PM-0139','PM-0100','PM-0101','PM-0102',
                  'PM-0103','PM-0105','PM-0104','PM-0130','PM-0125','PM-0122','PM-0123','PM-0116','PM-0115',
                  'PM-0019','PM-0030','PM-0182')
 ORDER BY data_inicial, codigo;
