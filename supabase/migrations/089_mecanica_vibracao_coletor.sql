-- Migration: 089_mecanica_vibracao_coletor
-- Ajustes da Análise de Vibração depois da 088 (pedido do Lucas, 13/11/2026):
--   1. Tipo da inspeção: "PIM" não existe — passa a ser "Programada" (ou Emergência).
--   2. Dados do coletor (coletor, sensor, nº de série, validade da calibração) preenchidos
--      UMA VEZ pelo inspetor, em mecanica_coletores (um registro por inspetor). Cada análise
--      continua guardando uma cópia dos dados do dia, pra o relatório antigo não mudar quando
--      a calibração for renovada.
--
-- Idempotente e tolerante: também completa a 088 se ela foi rodada numa versão anterior
-- (status Normal/Alerta/Perigo, sem os campos do relatório em Word).
--
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

-- ── Completa a 088 (no-op se já estiver na versão final) ────────────────────
ALTER TABLE public.mecanica_equipamentos ADD COLUMN IF NOT EXISTS desenho_url TEXT;
ALTER TABLE public.mecanica_equipamentos DROP CONSTRAINT IF EXISTS mecanica_equipamentos_grupo_iso_check;
ALTER TABLE public.mecanica_equipamentos ADD CONSTRAINT mecanica_equipamentos_grupo_iso_check
  CHECK (grupo_iso IN ('1', '2', '3', '4'));

ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS tipo_inspecao TEXT;
ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS gestor_area TEXT;
ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS sensor TEXT;
ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS instrumento_serie TEXT;
ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS calibracao_validade DATE;
ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS conclusao TEXT;
ALTER TABLE public.mecanica_analises ADD COLUMN IF NOT EXISTS situacao_sugerida TEXT;
ALTER TABLE public.mecanica_analises DROP COLUMN IF EXISTS severidade_inspetor;

-- Status A/B/C/D (versão antiga usava normal/alerta/perigo; a tabela ainda não tem uso real).
ALTER TABLE public.mecanica_analises DROP CONSTRAINT IF EXISTS mecanica_analises_situacao_check;
UPDATE public.mecanica_analises SET situacao = CASE situacao WHEN 'normal' THEN 'A' WHEN 'alerta' THEN 'C' WHEN 'perigo' THEN 'D' ELSE situacao END
 WHERE situacao IN ('normal', 'alerta', 'perigo');
ALTER TABLE public.mecanica_analises ADD CONSTRAINT mecanica_analises_situacao_check CHECK (situacao IN ('A', 'B', 'C', 'D'));
ALTER TABLE public.mecanica_analises DROP CONSTRAINT IF EXISTS mecanica_analises_situacao_sugerida_check;
ALTER TABLE public.mecanica_analises ADD CONSTRAINT mecanica_analises_situacao_sugerida_check
  CHECK (situacao_sugerida IN ('A', 'B', 'C', 'D'));

-- ── 1. Tipo: Programada / Emergência ────────────────────────────────────────
ALTER TABLE public.mecanica_analises DROP CONSTRAINT IF EXISTS mecanica_analises_tipo_inspecao_check;
UPDATE public.mecanica_analises SET tipo_inspecao = 'programada' WHERE tipo_inspecao IS NULL OR tipo_inspecao = 'pim';
ALTER TABLE public.mecanica_analises ALTER COLUMN tipo_inspecao SET DEFAULT 'programada';
ALTER TABLE public.mecanica_analises ALTER COLUMN tipo_inspecao SET NOT NULL;
ALTER TABLE public.mecanica_analises ADD CONSTRAINT mecanica_analises_tipo_inspecao_check
  CHECK (tipo_inspecao IN ('programada', 'emergencia'));

-- ── 2. Coletor de cada inspetor ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mecanica_coletores (
  usuario_id           UUID          PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  coletor              TEXT          NOT NULL CHECK (btrim(coletor) <> ''),
  sensor               TEXT,
  numero_serie         TEXT,
  calibracao_validade  DATE,
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.mecanica_coletores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_read ON public.mecanica_coletores;
DROP POLICY IF EXISTS vibracao_meu_coletor ON public.mecanica_coletores;
-- Todos leem (o relatório mostra o coletor); cada inspetor grava só o próprio.
CREATE POLICY portal_read ON public.mecanica_coletores FOR SELECT TO authenticated USING (true);
CREATE POLICY vibracao_meu_coletor ON public.mecanica_coletores FOR ALL TO authenticated
  USING (usuario_id = (SELECT auth.uid()))
  WITH CHECK (usuario_id = (SELECT auth.uid()) AND (SELECT public.portal_inspetor_vibracao()));

-- Primeiro cadastro: aproveita a última análise que cada inspetor já lançou (se houver).
INSERT INTO public.mecanica_coletores (usuario_id, coletor, sensor, numero_serie, calibracao_validade)
SELECT DISTINCT ON (a.criado_por_id) a.criado_por_id, a.instrumento, a.sensor, a.instrumento_serie, a.calibracao_validade
  FROM public.mecanica_analises a
 WHERE a.criado_por_id IS NOT NULL AND btrim(coalesce(a.instrumento, '')) <> ''
 ORDER BY a.criado_por_id, a.data_coleta DESC, a.numero DESC
ON CONFLICT (usuario_id) DO NOTHING;

COMMIT;
