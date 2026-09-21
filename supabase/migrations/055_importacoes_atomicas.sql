BEGIN;

-- Uma chamada RPC é uma transação: qualquer erro de conversão, inserção ou log
-- desfaz também a exclusão. O lock serializa importações concorrentes da mesma tabela.
CREATE OR REPLACE FUNCTION public.importar_almox_atomico(
  p_tipo text, p_registros jsonb, p_nome_arquivo text, p_usuario uuid
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE tabela text; colunas text; inseridos integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_usuario AND role = 'Admin'
  ) THEN RAISE EXCEPTION 'Apenas administradores podem importar.' USING ERRCODE = '42501'; END IF;
  IF p_registros IS NULL OR jsonb_typeof(p_registros) <> 'array' THEN
    RAISE EXCEPTION 'Arquivo inválido.';
  END IF;
  tabela := CASE p_tipo WHEN 'movimentacoes' THEN 'almox_movimentacoes'
    WHEN 'solicitacoes' THEN 'almox_solicitacoes' WHEN 'saldo' THEN 'almox_saldo_real'
    WHEN 'status_sas' THEN 'almox_solicitacoes' END;
  IF tabela IS NULL THEN RAISE EXCEPTION 'Tipo de importação inválido.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public.' || tabela, 0));
  IF p_tipo = 'status_sas' THEN
    UPDATE public.almox_solicitacoes SET status = 'aberta' WHERE status = 'encerrada';
    UPDATE public.almox_solicitacoes s SET status = 'encerrada'
      FROM jsonb_to_recordset(p_registros) AS r(sa_numero text, produto_codigo text)
      WHERE s.sa_numero = r.sa_numero AND s.produto_codigo = r.produto_codigo;
    GET DIAGNOSTICS inseridos = ROW_COUNT;
  ELSE
    IF jsonb_array_length(p_registros) = 0 THEN RAISE EXCEPTION 'Arquivo vazio: dados anteriores preservados.'; END IF;
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO colunas
      FROM pg_attribute WHERE attrelid = ('public.' || tabela)::regclass
        AND attnum > 0 AND NOT attisdropped AND attname NOT IN ('id','created_at');
    EXECUTE format('DELETE FROM public.%I', tabela);
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)', tabela, colunas, colunas, tabela)
      USING p_registros;
    GET DIAGNOSTICS inseridos = ROW_COUNT;
  END IF;
  INSERT INTO public.almox_importacoes(tipo,nome_arquivo,total_registros,importado_por)
    VALUES(p_tipo,p_nome_arquivo,inseridos,p_usuario);
  RETURN inseridos;
END $$;
REVOKE ALL ON FUNCTION public.importar_almox_atomico(text,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_almox_atomico(text,jsonb,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.importar_apontamentos_atomico(p_registros jsonb, p_nome_arquivo text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE colunas text; inseridos integer;
BEGIN
  IF public.portal_role() IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem importar.' USING ERRCODE = '42501';
  END IF;
  IF p_registros IS NULL OR jsonb_typeof(p_registros) <> 'array' OR jsonb_array_length(p_registros) = 0 THEN
    RAISE EXCEPTION 'Arquivo vazio ou inválido: dados anteriores preservados.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_registros) r WHERE nullif(r->>'data','') IS NULL) THEN
    RAISE EXCEPTION 'Há apontamentos sem data válida.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public.apontamentos', 0));
  -- Substitui somente os dias presentes na planilha; os demais dias/anos permanecem.
  DELETE FROM public.apontamentos WHERE data IN (
    SELECT DISTINCT (r->>'data')::date FROM jsonb_array_elements(p_registros) r
  );
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO colunas
    FROM pg_attribute WHERE attrelid = 'public.apontamentos'::regclass
      AND attnum > 0 AND NOT attisdropped AND attname NOT IN ('id','importado_em');
  EXECUTE format('INSERT INTO public.apontamentos (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.apontamentos, $1)', colunas, colunas)
    USING p_registros;
  GET DIAGNOSTICS inseridos = ROW_COUNT;
  INSERT INTO public.apontamentos_importacoes(nome_arquivo,total_registros,importado_por)
    VALUES(p_nome_arquivo,inseridos,auth.uid());
  RETURN inseridos;
END $$;
REVOKE ALL ON FUNCTION public.importar_apontamentos_atomico(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_apontamentos_atomico(jsonb,text) TO authenticated;
COMMIT;
