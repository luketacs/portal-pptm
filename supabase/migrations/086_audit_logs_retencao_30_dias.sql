-- Retenção da auditoria: audit_logs é a maior tabela do banco (~6,9 mil linhas em
-- 2026-10-23) e só cresce. Pedido do usuário: guardar 30 dias. Exceção: o histórico de
-- cadastro dos planos (tela Planos → "Alterações do cadastro", historicoAlteracoes em
-- manutencao-planos.service) vem daqui — esse fica pra sempre.
-- A limpeza roda todo dia às 03:00 (UTC) via pg_cron. Se a extensão não estiver
-- disponível, a função fica criada e dá pra rodar à mão: select public.limpar_audit_logs();

BEGIN;

CREATE OR REPLACE FUNCTION public.limpar_audit_logs() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH apagados AS (
    DELETE FROM public.audit_logs
    WHERE created_at < now() - interval '30 days'
      AND resource_type IS DISTINCT FROM 'manutencao_planos'
      AND event_type IS DISTINCT FROM 'manutencao_plano_checklist_replicado'
    RETURNING 1
  )
  SELECT count(*)::integer FROM apagados;
$$;

REVOKE ALL ON FUNCTION public.limpar_audit_logs() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'limpar-audit-logs';
    PERFORM cron.schedule('limpar-audit-logs', '0 3 * * *', 'select public.limpar_audit_logs()');
  ELSE
    RAISE NOTICE 'pg_cron indisponível: agende public.limpar_audit_logs() por outro meio.';
  END IF;
END $$;

COMMIT;
