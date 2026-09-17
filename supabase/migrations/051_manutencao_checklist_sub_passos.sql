-- Checklist ganha sub-passo opcional por item ("se aplicável") — um array de texto
-- puro (TEXT[]) não representa isso, precisa virar JSONB com {texto, subPassos: []}
-- por item. Migra o dado já existente (cada string vira um passo sem sub-passo, nada
-- se perde) e troca o tipo das duas colunas que guardam checklist: o modelo (plano) e
-- a cópia gravada na OS no momento em que ela é vinculada a um plano.

ALTER TABLE manutencao_planos ALTER COLUMN atividades DROP DEFAULT;
ALTER TABLE manutencao_planos
  ALTER COLUMN atividades TYPE JSONB
  USING (
    CASE
      WHEN atividades IS NULL OR array_length(atividades, 1) IS NULL THEN '[]'::jsonb
      ELSE (
        SELECT jsonb_agg(jsonb_build_object('texto', elem, 'subPassos', '[]'::jsonb))
        FROM unnest(atividades) AS elem
      )
    END
  );
ALTER TABLE manutencao_planos ALTER COLUMN atividades SET DEFAULT '[]'::jsonb;
ALTER TABLE manutencao_planos ALTER COLUMN atividades SET NOT NULL;

ALTER TABLE manutencao_programacao
  ALTER COLUMN checklist TYPE JSONB
  USING (
    CASE
      WHEN checklist IS NULL OR array_length(checklist, 1) IS NULL THEN NULL
      ELSE (
        SELECT jsonb_agg(jsonb_build_object('texto', elem, 'subPassos', '[]'::jsonb))
        FROM unnest(checklist) AS elem
      )
    END
  );
