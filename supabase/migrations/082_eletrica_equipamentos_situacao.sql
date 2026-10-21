-- Migration: 082_eletrica_equipamentos_situacao
-- Ensaios Elétricos — situação e aplicação do equipamento (pedido do Lucas): saber se o
-- motor/trafo está instalado ou é reserva, e onde ele é aplicado.
--
-- situacao: 'instalado' | 'reserva'. Os já cadastrados ficam como instalados.
-- aplicacao: texto livre. Instalado = equipamento que ele aciona / onde trabalha
--   (ex.: "Bomba de água de alimentação B"). Reserva = de quais equipamentos é reserva.
-- local_instalacao (080) continua sendo o local; pra reserva a tela chama de "local de
--   armazenamento".
--
-- Rodar depois da 080 e da 081.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

ALTER TABLE public.eletrica_equipamentos
  ADD COLUMN IF NOT EXISTS situacao   TEXT NOT NULL DEFAULT 'instalado',
  ADD COLUMN IF NOT EXISTS aplicacao  TEXT;

ALTER TABLE public.eletrica_equipamentos DROP CONSTRAINT IF EXISTS eletrica_equipamentos_situacao_check;
ALTER TABLE public.eletrica_equipamentos ADD CONSTRAINT eletrica_equipamentos_situacao_check
  CHECK (situacao IN ('instalado', 'reserva'));

CREATE INDEX IF NOT EXISTS idx_eletrica_equipamentos_situacao ON public.eletrica_equipamentos (tipo, situacao);

COMMIT;
