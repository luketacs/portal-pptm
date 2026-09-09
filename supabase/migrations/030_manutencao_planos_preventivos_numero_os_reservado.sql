-- Migration: 030_manutencao_planos_preventivos_numero_os_reservado
-- Permite anotar o número da OS num plano preventivo ANTES dele ser efetivamente
-- programado — hoje o número só pode ser digitado no momento de criar a OS de verdade
-- (ver formNumeroOs em manutencao-programacao.component.ts), mas o time já costuma
-- abrir/reservar a OS no SIGMA com antecedência e quer guardar esse número junto do
-- plano, pra não esquecer/perder quando for programar de fato.
-- Ao programar a partir do plano (programarDaPreventiva), o número reservado pré-
-- preenche o formulário; ao confirmar a criação da OS, o campo é limpo (avancarPreventiva)
-- já que o número "virou" a OS real.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_planos_preventivos
  ADD COLUMN IF NOT EXISTS numero_os_reservado TEXT;
