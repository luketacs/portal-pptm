BEGIN;

-- SECURITY DEFINER evita recursão ao consultar o papel dentro do RLS de profiles.
CREATE OR REPLACE FUNCTION public.portal_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.portal_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_role() TO authenticated;

-- As políticas antigas são permissivas e se combinam por OR. Removê-las é
-- necessário: adicionar uma política restrita sozinha não fecha a permissão.
DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fundo_fixo_solicitacoes', 'fundo_fixo_saques', 'manutencao_programacao',
    'manutencao_planos', 'manutencao_ciclos', 'manutencao_ferias', 'manutencao_atestados',
    'manutencao_apoio_equipes', 'manutencao_apoio_escala', 'manutencao_recursos_especiais',
    'manutencao_parada_planta', 'manutencao_semanas_fechadas',
    'manutencao_indicadores_manuais', 'manutencao_indicadores_historico',
    'apontamentos', 'apontamentos_importacoes', 'almox_metas_saida'
  ] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY portal_read ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY portal_admin ON public.%I FOR ALL TO authenticated USING (public.portal_role() = ''Admin'') WITH CHECK (public.portal_role() = ''Admin'')', t);
  END LOOP;
END $$;

CREATE POLICY solicitante_insert_fundo ON public.fundo_fixo_solicitacoes
FOR INSERT TO authenticated WITH CHECK (
  public.portal_role() = 'Solicitante' AND solicitante_id = auth.uid()
  AND status = 'pendente' AND aprovador_id IS NULL AND comprador_id IS NULL
  AND valor_final IS NULL AND data_aprovacao IS NULL AND data_compra IS NULL
);
CREATE POLICY responsavel_update_fundo ON public.fundo_fixo_solicitacoes
FOR UPDATE TO authenticated
USING (solicitante_id = auth.uid() OR comprador_id = auth.uid())
WITH CHECK (solicitante_id = auth.uid() OR comprador_id = auth.uid());

-- A pessoa responsável pode registrar uma compra aprovada/anexar notas; não pode
-- aprovar a própria solicitação, trocar o comprador ou editar pagamentos anteriores.
CREATE OR REPLACE FUNCTION public.portal_validar_fundo() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE permitidos text[];
BEGIN
  IF auth.role() = 'service_role' OR public.portal_role() = 'Admin' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pendente' OR NEW.aprovador_nome IS NOT NULL
      OR NEW.nota_fiscal_url IS NOT NULL OR coalesce(array_length(NEW.nota_fiscal_urls, 1), 0) > 0
      OR NEW.valor_final_secundario IS NOT NULL OR coalesce(NEW.reembolsado, false) THEN
      RAISE EXCEPTION 'Solicitação nova deve estar pendente, sem aprovação ou pagamento.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'aprovado' AND NEW.status = 'comprado' THEN
    permitidos := ARRAY['status','nota_fiscal_urls','valor_final','forma_pagamento',
      'forma_pagamento_secundaria','valor_final_secundario','data_compra','fornecedor'];
  ELSIF OLD.status = 'comprado' AND NEW.status = 'comprado' THEN
    permitidos := ARRAY['nota_fiscal_urls'];
  ELSE
    RAISE EXCEPTION 'Apenas o administrador pode alterar esta solicitação.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - permitidos) IS DISTINCT FROM (to_jsonb(OLD) - permitidos) THEN
    RAISE EXCEPTION 'Alteração de campos administrativos não permitida.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_validar_fundo BEFORE INSERT OR UPDATE ON public.fundo_fixo_solicitacoes
FOR EACH ROW EXECUTE FUNCTION public.portal_validar_fundo();

CREATE POLICY planejador_programacao ON public.manutencao_programacao
FOR ALL TO authenticated USING (
  public.portal_role() = 'Solicitante' AND NOT EXISTS (
    SELECT 1 FROM public.manutencao_semanas_fechadas s WHERE s.semana_inicio = manutencao_programacao.semana_inicio
  )
) WITH CHECK (
  public.portal_role() = 'Solicitante' AND NOT EXISTS (
    SELECT 1 FROM public.manutencao_semanas_fechadas s WHERE s.semana_inicio = manutencao_programacao.semana_inicio
  )
);
CREATE POLICY planejador_ciclos ON public.manutencao_ciclos
FOR ALL TO authenticated USING (public.portal_role() = 'Solicitante')
WITH CHECK (public.portal_role() = 'Solicitante');
CREATE POLICY planejador_reserva ON public.manutencao_planos
FOR UPDATE TO authenticated USING (public.portal_role() = 'Solicitante')
WITH CHECK (public.portal_role() = 'Solicitante');

CREATE OR REPLACE FUNCTION public.portal_validar_reserva_plano() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.portal_role() = 'Admin' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['numero_os_reservado','atualizado_em'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['numero_os_reservado','atualizado_em']) THEN
    RAISE EXCEPTION 'Apenas o administrador pode editar o cadastro do plano.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_validar_reserva_plano BEFORE UPDATE ON public.manutencao_planos
FOR EACH ROW EXECUTE FUNCTION public.portal_validar_reserva_plano();

-- Impede que uma política legada de autoedição permita elevar o próprio papel.
CREATE OR REPLACE FUNCTION public.portal_proteger_perfil() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'service_role' OR (auth.uid() IS NULL AND current_user IN ('postgres', 'supabase_admin')) OR public.portal_role() = 'Admin' THEN RETURN NEW; END IF;
  IF NEW.id <> auth.uid() OR
    (to_jsonb(NEW) - ARRAY['name','must_change_password','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['name','must_change_password','updated_at']) THEN
    RAISE EXCEPTION 'Alteração de campos administrativos não permitida.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_proteger_perfil BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.portal_proteger_perfil();
COMMIT;
