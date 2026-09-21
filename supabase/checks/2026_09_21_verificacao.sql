-- Somente leitura. Executar depois das migrations 054–057.
SELECT table_name, column_name, data_type
FROM information_schema.columns WHERE table_schema = 'public' AND
  ((table_name = 'materials' AND column_name = 'released_at') OR
   (table_name = 'manutencao_programacao' AND column_name = 'ciclo_data_prevista'));

SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
  'portal_role', 'importar_almox_atomico', 'importar_apontamentos_atomico',
  'portal_preparar_ciclo', 'portal_sincronizar_ciclo', 'portal_remover_ciclo', 'material_release_timestamp');

SELECT tablename, policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename IN (
  'fundo_fixo_solicitacoes','fundo_fixo_saques','manutencao_programacao',
  'manutencao_planos','manutencao_ciclos','apontamentos') ORDER BY tablename, policyname;

-- Deve retornar zero ciclos associados a outro plano.
SELECT count(*) AS ciclos_com_vinculo_incorreto FROM public.manutencao_ciclos c
JOIN public.manutencao_programacao o ON o.id = c.ordem_id
WHERE c.plano_id IS DISTINCT FROM o.plano_preventivo_id;

-- Diagnóstico do histórico: sem uma data confiável não há backfill automático.
SELECT o.id, o.semana_inicio, o.plano_preventivo_id FROM public.manutencao_programacao o
WHERE o.plano_preventivo_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.manutencao_ciclos c WHERE c.plano_id = o.plano_preventivo_id AND
    (c.ordem_id = o.id OR c.data_prevista = o.ciclo_data_prevista)
);
