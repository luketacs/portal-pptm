-- Migration: 081_eletrica_ensaios_transformadores
-- Ensaios Elétricos — transformadores. Digitaliza a "PLANILHA DE ENSAIOS ELÉTRICOS TRAFO"
-- (ex.: TC-05, 13,8 kV / 690 V, 12 pulsos): placa do trafo + um ensaio com resistência de
-- isolamento entre enrolamentos e terra, resistência ôhmica dos enrolamentos e relação de
-- transformação (TTR). Avaliação pela ANSI/NETA MTS (manutenção em campo) — regras em
-- src/utils/eletrica-trafo.ts.
--
-- Usa as tabelas da 080:
-- eletrica_equipamentos: tipo passa a aceitar 'transformador', com as colunas de placa do
--   trafo. secundarios em jsonb: [{ nome, tensaoV, ligacao }] — 1 secundário no trafo comum,
--   2 no de 12 pulsos (ex.: 1X em Δ e 2X em Y). tipo_bobina deixa de ser obrigatório (é só de
--   motor) e vira CHECK por tipo.
-- eletrica_ensaios: tipo 'transformador'. medicoes = isolamento [{ circuito, tensaoV, r30s,
--   r1min, r10min, foraEscala }] (MΩ); ohmica = [{ enrolamento, pares: [{ par, valor }] }] (mΩ);
--   ttr = [{ secundario, pares: [{ par, medida }] }]; criterio = cópia da placa no dia do
--   ensaio (tensões, ligações, tap usado, meio isolante, material) — mesmo motivo da 080.
-- Permissões: as mesmas da 080 (valem pra qualquer tipo).
--
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

-- ── Equipamentos ────────────────────────────────────────────────────────────
ALTER TABLE public.eletrica_equipamentos DROP CONSTRAINT IF EXISTS eletrica_equipamentos_tipo_check;
ALTER TABLE public.eletrica_equipamentos ADD CONSTRAINT eletrica_equipamentos_tipo_check
  CHECK (tipo IN ('motor', 'transformador'));

ALTER TABLE public.eletrica_equipamentos ALTER COLUMN tipo_bobina DROP NOT NULL;

ALTER TABLE public.eletrica_equipamentos
  ADD COLUMN IF NOT EXISTS potencia_kva            NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS ligacao_primaria        TEXT CHECK (ligacao_primaria IN ('D', 'Y')),
  ADD COLUMN IF NOT EXISTS secundarios             JSONB,
  ADD COLUMN IF NOT EXISTS meio_isolante           TEXT CHECK (meio_isolante IN ('seco', 'oleo')),
  ADD COLUMN IF NOT EXISTS material_enrolamento    TEXT CHECK (material_enrolamento IN ('cobre', 'aluminio')),
  ADD COLUMN IF NOT EXISTS relacao_taps            TEXT,
  ADD COLUMN IF NOT EXISTS refrigeracao            TEXT,
  ADD COLUMN IF NOT EXISTS grau_protecao           TEXT,
  ADD COLUMN IF NOT EXISTS classe_ambiental        TEXT,
  ADD COLUMN IF NOT EXISTS norma_fabricacao        TEXT,
  ADD COLUMN IF NOT EXISTS codigo_produto          TEXT,
  ADD COLUMN IF NOT EXISTS elevacao_temperatura_c  NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS massa_kg                NUMERIC(10,1);

ALTER TABLE public.eletrica_equipamentos DROP CONSTRAINT IF EXISTS eletrica_equipamentos_placa_motor;
ALTER TABLE public.eletrica_equipamentos ADD CONSTRAINT eletrica_equipamentos_placa_motor
  CHECK (tipo <> 'motor' OR tipo_bobina IS NOT NULL);
ALTER TABLE public.eletrica_equipamentos DROP CONSTRAINT IF EXISTS eletrica_equipamentos_placa_trafo;
ALTER TABLE public.eletrica_equipamentos ADD CONSTRAINT eletrica_equipamentos_placa_trafo
  CHECK (tipo <> 'transformador' OR (
    ligacao_primaria IS NOT NULL AND meio_isolante IS NOT NULL AND material_enrolamento IS NOT NULL
    AND secundarios IS NOT NULL AND jsonb_typeof(secundarios) = 'array' AND jsonb_array_length(secundarios) > 0));

-- ── Ensaios ─────────────────────────────────────────────────────────────────
ALTER TABLE public.eletrica_ensaios DROP CONSTRAINT IF EXISTS eletrica_ensaios_tipo_check;
ALTER TABLE public.eletrica_ensaios ADD CONSTRAINT eletrica_ensaios_tipo_check
  CHECK (tipo IN ('resistencia_isolamento', 'transformador'));

ALTER TABLE public.eletrica_ensaios ALTER COLUMN tipo_bobina DROP NOT NULL;

ALTER TABLE public.eletrica_ensaios
  ADD COLUMN IF NOT EXISTS ohmica    JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ohmica) = 'array'),
  ADD COLUMN IF NOT EXISTS ttr       JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ttr) = 'array'),
  ADD COLUMN IF NOT EXISTS criterio  JSONB;

ALTER TABLE public.eletrica_ensaios DROP CONSTRAINT IF EXISTS eletrica_ensaios_criterio_tipo;
ALTER TABLE public.eletrica_ensaios ADD CONSTRAINT eletrica_ensaios_criterio_tipo
  CHECK ((tipo = 'resistencia_isolamento' AND tipo_bobina IS NOT NULL)
      OR (tipo = 'transformador' AND criterio IS NOT NULL AND jsonb_typeof(criterio) = 'object'));

-- Os CHECKs testam IS NOT NULL antes do jsonb_typeof: CHECK que dá NULL passa no Postgres.

-- Ensaio de trafo só em trafo, de motor só em motor.
CREATE OR REPLACE FUNCTION public.portal_ensaio_tipo_equipamento() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_tipo text;
BEGIN
  SELECT tipo INTO v_tipo FROM public.eletrica_equipamentos WHERE id = NEW.equipamento_id;
  IF (NEW.tipo = 'transformador') IS DISTINCT FROM (v_tipo = 'transformador') THEN
    RAISE EXCEPTION 'Tipo de ensaio não corresponde ao equipamento.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS portal_ensaio_tipo_equipamento ON public.eletrica_ensaios;
CREATE TRIGGER portal_ensaio_tipo_equipamento BEFORE INSERT OR UPDATE OF tipo, equipamento_id ON public.eletrica_ensaios
FOR EACH ROW EXECUTE FUNCTION public.portal_ensaio_tipo_equipamento();

COMMIT;
