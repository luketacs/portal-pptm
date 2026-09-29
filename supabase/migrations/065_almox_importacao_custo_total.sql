-- "DELETE requires a WHERE clause" ao importar Movimentações/Solicitações/Saldo do
-- almoxarifado. A migration 055 (importação atômica) apaga a tabela inteira com
-- `DELETE FROM tabela` sem WHERE, e o Supabase carrega a extensão pg_safeupdate nas
-- chamadas pela API — ela recusa DELETE/UPDATE sem WHERE, mesmo dentro de função.
-- Toda importação desde 21/09 falhava nesse ponto (sem perda de dados: a transação
-- inteira é desfeita). Mesma função, só com `WHERE true` no DELETE.
--
-- Também: valor das saídas/entradas. O portal calculava qtd × "Custo Medio" (coluna 5
-- do MATR900), que é o custo médio ATUAL do produto, não o do movimento — produto que
-- zerou o estoque tem custo médio 0 e a saída valia R$ 0 (ex.: CONJ CONICO RED BREVINI,
-- 2 un em mar/2026 = R$ 115.169,89 no relatório, R$ 0 no portal). Jan–Set/2026: portal
-- R$ 1,12 mi × relatório R$ 1,67 mi. Novas colunas guardam o custo do próprio
-- movimento (colunas "ENTRADAS CUSTO TOTAL", "SAIDAS CUSTO TOTAL", "CUSTO MEDIO DO
-- MOVIMENTO") e o tipo (C.F: RE0 requisição, DE0 devolução, RE4/DE4 transferência,
-- 1556/2556/2407 nota fiscal). A função de importação insere todas as colunas da
-- tabela automaticamente — basta importar o MATR900 de novo depois de rodar isto.

BEGIN;

ALTER TABLE public.almox_movimentacoes
  ADD COLUMN IF NOT EXISTS tipo_movimento      text,
  ADD COLUMN IF NOT EXISTS custo_movimento     numeric(15,4),
  ADD COLUMN IF NOT EXISTS entrada_custo_total numeric(15,2),
  ADD COLUMN IF NOT EXISTS saida_custo_total   numeric(15,2);

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
    -- WHERE true: pg_safeupdate barra DELETE sem WHERE (ver cabeçalho).
    EXECUTE format('DELETE FROM public.%I WHERE true', tabela);
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

COMMIT;

-- Conferência DEPOIS de importar o MATR900 de novo pelo portal: saídas por mês pelo
-- custo do movimento (deve bater com a soma da coluna "SAIDAS CUSTO TOTAL" do relatório).
SELECT to_char(data_operacao, 'YYYY-MM') AS mes, tipo_movimento,
       sum(saida_custo_total) AS saidas_rs, sum(qtd_saida * custo_medio) AS calculo_antigo_rs
  FROM almox_movimentacoes WHERE qtd_saida > 0
 GROUP BY 1, 2 ORDER BY 1, 2;
