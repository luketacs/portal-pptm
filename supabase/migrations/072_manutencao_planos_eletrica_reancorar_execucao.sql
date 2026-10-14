-- Migration: 072_manutencao_planos_eletrica_reancorar_execucao
-- Revisão da Elétrica (2026-10-14). Planos executados em 14/09 com data inicial poucos
-- meses depois da execução (SPDA editados em 25/09, 3M/2M do rebalanceamento da 058).
-- Com a regra do intervalo mínimo (próxima a pelo menos 2/3 do período da última
-- execução — ver proximaDataFixa), a ocorrência mais perto ficava "cedo demais" e a
-- seguinte saía muito depois: os 6M SPDA iam pra maio/junho de 2027 (8-9 meses).
-- Correção: data inicial = execução + período (segunda-feira da semana).
--
--   SPDA EAC31 / ECA33 / ECA43 / ECA44 (6M, feitos 14/09) ... próxima 23/05-28/06/2027 -> 15/03/2027
--   RESIST ISOL MOT DESP TRIP 48 (3M, feito 14/09) .......... próxima 18/01/2027 -> 14/12/2026
--   FUNCIONAMENTO SENSORES TC 07 (2M, feito 14/09) .......... próxima 07/12/2026 -> 16/11/2026
--
-- Não entram (decisão do usuário): os outros 6M feitos em 14/09 que estão dentro da
-- tolerância de 1/3 (SPDA TC05/ECA41/ECA42, GAVETAS C3 STR01, MALHA ECA49 — abril/maio,
-- nivelamento da 058). Alinhamento de visita por KKS na Elétrica foi simulado e não
-- aplicado: dentro do limite de 1/3 só tirava 3 de 669 visitas em 26 semanas.
--
-- Cada UPDATE confere a data_inicial atual.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;
UPDATE manutencao_planos SET data_inicial = '2027-03-15' WHERE ativo AND codigo = 'PM-0469' AND data_inicial = '2026-12-28'; -- I-E-6M INSPEÇÃO SPDA EAC31
UPDATE manutencao_planos SET data_inicial = '2027-03-15' WHERE ativo AND codigo = 'PM-0477' AND data_inicial = '2026-12-07'; -- I-E-6M INSPEÇÃO SPDA ECA33
UPDATE manutencao_planos SET data_inicial = '2027-03-15' WHERE ativo AND codigo = 'PM-0489' AND data_inicial = '2026-11-23'; -- I-E-6M INSPEÇÃO SPDA ECA43
UPDATE manutencao_planos SET data_inicial = '2027-03-15' WHERE ativo AND codigo = 'PM-0492' AND data_inicial = '2026-12-28'; -- I-E-6M INSPEÇÃO SPDA ECA44
UPDATE manutencao_planos SET data_inicial = '2026-12-14' WHERE ativo AND codigo = 'PM-0365' AND data_inicial = '2027-01-18'; -- P-E-3M RESIST ISOL MOT DESP TRIP 48
UPDATE manutencao_planos SET data_inicial = '2026-11-16' WHERE ativo AND codigo = 'PM-0433' AND data_inicial = '2026-12-07'; -- P-E-2M FUNCIONAMENTO SENSORES TC 07
ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;
COMMIT;

-- Conferência: deve listar 6 planos com a data nova.
SELECT codigo, nome, data_inicial FROM manutencao_planos
 WHERE codigo IN ('PM-0469', 'PM-0477', 'PM-0489', 'PM-0492', 'PM-0365', 'PM-0433')
 ORDER BY data_inicial, codigo;
