-- "duplicate key value violates unique constraint manutencao_planos_codigo_key" ao
-- cadastrar plano NOVO. O código (PM-XXXX) vem da sequence manutencao_planos_codigo_seq
-- (DEFAULT da coluna, migration 032). Quando algum plano entra com o código já escrito
-- (import/cópia pelo Table Editor ou SQL, restauração de backup), a sequence não anda
-- junto e fica ATRÁS do maior código existente — o próximo cadastro pelo portal tenta
-- um código que já existe e o banco recusa.
--
-- 1) Sincroniza a sequence com o maior código existente.
-- 2) Trigger que pula código ocupado: mesmo que isso volte a acontecer, o cadastro pelo
--    portal pega o próximo número livre em vez de dar erro.

-- Conferência antes: se proximo_da_sequence <= maior_codigo, esse é o problema.
SELECT
  (SELECT max(substring(codigo FROM '^PM-(\d+)$')::int) FROM manutencao_planos) AS maior_codigo,
  (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM manutencao_planos_codigo_seq) AS proximo_da_sequence;

BEGIN;

SELECT setval('manutencao_planos_codigo_seq',
  GREATEST((SELECT coalesce(max(substring(codigo FROM '^PM-(\d+)$')::int), 0) FROM manutencao_planos), 1));

CREATE OR REPLACE FUNCTION public.portal_codigo_plano_livre() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.manutencao_planos WHERE codigo = NEW.codigo) LOOP
    NEW.codigo := 'PM-' || lpad(nextval('public.manutencao_planos_codigo_seq')::text, 4, '0');
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS portal_codigo_plano_livre ON public.manutencao_planos;
CREATE TRIGGER portal_codigo_plano_livre BEFORE INSERT ON public.manutencao_planos
FOR EACH ROW EXECUTE FUNCTION public.portal_codigo_plano_livre();

COMMIT;

-- Conferência depois: proximo_da_sequence tem que ser maior_codigo + 1.
SELECT
  (SELECT max(substring(codigo FROM '^PM-(\d+)$')::int) FROM manutencao_planos) AS maior_codigo,
  (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM manutencao_planos_codigo_seq) AS proximo_da_sequence;
