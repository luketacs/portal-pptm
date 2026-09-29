-- Fundo Fixo: a partir de setembro/2026 os gestores aprovadores são Italo Rosse e João
-- Nunes. Tudo de setembro em diante que ficou com "Charles Rabelo" como gestor aprovador
-- passa para "Italo Rosse". Meses anteriores ficam como estão (histórico).
-- (No portal, a lista de aprovadores já troca Charles por Italo — ver
-- FUNDO_FIXO_GESTORES em fundo-fixo.service.ts.)

-- 1) Conferência antes: o que vai mudar.
SELECT mes_referencia, status, solicitante_nome, material, gestor_aprovador
  FROM fundo_fixo_solicitacoes
 WHERE mes_referencia >= '2026-09' AND gestor_aprovador ILIKE 'charles%'
 ORDER BY mes_referencia, created_at;

BEGIN;

-- portal_validar_fundo (migration 054) só libera alteração pra sessão de Admin /
-- service_role — no SQL Editor não há usuário logado e ela barraria o UPDATE em
-- solicitação já comprada. Desligada só dentro desta transação.
ALTER TABLE fundo_fixo_solicitacoes DISABLE TRIGGER portal_validar_fundo;

UPDATE fundo_fixo_solicitacoes
   SET gestor_aprovador = 'Italo Rosse'
 WHERE mes_referencia >= '2026-09' AND gestor_aprovador ILIKE 'charles%';

ALTER TABLE fundo_fixo_solicitacoes ENABLE TRIGGER portal_validar_fundo;

COMMIT;

-- 2) Conferência depois: aprovadores por mês de setembro em diante (Charles não deve aparecer).
SELECT mes_referencia, gestor_aprovador, count(*) AS solicitacoes
  FROM fundo_fixo_solicitacoes
 WHERE mes_referencia >= '2026-09'
 GROUP BY 1, 2 ORDER BY 1, 2;
