-- Migration: 070_manutencao_planos_servplex_sala_junta
-- Reportado: P-R-6M da SERVPLEX aparecendo quase toda semana, voltando semanas depois de
-- cada ajuste. Causa: dentro do mesmo grupo de visita (mesmo KKS ou salas vizinhas, ver
-- GRUPOS_EQUIPAMENTO_VIZINHO em src/utils/manutencao-planos.ts), planos do MESMO período
-- ficaram em meses diferentes — a 040 usou a última manutenção real de cada split e a 060
-- só acertou o DIA do mês. Ex.: split 2 das salas elétricas STK com 6M em 12/11 e split 1
-- em 12/12. As 060/061 corrigiram só os grupos que estavam aparecendo naquela semana; os
-- outros apareceram depois, por isso parecia que o erro "voltava".
--
-- Regra (confirmada com o usuário em 2026-10-14, "sala junta"): em cada grupo, planos de
-- mesmo período saem na MESMA data, no calendário do plano-base (1M) do grupo. Limite do
-- usuário: 6M continua a cada 6M, 3M a cada 3M — só pode ANTECIPAR até 1/3 do período
-- (1M: 10 dias, 3M: 1 mês, 6M: 2 meses), nunca atrasa, e o intervalo desde a última
-- execução não fica menor que 2/3 do período.
--
-- Não deu pra alinhar dentro desse limite (ficam como estão, aparecem no alerta "Fora da
-- visita do grupo"):
--   - Sala 46 (SUP1/SUP2/Self — grupo novo no código): SUP2 foi feito em 05/10 e SUP1 vence
--     antes dos outros; juntar exigiria atrasar.
--   - 6M cabines STR 01/02: STR 01 feito em 28/09 (próximo 28/03), STR 02 em 28/12 — 3
--     meses de diferença, mais que os 2 meses permitidos.
--
-- 6M da SERVPLEX por semana, out/2026-jun/2027 (semana: quantidade):
--   ANTES: 10-19(5) 10-26(1) 11-09(2) 11-23(1) 11-30(1) 12-07(3) 12-14(3) 12-28(4) 01-11(1) 01-25(2) 03-22(1) 04-05(1) 04-19(5) 04-26(1) 05-10(2) 05-24(1) 05-31(1) 06-07(3) 06-14(3) 06-28(1)
--   DEPOIS: 10-19(5) 10-26(1) 11-09(4) 11-23(3) 11-30(4) 12-07(1) 12-14(3) 12-28(1) 01-11(1) 03-22(1) 04-05(1) 04-19(5) 04-26(1) 05-10(4) 05-24(3) 05-31(4) 06-07(1) 06-14(3) 06-28(1)
-- Grupos diferentes continuam em semanas diferentes (nivelamento da 058) — o que acaba é
-- a mesma sala/grupo com 6M em visitas separadas.
--
-- Cada UPDATE confere a data_inicial atual (não sobrescreve ajuste feito depois da
-- exportação de 2026-10-14). "Saúde dos planos" ganhou o alerta "Fora da visita do grupo",
-- que também aparece ao salvar o plano, pra o desalinhamento não voltar sem ninguém ver.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND codigo = 'PM-0108' AND data_inicial = '2027-01-02'; -- CCOT1 6M: próxima 2027-01-02 -> 2026-12-02
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0110' AND data_inicial = '2026-12-02'; -- CCOT2 3M: próxima 2026-12-02 -> 2026-11-02
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND codigo = 'PM-0111' AND data_inicial = '2027-01-02'; -- CCOT2 6M: próxima 2027-01-02 -> 2026-12-02
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND codigo = 'PM-0078' AND data_inicial = '2026-12-12'; -- STK01 S1 6M: próxima 2026-12-12 -> 2026-11-12
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND codigo = 'PM-0082' AND data_inicial = '2026-12-12'; -- STK02 S1 6M: próxima 2026-12-12 -> 2026-11-12
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND codigo = 'PM-0139' AND data_inicial = '2027-01-19'; -- TC07 3M: próxima 2027-01-19 -> 2026-12-19
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND codigo = 'PM-0130' AND data_inicial = '2027-01-26'; -- OFIC 6M: próxima 2027-01-26 -> 2026-11-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0125' AND data_inicial = '2026-11-26'; -- COFRE 3M: próxima 2026-11-26 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND codigo = 'PM-0122' AND data_inicial = '2026-11-26'; -- PLAN 3M: próxima 2026-11-26 -> 2026-10-26
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND codigo = 'PM-0123' AND data_inicial = '2027-01-26'; -- PLAN 6M: próxima 2027-01-26 -> 2026-11-26
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0116' AND data_inicial = '2026-12-02'; -- PT 3M: próxima 2026-12-02 -> 2026-11-02
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND codigo = 'PM-0115' AND data_inicial = '2027-01-02'; -- PT 6M: próxima 2027-01-02 -> 2026-12-02
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0019' AND data_inicial = '2026-12-21'; -- P25-616 3M: próxima 2026-12-21 -> 2026-11-21
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0030' AND data_inicial = '2026-12-21'; -- P25-619 3M: próxima 2026-12-21 -> 2026-11-21
ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;
COMMIT;

-- Conferência: deve listar 14 planos com a data nova.
SELECT codigo, nome, data_inicial FROM manutencao_planos
 WHERE codigo IN ('PM-0108', 'PM-0110', 'PM-0111', 'PM-0078', 'PM-0082', 'PM-0139', 'PM-0130', 'PM-0125', 'PM-0122', 'PM-0123', 'PM-0116', 'PM-0115', 'PM-0019', 'PM-0030')
 ORDER BY data_inicial, codigo;
