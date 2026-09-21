BEGIN;
ALTER TABLE public.manutencao_programacao ADD COLUMN IF NOT EXISTS ciclo_data_prevista date;
-- Corrige ciclos que ficaram apontando para uma ordem já desvinculada/trocada.
DELETE FROM public.manutencao_ciclos c USING public.manutencao_programacao o
WHERE c.ordem_id = o.id AND c.plano_id IS DISTINCT FROM o.plano_preventivo_id;
-- Preserva datas já registradas. Não inventa datas para o histórico sem ciclo.
UPDATE public.manutencao_programacao o SET ciclo_data_prevista = c.data_prevista
FROM public.manutencao_ciclos c WHERE c.ordem_id = o.id AND c.plano_id = o.plano_preventivo_id;

CREATE OR REPLACE FUNCTION public.portal_preparar_ciclo() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tipo <> 'ordem' OR NEW.plano_preventivo_id IS NULL THEN
    NEW.plano_preventivo_id := NULL;
    NEW.ciclo_data_prevista := NULL;
  ELSE
    IF NEW.ciclo_data_prevista IS NULL THEN
      SELECT min(d)::date INTO NEW.ciclo_data_prevista FROM unnest(NEW.dias_previstos) d;
      IF NEW.ciclo_data_prevista IS NULL THEN
        RAISE EXCEPTION 'Informe a data do ciclo do plano antes de salvar a ordem.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_preparar_ciclo BEFORE INSERT OR UPDATE ON public.manutencao_programacao
FOR EACH ROW EXECUTE FUNCTION public.portal_preparar_ciclo();

-- Executa somente por trigger: não expõe RPC que contorne permissões. O RLS da
-- programação autoriza a operação principal; ordem e ciclo confirmam/revertem juntos.
CREATE OR REPLACE FUNCTION public.portal_sincronizar_ciclo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE substituto uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' OR OLD.plano_preventivo_id IS DISTINCT FROM NEW.plano_preventivo_id
        OR OLD.ciclo_data_prevista IS DISTINCT FROM NEW.ciclo_data_prevista THEN
      SELECT id INTO substituto FROM public.manutencao_programacao
        WHERE id <> OLD.id AND plano_preventivo_id = OLD.plano_preventivo_id
          AND ciclo_data_prevista = OLD.ciclo_data_prevista ORDER BY id LIMIT 1;
      IF substituto IS NULL THEN
        DELETE FROM public.manutencao_ciclos WHERE ordem_id = OLD.id;
      ELSE
        UPDATE public.manutencao_ciclos SET ordem_id = substituto WHERE ordem_id = OLD.id;
      END IF;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.plano_preventivo_id IS NOT NULL THEN
    INSERT INTO public.manutencao_ciclos(plano_id, data_prevista, ordem_id)
      VALUES (NEW.plano_preventivo_id, NEW.ciclo_data_prevista, NEW.id)
      ON CONFLICT (plano_id, data_prevista) DO UPDATE SET ordem_id = EXCLUDED.ordem_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.portal_sincronizar_ciclo() FROM PUBLIC;
CREATE TRIGGER portal_sincronizar_ciclo AFTER INSERT OR UPDATE ON public.manutencao_programacao
FOR EACH ROW EXECUTE FUNCTION public.portal_sincronizar_ciclo();
-- Antes do DELETE a FK ainda não zerou ordem_id; permite recuperar outro técnico.
CREATE OR REPLACE FUNCTION public.portal_remover_ciclo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE substituto uuid;
BEGIN
  SELECT id INTO substituto FROM public.manutencao_programacao
    WHERE id <> OLD.id AND plano_preventivo_id = OLD.plano_preventivo_id
      AND ciclo_data_prevista = OLD.ciclo_data_prevista ORDER BY id LIMIT 1;
  IF substituto IS NULL THEN
    DELETE FROM public.manutencao_ciclos WHERE ordem_id = OLD.id;
  ELSE
    UPDATE public.manutencao_ciclos SET ordem_id = substituto WHERE ordem_id = OLD.id;
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.portal_remover_ciclo() FROM PUBLIC;
CREATE TRIGGER portal_remover_ciclo BEFORE DELETE ON public.manutencao_programacao
FOR EACH ROW EXECUTE FUNCTION public.portal_remover_ciclo();
-- O ledger passa a ser administrado pela ordem, inclusive em semanas fechadas.
DROP POLICY planejador_ciclos ON public.manutencao_ciclos;
COMMIT;
