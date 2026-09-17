-- Checklist ganha sub-passo opcional por item ("se aplicável") — um array de texto
-- puro (TEXT[]) não representa isso, precisa virar JSONB com {texto, subPassos: []}
-- por item. Migra o dado já existente (cada string vira um passo sem sub-passo, nada
-- se perde) e troca o tipo das duas colunas que guardam checklist: o modelo (plano) e
-- a cópia gravada na OS no momento em que ela é vinculada a um plano.
--
-- Em 3 passos (não dá pra usar ALTER COLUMN ... TYPE ... USING direto com subquery —
-- Postgres não aceita "subquery in transform expression"): cria a coluna nova em JSONB,
-- popula com UPDATE normal (que aceita subquery), depois derruba a antiga e renomeia.

ALTER TABLE manutencao_planos ADD COLUMN atividades_jsonb JSONB;
UPDATE manutencao_planos
SET atividades_jsonb = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('texto', elem, 'subPassos', '[]'::jsonb))
  FROM unnest(atividades) AS elem
), '[]'::jsonb);
ALTER TABLE manutencao_planos DROP COLUMN atividades;
ALTER TABLE manutencao_planos RENAME COLUMN atividades_jsonb TO atividades;
ALTER TABLE manutencao_planos ALTER COLUMN atividades SET DEFAULT '[]'::jsonb;
ALTER TABLE manutencao_planos ALTER COLUMN atividades SET NOT NULL;

ALTER TABLE manutencao_programacao ADD COLUMN checklist_jsonb JSONB;
UPDATE manutencao_programacao
SET checklist_jsonb = (
  SELECT jsonb_agg(jsonb_build_object('texto', elem, 'subPassos', '[]'::jsonb))
  FROM unnest(checklist) AS elem
)
WHERE checklist IS NOT NULL;
ALTER TABLE manutencao_programacao DROP COLUMN checklist;
ALTER TABLE manutencao_programacao RENAME COLUMN checklist_jsonb TO checklist;
