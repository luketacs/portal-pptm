BEGIN;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS released_at timestamptz;
-- Não inferir a liberação histórica a partir de updated_at: edições posteriores
-- alteram esse campo. Registros antigos sem evidência ficam fora da média.
CREATE OR REPLACE FUNCTION public.material_release_timestamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'liberado' THEN
    IF TG_OP = 'INSERT' THEN NEW.released_at := now();
    ELSIF OLD.status IS DISTINCT FROM 'liberado' THEN NEW.released_at := now();
    ELSE NEW.released_at := OLD.released_at;
    END IF;
  ELSE NEW.released_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_release_timestamp BEFORE INSERT OR UPDATE ON public.materials
FOR EACH ROW EXECUTE FUNCTION public.material_release_timestamp();
COMMIT;
