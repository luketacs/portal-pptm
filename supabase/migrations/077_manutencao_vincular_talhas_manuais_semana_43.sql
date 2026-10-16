-- Migration: 077_manutencao_vincular_talhas_manuais_semana_43
-- I-M-2M PREV TALHAS MANUAIS OFICINA PPTM (PM-0633) aparecia na semana 43 duas vezes:
-- programada (OS 003214, Claudiane e Moacir Jones, dia 20/10) e ainda em "Preventivas
-- da semana" pra programar. As duas OS foram lançadas sem vínculo com o plano
-- (plano_preventivo_id vazio), então o plano não tinha ciclo e seguia como pendente.
--
-- Vincula as duas OS ao plano com o ciclo de 19/10 (a ocorrência do plano, mesma data
-- que a tela grava ao programar pela sugestão — ver dataCicloAoProgramar). O trigger
-- portal_sincronizar_ciclo (057) cria o ciclo; as duas cópias apontam pro mesmo ciclo
-- (ON CONFLICT), e o plano sai da lista de pendentes. Próxima ocorrência: 19/12.
--
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

-- Conferência antes: deve listar as 2 OS 003214 da semana 43, sem plano.
SELECT id, numero_os, tecnico_nome, dias_previstos, plano_preventivo_id, ciclo_data_prevista
  FROM manutencao_programacao
 WHERE id IN ('40b2ec29-defa-405f-9e22-c6058231e117', 'c4e40f11-cd82-41e4-87d7-71ec4e75a25e');

UPDATE manutencao_programacao
   SET plano_preventivo_id = 'bc29d3f7-852e-4379-b76d-b5d97b358eca', -- PM-0633
       ciclo_data_prevista = '2026-10-19'
 WHERE id IN ('40b2ec29-defa-405f-9e22-c6058231e117', 'c4e40f11-cd82-41e4-87d7-71ec4e75a25e')
   AND semana_inicio = '2026-10-19' AND numero_os = '003214' AND plano_preventivo_id IS NULL;

COMMIT;

-- Conferência depois: 1 ciclo do PM-0633 em 19/10 apontando pra uma das 2 OS.
SELECT c.data_prevista, c.ordem_id, o.numero_os, o.tecnico_nome
  FROM manutencao_ciclos c LEFT JOIN manutencao_programacao o ON o.id = c.ordem_id
 WHERE c.plano_id = 'bc29d3f7-852e-4379-b76d-b5d97b358eca';
