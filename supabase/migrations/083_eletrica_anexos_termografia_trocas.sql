-- Migration: 083_eletrica_anexos_termografia_trocas
-- Ensaios Elétricos — três pedidos do Lucas de uma vez:
--
-- 1) Anexos no ensaio: eletrica_ensaios.anexos = [{ url, nome, tipo: 'imagem'|'pdf', legenda }]
--    (foto da tela do instrumento, relatório exportado do Fluke, foto da placa, imagem
--    térmica). Arquivos no bucket público eletrica-ensaios (mesmo esquema do reparo, 079).
--
-- 2) Termografia como ensaio: tipo 'termografia', vale pra motor e trafo. medicoes =
--    pontos [{ ponto, grupo, criterio, temperaturaC, limiteC }]; criterio = { cargaPct,
--    emissividade, distanciaM }. Avaliação (ANSI/NETA MTS tabela 100.18) no app —
--    src/utils/eletrica-termografia.ts. Termografia não tem tensão de ensaio nem placa
--    elétrica: tensao_aplicada_v / tensao_nominal_v / classe_isolamento deixam de ser NOT
--    NULL e viram obrigatórios por tipo no CHECK.
--
-- 3) Histórico de situação / trocas: eletrica_equipamentos_movimentos, preenchido SÓ por
--    trigger (cadastro e toda mudança de situação, aplicação ou local — pela tela de
--    edição ou pela troca). eletrica_trocar_equipamentos() faz a troca de uma vez: a
--    reserva assume a aplicação e o local do instalado, e o instalado vira reserva no
--    local informado; as duas linhas do histórico ficam ligadas pelo troca_id.
--
-- Os CHECKs testam IS NOT NULL antes do resto: CHECK que dá NULL passa no Postgres.
-- Rodar depois da 080, 081 e 082.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

-- ── 1) Anexos ───────────────────────────────────────────────────────────────
ALTER TABLE public.eletrica_ensaios
  ADD COLUMN IF NOT EXISTS anexos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.eletrica_ensaios DROP CONSTRAINT IF EXISTS eletrica_ensaios_anexos_check;
ALTER TABLE public.eletrica_ensaios ADD CONSTRAINT eletrica_ensaios_anexos_check
  CHECK (jsonb_typeof(anexos) = 'array');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('eletrica-ensaios', 'eletrica-ensaios', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 20971520,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "eletrica_ensaios_insert" ON storage.objects;
DROP POLICY IF EXISTS "eletrica_ensaios_select" ON storage.objects;
CREATE POLICY "eletrica_ensaios_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'eletrica-ensaios' AND auth.uid() IS NOT NULL);
CREATE POLICY "eletrica_ensaios_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'eletrica-ensaios');

-- ── 2) Termografia ──────────────────────────────────────────────────────────
ALTER TABLE public.eletrica_ensaios DROP CONSTRAINT IF EXISTS eletrica_ensaios_tipo_check;
ALTER TABLE public.eletrica_ensaios ADD CONSTRAINT eletrica_ensaios_tipo_check
  CHECK (tipo IN ('resistencia_isolamento', 'transformador', 'termografia'));

ALTER TABLE public.eletrica_ensaios
  ALTER COLUMN tensao_aplicada_v DROP NOT NULL,
  ALTER COLUMN tensao_nominal_v DROP NOT NULL,
  ALTER COLUMN classe_isolamento DROP NOT NULL;

ALTER TABLE public.eletrica_ensaios DROP CONSTRAINT IF EXISTS eletrica_ensaios_criterio_tipo;
ALTER TABLE public.eletrica_ensaios ADD CONSTRAINT eletrica_ensaios_criterio_tipo
  CHECK (
    (tipo = 'resistencia_isolamento' AND tipo_bobina IS NOT NULL AND tensao_aplicada_v IS NOT NULL
      AND tensao_nominal_v IS NOT NULL AND classe_isolamento IS NOT NULL)
    OR (tipo = 'transformador' AND criterio IS NOT NULL AND jsonb_typeof(criterio) = 'object'
      AND tensao_aplicada_v IS NOT NULL AND tensao_nominal_v IS NOT NULL AND classe_isolamento IS NOT NULL)
    OR (tipo = 'termografia' AND criterio IS NOT NULL AND jsonb_typeof(criterio) = 'object')
  );

-- Isolamento só em motor, ensaio de trafo só em trafo; termografia em qualquer um.
CREATE OR REPLACE FUNCTION public.portal_ensaio_tipo_equipamento() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_tipo text;
BEGIN
  SELECT tipo INTO v_tipo FROM public.eletrica_equipamentos WHERE id = NEW.equipamento_id;
  IF (NEW.tipo = 'resistencia_isolamento' AND v_tipo IS DISTINCT FROM 'motor')
     OR (NEW.tipo = 'transformador' AND v_tipo IS DISTINCT FROM 'transformador') THEN
    RAISE EXCEPTION 'Tipo de ensaio não corresponde ao equipamento.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- ── 3) Histórico de situação / trocas ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eletrica_equipamentos_movimentos (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  equipamento_id      UUID         NOT NULL REFERENCES public.eletrica_equipamentos(id) ON DELETE CASCADE,
  data_movimento      DATE         NOT NULL DEFAULT current_date,
  situacao_anterior   TEXT,
  situacao_nova       TEXT         NOT NULL,
  aplicacao_anterior  TEXT,
  aplicacao_nova      TEXT,
  local_anterior      TEXT,
  local_novo          TEXT,
  troca_id            UUID,          -- as duas linhas de uma troca têm o mesmo
  substituto_tag      TEXT,          -- na troca: a TAG do outro equipamento
  motivo              TEXT,
  usuario_id          UUID,
  usuario_nome        TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eletrica_mov_equip ON public.eletrica_equipamentos_movimentos (equipamento_id, created_at);

ALTER TABLE public.eletrica_equipamentos_movimentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_read ON public.eletrica_equipamentos_movimentos;
CREATE POLICY portal_read ON public.eletrica_equipamentos_movimentos FOR SELECT TO authenticated USING (true);
-- Sem política de INSERT/UPDATE/DELETE: só o trigger (SECURITY DEFINER) grava.

-- A troca passa data, motivo e o outro equipamento por set_config (local à transação).
CREATE OR REPLACE FUNCTION public.portal_movimento_equipamento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.situacao IS NOT DISTINCT FROM OLD.situacao
     AND NEW.aplicacao IS NOT DISTINCT FROM OLD.aplicacao
     AND NEW.local_instalacao IS NOT DISTINCT FROM OLD.local_instalacao THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.eletrica_equipamentos_movimentos (
    equipamento_id, data_movimento, situacao_anterior, situacao_nova, aplicacao_anterior, aplicacao_nova,
    local_anterior, local_novo, troca_id, substituto_tag, motivo, usuario_id, usuario_nome)
  VALUES (
    NEW.id,
    coalesce(nullif(current_setting('portal.mov_data', true), '')::date, current_date),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.situacao END, NEW.situacao,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.aplicacao END, NEW.aplicacao,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.local_instalacao END, NEW.local_instalacao,
    nullif(current_setting('portal.mov_troca', true), '')::uuid,
    nullif(current_setting('portal.mov_substituto', true), ''),
    CASE WHEN TG_OP = 'INSERT' THEN 'Cadastro' ELSE nullif(current_setting('portal.mov_motivo', true), '') END,
    auth.uid(),
    (SELECT name FROM public.profiles WHERE id = auth.uid())
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS portal_movimento_equipamento ON public.eletrica_equipamentos;
CREATE TRIGGER portal_movimento_equipamento AFTER INSERT OR UPDATE ON public.eletrica_equipamentos
FOR EACH ROW EXECUTE FUNCTION public.portal_movimento_equipamento();

-- Quem já estava cadastrado ganha a linha inicial do histórico.
INSERT INTO public.eletrica_equipamentos_movimentos (equipamento_id, data_movimento, situacao_nova, aplicacao_nova, local_novo, motivo, usuario_nome, created_at)
SELECT e.id, e.created_at::date, e.situacao, e.aplicacao, e.local_instalacao, 'Cadastro', e.criado_por_nome, e.created_at
FROM public.eletrica_equipamentos e
WHERE NOT EXISTS (SELECT 1 FROM public.eletrica_equipamentos_movimentos m WHERE m.equipamento_id = e.id);

-- Troca: p_sai (instalado) dá lugar a p_entra (reserva do mesmo tipo).
-- SECURITY INVOKER: vale a RLS de UPDATE da 080 (qualquer usuário logado).
CREATE OR REPLACE FUNCTION public.eletrica_trocar_equipamentos(
  p_sai uuid, p_entra uuid, p_local_sai text, p_data date, p_motivo text
) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_sai   public.eletrica_equipamentos;
  v_entra public.eletrica_equipamentos;
  v_troca uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_sai FROM public.eletrica_equipamentos WHERE id = p_sai FOR UPDATE;
  SELECT * INTO v_entra FROM public.eletrica_equipamentos WHERE id = p_entra FOR UPDATE;
  IF v_sai.id IS NULL OR v_entra.id IS NULL THEN
    RAISE EXCEPTION 'Equipamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_sai.tipo <> v_entra.tipo THEN
    RAISE EXCEPTION 'A troca precisa ser entre equipamentos do mesmo tipo.' USING ERRCODE = '23514';
  END IF;
  IF v_sai.situacao <> 'instalado' OR v_entra.situacao <> 'reserva' THEN
    RAISE EXCEPTION 'A troca é de um equipamento instalado por uma reserva.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('portal.mov_troca', v_troca::text, true);
  PERFORM set_config('portal.mov_data', coalesce(p_data, current_date)::text, true);
  PERFORM set_config('portal.mov_motivo', coalesce(nullif(btrim(p_motivo), ''), 'Troca'), true);

  PERFORM set_config('portal.mov_substituto', v_sai.tag, true);
  UPDATE public.eletrica_equipamentos
     SET situacao = 'instalado', aplicacao = v_sai.aplicacao, local_instalacao = v_sai.local_instalacao, updated_at = now()
   WHERE id = p_entra;

  -- O que sai continua sendo da mesma aplicação, agora como reserva.
  PERFORM set_config('portal.mov_substituto', v_entra.tag, true);
  UPDATE public.eletrica_equipamentos
     SET situacao = 'reserva', local_instalacao = nullif(btrim(p_local_sai), ''), updated_at = now()
   WHERE id = p_sai;

  PERFORM set_config('portal.mov_troca', '', true);
  PERFORM set_config('portal.mov_data', '', true);
  PERFORM set_config('portal.mov_motivo', '', true);
  PERFORM set_config('portal.mov_substituto', '', true);
  RETURN v_troca;
END $$;
REVOKE ALL ON FUNCTION public.eletrica_trocar_equipamentos(uuid, uuid, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eletrica_trocar_equipamentos(uuid, uuid, text, date, text) TO authenticated;

COMMIT;
