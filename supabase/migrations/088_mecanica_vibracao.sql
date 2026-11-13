-- Migration: 088_mecanica_vibracao
-- Menu Mecânica — Análise de Vibração. Hoje o resultado das coletas fica só com o
-- inspetor e no coletor/software da SKF. O inspetor passa a lançar no portal o valor
-- global de cada ponto da rota, o diagnóstico e a recomendação; o portal mostra a
-- tendência por ponto e gera o relatório (PDF) de cada análise.
--
-- mecanica_equipamentos: um por TAG/KKS (ex.: 91EAC06AF001). grupo_iso/fundacao definem os
--   limites das zonas A/B/C/D da ISO 20816-3 (pontos de velocidade). desenho_url: imagem do
--   conjunto com os pontos de coleta (vai no relatório).
-- mecanica_pontos: pontos de medição do equipamento, com o mesmo nome do ponto no software
--   da SKF (ex.: "MG02 \ RD 3HE"). Guarda a grandeza, a unidade, os alarmes de alerta e
--   perigo configurados no SKF e, se o ponto é de rolamento, os fatores de defeito
--   (BPFO/BPFI/BSF/FTF em múltiplos da rotação) para identificar a frequência achada.
--   Ponto que sai da rota fica ativo = false (a tendência antiga continua lendo o id).
-- mecanica_analises: uma coleta de um equipamento, numerada AV-001. leituras em jsonb:
--   [{ pontoId, ponto, grandeza, unidade, valor, alarmeAlerta, alarmePerigo, fatorCrista,
--   curtose, frequenciaHz, observacao }] — nome e alarmes são CÓPIA do ponto no dia (se o
--   alarme mudar depois, a análise antiga continua avaliada pelo que valia).
--   situacao: STATUS do relatório, zona A/B/C/D (como nos relatórios em Word da equipe).
--   situacao_sugerida: o que o portal calculou (pior ponto de velocidade pela ISO 20816-3;
--   alarme do SKF em alerta sobe para C, em perigo para D). O inspetor confirma ou muda
--   (ex.: B com falha incipiente achada no espectro) — as duas ficam gravadas.
--
-- Permissões (pedido do Lucas): todo mundo consulta; só o inspetor de vibração (flag no
-- perfil, ligada pelo Admin na tela Usuários) ou Admin cadastra e lança. Análise só é
-- corrigida por quem lançou (ou Admin). Excluir equipamento/análise: só Admin.
--
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

-- ── Inspetor de vibração ────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS inspetor_vibracao BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.portal_inspetor_vibracao() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT inspetor_vibracao OR role::text = 'Admin' FROM public.profiles WHERE id = auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION public.portal_inspetor_vibracao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_inspetor_vibracao() TO authenticated;

-- ── Equipamentos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mecanica_equipamentos (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tag              TEXT          NOT NULL CHECK (btrim(tag) <> ''),
  descricao        TEXT,
  area             TEXT,
  tipo_maquina     TEXT,
  fabricante       TEXT,
  modelo           TEXT,
  potencia_kw      NUMERIC(10,2) CHECK (potencia_kw IS NULL OR potencia_kw > 0),
  rotacao_rpm      NUMERIC(8,1)  CHECK (rotacao_rpm IS NULL OR rotacao_rpm > 0),
  -- ISO 20816-3: grupo 1 = acima de 300 kW; grupo 2 = 15 a 300 kW.
  -- 3 = bomba com acionador externo; 4 = bomba com acionador integrado (gráfico da equipe).
  grupo_iso        TEXT          CHECK (grupo_iso IN ('1', '2', '3', '4')),
  fundacao         TEXT          CHECK (fundacao IN ('rigida', 'flexivel')),
  desenho_url      TEXT,
  observacoes      TEXT,
  criado_por_id    UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_por_nome  TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mecanica_equipamentos_tag ON public.mecanica_equipamentos (upper(btrim(tag)));

-- ── Pontos de medição ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mecanica_pontos (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  equipamento_id   UUID          NOT NULL REFERENCES public.mecanica_equipamentos(id) ON DELETE CASCADE,
  nome             TEXT          NOT NULL CHECK (btrim(nome) <> ''),
  descricao        TEXT,
  grandeza         TEXT          NOT NULL CHECK (grandeza IN ('envelope', 'velocidade', 'aceleracao', 'deslocamento', 'temperatura')),
  unidade          TEXT          NOT NULL CHECK (btrim(unidade) <> ''),
  alarme_alerta    NUMERIC(12,3) CHECK (alarme_alerta IS NULL OR alarme_alerta > 0),
  alarme_perigo    NUMERIC(12,3) CHECK (alarme_perigo IS NULL OR alarme_perigo > 0),
  rolamento        TEXT,
  -- Frequências de defeito em múltiplos da rotação do eixo (ordens).
  fator_bpfo       NUMERIC(8,4)  CHECK (fator_bpfo IS NULL OR fator_bpfo > 0),
  fator_bpfi       NUMERIC(8,4)  CHECK (fator_bpfi IS NULL OR fator_bpfi > 0),
  fator_bsf        NUMERIC(8,4)  CHECK (fator_bsf IS NULL OR fator_bsf > 0),
  fator_ftf        NUMERIC(8,4)  CHECK (fator_ftf IS NULL OR fator_ftf > 0),
  ordem            INTEGER       NOT NULL DEFAULT 0,
  ativo            BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT mecanica_pontos_alarmes_check
    CHECK (alarme_alerta IS NULL OR alarme_perigo IS NULL OR alarme_perigo > alarme_alerta)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mecanica_pontos_nome ON public.mecanica_pontos (equipamento_id, upper(btrim(nome)));
CREATE INDEX IF NOT EXISTS idx_mecanica_pontos_equip ON public.mecanica_pontos (equipamento_id, ordem);

-- ── Análises ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mecanica_analises (
  id                   UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  numero               BIGINT        GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  equipamento_id       UUID          NOT NULL REFERENCES public.mecanica_equipamentos(id) ON DELETE CASCADE,
  data_coleta          DATE          NOT NULL,
  rotacao_rpm          NUMERIC(8,1)  CHECK (rotacao_rpm IS NULL OR rotacao_rpm > 0),
  condicao_operacao    TEXT,
  os_numero            TEXT,
  tipo_inspecao        TEXT          NOT NULL DEFAULT 'pim' CHECK (tipo_inspecao IN ('pim', 'emergencia')),
  gestor_area          TEXT,
  instrumento          TEXT,
  sensor               TEXT,
  instrumento_serie    TEXT,
  calibracao_validade  DATE,
  leituras             JSONB         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(leituras) = 'array'),
  -- Diagnóstico do inspetor
  modos_falha          JSONB         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(modos_falha) = 'array'),
  diagnostico          TEXT,
  recomendacao         TEXT,
  conclusao            TEXT,
  prazo                DATE,
  situacao             TEXT          NOT NULL CHECK (situacao IN ('A', 'B', 'C', 'D')),
  situacao_sugerida    TEXT          CHECK (situacao_sugerida IN ('A', 'B', 'C', 'D')),
  anexos               JSONB         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(anexos) = 'array'),
  observacoes          TEXT,
  criado_por_id        UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_por_nome      TEXT          NOT NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mecanica_analises_equip ON public.mecanica_analises (equipamento_id, data_coleta);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.mecanica_equipamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mecanica_pontos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mecanica_analises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_read ON public.mecanica_equipamentos;
DROP POLICY IF EXISTS vibracao_cadastrar ON public.mecanica_equipamentos;
DROP POLICY IF EXISTS vibracao_editar ON public.mecanica_equipamentos;
DROP POLICY IF EXISTS portal_admin_excluir ON public.mecanica_equipamentos;
DROP POLICY IF EXISTS portal_read ON public.mecanica_pontos;
DROP POLICY IF EXISTS vibracao_pontos ON public.mecanica_pontos;
DROP POLICY IF EXISTS portal_read ON public.mecanica_analises;
DROP POLICY IF EXISTS vibracao_lancar ON public.mecanica_analises;
DROP POLICY IF EXISTS vibracao_corrigir ON public.mecanica_analises;
DROP POLICY IF EXISTS portal_admin_excluir ON public.mecanica_analises;

CREATE POLICY portal_read ON public.mecanica_equipamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY vibracao_cadastrar ON public.mecanica_equipamentos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.portal_inspetor_vibracao()) AND criado_por_id = (SELECT auth.uid()));
CREATE POLICY vibracao_editar ON public.mecanica_equipamentos FOR UPDATE TO authenticated
  USING ((SELECT public.portal_inspetor_vibracao())) WITH CHECK ((SELECT public.portal_inspetor_vibracao()));
CREATE POLICY portal_admin_excluir ON public.mecanica_equipamentos FOR DELETE TO authenticated
  USING ((SELECT public.portal_role()) = 'Admin');

-- Pontos: o inspetor cadastra, edita e remove (ponto sem leitura pode sair de vez; com
-- leitura o app só desativa, mas a análise guarda cópia do nome e dos alarmes).
CREATE POLICY portal_read ON public.mecanica_pontos FOR SELECT TO authenticated USING (true);
CREATE POLICY vibracao_pontos ON public.mecanica_pontos FOR ALL TO authenticated
  USING ((SELECT public.portal_inspetor_vibracao())) WITH CHECK ((SELECT public.portal_inspetor_vibracao()));

CREATE POLICY portal_read ON public.mecanica_analises FOR SELECT TO authenticated USING (true);
CREATE POLICY vibracao_lancar ON public.mecanica_analises FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.portal_inspetor_vibracao()) AND criado_por_id = (SELECT auth.uid()));
CREATE POLICY vibracao_corrigir ON public.mecanica_analises FOR UPDATE TO authenticated
  USING (criado_por_id = (SELECT auth.uid()) OR (SELECT public.portal_role()) = 'Admin')
  WITH CHECK (criado_por_id = (SELECT auth.uid()) OR (SELECT public.portal_role()) = 'Admin');
CREATE POLICY portal_admin_excluir ON public.mecanica_analises FOR DELETE TO authenticated
  USING ((SELECT public.portal_role()) = 'Admin');

-- Quem lançou e o número não mudam na correção (mesma função dos ensaios elétricos, 080).
DROP TRIGGER IF EXISTS portal_validar_ensaio ON public.mecanica_analises;
CREATE TRIGGER portal_validar_ensaio BEFORE UPDATE ON public.mecanica_analises
FOR EACH ROW EXECUTE FUNCTION public.portal_validar_ensaio();

-- ── Anexos (prints de espectro / forma de onda do software da SKF) ─────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mecanica-vibracao', 'mecanica-vibracao', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 20971520,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "mecanica_vibracao_insert" ON storage.objects;
DROP POLICY IF EXISTS "mecanica_vibracao_select" ON storage.objects;
CREATE POLICY "mecanica_vibracao_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'mecanica-vibracao' AND auth.uid() IS NOT NULL);
CREATE POLICY "mecanica_vibracao_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'mecanica-vibracao');

COMMIT;
