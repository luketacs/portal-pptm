-- Migration: 073_manutencao_planos_mecanica_reancorar_execucao
-- Revisão da Mecânica (2026-10-14), mesma correção da 072 (Elétrica): planos executados
-- com a data inicial longe demais da execução, e a próxima saindo bem depois do período.
--
--   Análise de vibração / compressor / expulsor (1M, feitos 14/09) — data inicial
--   26/10-09/11 deixava 6-8 semanas sem preventiva. Passam pra 19/10 (próxima semana
--   aberta, 5 semanas depois da execução, dentro da tolerância de 1/3):
--     D-M-1M ANALISE VIBRACAO CORREIA 91EAC13, D-M-1M ANALISE DE VIBRACAO TC 91EAC05,
--     D-M-1M ANALISE DE VIBRACAO TC 91EAC07, P-M-1M COMPRESSOR SIST DESP TC 06,
--     I-M-1M EXPULSADOR METAIS EAC13
--   Coleta de óleo com data inicial perto demais da execução — pela regra do intervalo
--   mínimo (2/3 do período) a próxima ia pra muito depois:
--     D-L-3M COLETA/ANALISE OLEO EAC31 (feito 06/10) ... próxima 23/02/2027 -> 04/01/2027
--     D-L-6M COLETA/ANALISE OLEO ECA41 (feito 05/10) ... próxima 01/08/2027 -> 05/04/2027
--
-- Alinhamento de visita por KKS na Mecânica foi simulado e não aplicado: só tirava 22 de
-- 2065 visitas em 26 semanas e passava o limite de 120 numa semana.
--
-- Cada UPDATE confere a data_inicial atual.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0758' AND data_inicial = '2026-10-26'; -- D-M-1M ANALISE VIBRACAO CORREIA 91EAC13
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0832' AND data_inicial = '2026-11-02'; -- D-M-1M ANALISE DE VIBRACAO TC 91EAC05
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0850' AND data_inicial = '2026-11-09'; -- D-M-1M ANALISE DE VIBRACAO TC 91EAC07
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0563' AND data_inicial = '2026-11-09'; -- P-M-1M COMPRESSOR SIST DESP TC 06
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0570' AND data_inicial = '2026-10-26'; -- I-M-1M EXPULSADOR METAIS EAC13
UPDATE manutencao_planos SET data_inicial = '2027-01-04' WHERE ativo AND codigo = 'PM-0665' AND data_inicial = '2026-11-23'; -- D-L-3M COLETA/ANALISE OLEO EAC31
UPDATE manutencao_planos SET data_inicial = '2027-04-05' WHERE ativo AND codigo = 'PM-0670' AND data_inicial = '2027-02-01'; -- D-L-6M COLETA/ANALISE OLEO ECA41
ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;
COMMIT;

-- Conferência: deve listar 7 planos com a data nova.
SELECT codigo, nome, data_inicial FROM manutencao_planos
 WHERE codigo IN ('PM-0758', 'PM-0832', 'PM-0850', 'PM-0563', 'PM-0570', 'PM-0665', 'PM-0670')
 ORDER BY data_inicial, codigo;
