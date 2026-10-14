-- Migration: 071_manutencao_planos_6m_junto_do_3m
-- Complemento da 070. A 070 alinhou cada período com o 1M do grupo, mas o 6M ainda caía
-- um mês antes/depois do 3M do mesmo grupo — nunca saíam na mesma visita. Ex.: Prédio 25
-- com 3M feito em 18/09 (próximo 21/11) e 6M marcado pra 21/10, sem execução registrada.
-- Regra do usuário (2026-10-14): "a 6M tem que sair junto com a próxima 3M". O alerta
-- "Fora da visita do grupo" passou a comparar o 6M com todo período que o divide (3M e 1M).
--
-- Antecipa até 2 meses (1/3 do 6M):
--   CCOT 01/02, Automação, PT ......... 6M -> 02/11 (com o 3M)
--   Lubrificação ...................... 6M 12/01 -> 12/11
--   ECA 33 (BMS) ...................... 6M 28/11 -> 28/10 (com o 3M dos stackers)
-- Atrasa, confirmado com o usuário:
--   Prédio 25 (5 splits) .............. 6M 21/10 -> 21/11 (com o 3M; o 3M foi feito em 18/09)
--   Salas elétricas STK (4 splits) .... 6M 12/11 -> 12/01 (3M feito em 12/10, próximo 12/01)
--   Cofre, Oficina, Planejamento ...... 6M 26/11 -> 26/01 (Oficina/Planejamento voltam pra
--                                        data de antes da 070; Cofre atrasa 2 meses)
-- Continuam separados (não cabem no limite, decisão do usuário): Sala 46, 6M cabines STR,
-- 6M ECA 41/42.
--
-- Cada UPDATE confere a data_inicial atual (estado depois da 070).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0108' AND data_inicial = '2026-12-02'; -- P-R-6M CCOT 01
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0111' AND data_inicial = '2026-12-02'; -- P-R-6M CCOT 02
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0114' AND data_inicial = '2026-12-02'; -- P-R-6M SL AUTOMAÇÃO
UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND codigo = 'PM-0115' AND data_inicial = '2026-12-02'; -- P-R-6M SL PT
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND codigo = 'PM-0057' AND data_inicial = '2027-01-12'; -- P-R-6M SL LUBRIFICAÇÃO
UPDATE manutencao_planos SET data_inicial = '2026-10-28' WHERE ativo AND codigo = 'PM-0194' AND data_inicial = '2026-11-28'; -- P-SPCI-6M CORREIA ECA 33
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0021' AND data_inicial = '2026-10-21'; -- P-R-6M PRÉDIO 25 (616)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0023' AND data_inicial = '2026-10-21'; -- P-R-6M PRÉDIO 25 (617)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0026' AND data_inicial = '2026-10-21'; -- P-R-6M PRÉDIO 25 (618)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0029' AND data_inicial = '2026-10-21'; -- P-R-6M PRÉDIO 25 (619)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND codigo = 'PM-0031' AND data_inicial = '2026-10-21'; -- P-R-6M PRÉDIO 25 (620)
UPDATE manutencao_planos SET data_inicial = '2027-01-12' WHERE ativo AND codigo = 'PM-0078' AND data_inicial = '2026-11-12'; -- P-R-6M SPLIT 1 SL ELET STK01
UPDATE manutencao_planos SET data_inicial = '2027-01-12' WHERE ativo AND codigo = 'PM-0079' AND data_inicial = '2026-11-12'; -- P-R-6M SPLIT 2 SL ELET STK01
UPDATE manutencao_planos SET data_inicial = '2027-01-12' WHERE ativo AND codigo = 'PM-0082' AND data_inicial = '2026-11-12'; -- P-R-6M SPLIT 1 SL ELET STK02
UPDATE manutencao_planos SET data_inicial = '2027-01-12' WHERE ativo AND codigo = 'PM-0085' AND data_inicial = '2026-11-12'; -- P-R-6M SPLIT 2 SL ELET STK02
UPDATE manutencao_planos SET data_inicial = '2027-01-26' WHERE ativo AND codigo = 'PM-0126' AND data_inicial = '2026-11-26'; -- P-R-6M SL COFRE
UPDATE manutencao_planos SET data_inicial = '2027-01-26' WHERE ativo AND codigo = 'PM-0130' AND data_inicial = '2026-11-26'; -- P-R-6M SL ELETRICA (OFICINA)
UPDATE manutencao_planos SET data_inicial = '2027-01-26' WHERE ativo AND codigo = 'PM-0123' AND data_inicial = '2026-11-26'; -- P-R-6M SL SUPERV./PLANEJ
ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;
COMMIT;

-- Conferência: deve listar 18 planos com a data nova.
SELECT codigo, nome, data_inicial FROM manutencao_planos
 WHERE codigo IN ('PM-0108', 'PM-0111', 'PM-0114', 'PM-0115', 'PM-0057', 'PM-0194', 'PM-0021', 'PM-0023', 'PM-0026',
                  'PM-0029', 'PM-0031', 'PM-0078', 'PM-0079', 'PM-0082', 'PM-0085', 'PM-0126', 'PM-0130', 'PM-0123')
 ORDER BY data_inicial, codigo;
