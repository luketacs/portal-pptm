-- Migration: 035_manutencao_ciclos_backfill_real
-- A migration 034 resetou TODO plano vindo do SIGMA pra "começar do zero" (data_inicial
-- = hoje, sem ciclo nenhum) -- mas isso também apagou o rastro de planos que JÁ tinham
-- sido programados de verdade nas últimas semanas (ex.: semana 36, 37), antes ou depois
-- desse cadastro novo existir. Pra esses, o "start" combinado com o usuário é
-- justamente aquela semana em que já foram programados -- não faz sentido resetar de
-- novo pra hoje.
--
-- Diferença desse backfill pro da migration 033 (que essa substitui de vez, já que a
-- 034 limpou o que ela tinha criado): usa a ordem (manutencao_programacao) já vinculada
-- de verdade via plano_preventivo_id -- semana_inicio dela vira a data_prevista do
-- ciclo -- em vez da ultima_execucao da tabela antiga do SIGMA (um campo só, mutado a
-- cada programação, sem garantia de bater com uma ordem específica). Cria um ciclo por
-- combinação (plano, semana) distinta -- um plano programado em mais de uma semana
-- (ex.: 36 e 37) ganha um ciclo pra cada uma.
--
-- Planos sem nenhuma ordem vinculada continuam como a 034 deixou (data_inicial = hoje,
-- sem ciclo) -- só ganham histórico quando forem programados de fato.
-- Idempotente (ON CONFLICT DO NOTHING) -- seguro rodar de novo.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

INSERT INTO manutencao_ciclos (plano_id, data_prevista, ordem_id)
SELECT DISTINCT ON (plano_preventivo_id, semana_inicio)
  plano_preventivo_id,
  semana_inicio,
  id
FROM manutencao_programacao
WHERE plano_preventivo_id IS NOT NULL
ORDER BY plano_preventivo_id, semana_inicio, created_at
ON CONFLICT (plano_id, data_prevista) DO NOTHING;
