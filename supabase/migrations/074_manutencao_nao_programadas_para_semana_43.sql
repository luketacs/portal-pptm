-- Migration: 074_manutencao_nao_programadas_para_semana_43
-- Fechamento da revisão de planos (2026-10-14), decisões do usuário:
--
-- 1. Exclui a OS sem número de D-L-6M COLETA/ANALISE OLEO TC06 (PM-0846) da semana 43:
--    já feita na semana 41 (OS 47936/47945), a sugestão só voltou pela regra antiga de
--    folga. O trigger portal_remover_ciclo apaga o ciclo de 26/10 junto.
--
-- 2. Preventivas que passaram sem OS desde 05/10 vão pra semana 43 (19 a 25/10): a data
--    inicial passa a ser a data na semana 43, então elas aparecem em "Preventivas da
--    semana" e saem de "Preventivas não programadas". Nenhuma tem ciclo que esconda a
--    nova data (a lista de não programadas só traz plano sem execução que cubra a
--    ocorrência).
--    Mecânica (planta parada: semanal/quinzenal contam como mensal):
--      cabos aço contrapeso TC05/ECA44 (3M), chapas desgaste chute TC05 (3M), motores
--      acionamento EAC31 (6M), emendas TC06 (4M), luneta giro / roda caçamba /
--      lubrificação semanal STR 02 (1S), insp correia TC05 (2S), nível óleo ECA42 (2S)
--    Elétrica (2S, mesmo calendário — só deixa de começar em agosto):
--      MOTORES/PAINEIS ECA45, MOTORES E PAINEIS TC 06 e TC 07, MOTORES/GAVETAS PATIO
--
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

-- Conferência antes: deve listar 1 OS (PM-0846, semana 19/10, sem número).
SELECT o.id, o.semana_inicio, o.numero_os, o.descricao, o.tecnico_nome, o.ciclo_data_prevista
  FROM manutencao_programacao o JOIN manutencao_planos p ON p.id = o.plano_preventivo_id
 WHERE p.codigo = 'PM-0846' AND o.semana_inicio = '2026-10-19' AND o.numero_os IS NULL;

DELETE FROM manutencao_programacao o
 USING manutencao_planos p
 WHERE p.id = o.plano_preventivo_id AND p.codigo = 'PM-0846'
   AND o.semana_inicio = '2026-10-19' AND o.numero_os IS NULL;

ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;
-- Mecânica
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0541' AND data_inicial < '2026-10-19'; -- P-L-3M CABOS ACO CONTRA PESO TC C05
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0543' AND data_inicial < '2026-10-19'; -- I-M-3M INSP CHAPAS DESGASTE CHUTE TC05
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0622' AND data_inicial < '2026-10-19'; -- P-L-6M MOTORES ACIONAMENTO EAC31
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0823' AND data_inicial < '2026-10-19'; -- P-L-3M CABOS ACO CONTRA PESO ECA44
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0847' AND data_inicial < '2026-10-19'; -- I-M-4M INSP OFF DE EMENDAS TC06
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0613' AND data_inicial < '2026-10-19'; -- P-L-1S LUBRIFICAR LUNETA GIRO STR 02
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0618' AND data_inicial < '2026-10-19'; -- I-M-2S INSP ON CORREIA/ACIONAMENTO TC05
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0655' AND data_inicial < '2026-10-19'; -- I-L-1S RODA CACAMBA/ROL GIRO STR 02
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0673' AND data_inicial < '2026-10-19'; -- I-L-2S INSPECAO NIVEL OLEO RED ECA42
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND codigo = 'PM-0713' AND data_inicial < '2026-10-19'; -- I-L-1S LUBRIFICACAO SEMANAL STACKER 02
-- Elétrica (2S): mesma sequência, começando na ocorrência da semana 43
UPDATE manutencao_planos SET data_inicial = '2026-10-20' WHERE ativo AND codigo = 'PM-0327' AND data_inicial = '2026-08-25'; -- I-E-2S MOTORES/PAINEIS ECA45
UPDATE manutencao_planos SET data_inicial = '2026-10-20' WHERE ativo AND codigo = 'PM-0496' AND data_inicial = '2026-08-25'; -- I-E-2S MOTORES E PAINEIS TC 06
UPDATE manutencao_planos SET data_inicial = '2026-10-21' WHERE ativo AND codigo = 'PM-0374' AND data_inicial = '2026-08-26'; -- I-E-2S MOTORES/GAVETAS PATIO
UPDATE manutencao_planos SET data_inicial = '2026-10-22' WHERE ativo AND codigo = 'PM-0341' AND data_inicial = '2026-08-27'; -- I-E-2S MOTORES E PAINEIS TC 07
ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;

COMMIT;

-- Conferência depois: 14 planos com data na semana 43 e nenhuma OS do PM-0846 na semana 43.
SELECT codigo, nome, data_inicial FROM manutencao_planos
 WHERE codigo IN ('PM-0541', 'PM-0543', 'PM-0622', 'PM-0823', 'PM-0847', 'PM-0613', 'PM-0618', 'PM-0655', 'PM-0673',
                  'PM-0713', 'PM-0327', 'PM-0496', 'PM-0374', 'PM-0341')
 ORDER BY codigo;
SELECT count(*) AS os_pm0846_semana43 FROM manutencao_programacao o JOIN manutencao_planos p ON p.id = o.plano_preventivo_id
 WHERE p.codigo = 'PM-0846' AND o.semana_inicio = '2026-10-19';
