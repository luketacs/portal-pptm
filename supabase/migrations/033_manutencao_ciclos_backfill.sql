-- Migration: 033_manutencao_ciclos_backfill
-- A migration 032 populou manutencao_planos.data_inicial com a ultima_execucao (quando
-- havia) da tabela antiga, mas não criou nenhum ciclo correspondente em
-- manutencao_ciclos. Resultado: proximaExecucaoPlano() (ver src/utils/manutencao-
-- planos.ts), sem nenhum ciclo registrado, tratava esse data_inicial como se já fosse a
-- PRÓXIMA execução (sem avançar a periodicidade) -- quando na verdade era a ÚLTIMA
-- execução conhecida. Na prática: "Última execução" ficava sempre "—" e "Próxima
-- execução" mostrava a data que já tinha passado, em vez da data seguinte.
-- Esse script cria um ciclo de abertura pra cada plano que já tinha ultima_execucao na
-- tabela antiga, usando essa data como data_prevista -- a partir daí,
-- proximaExecucaoPlano() volta a avançar corretamente (soma 1 periodicidade a partir
-- dela), e a tela passa a mostrar a última execução de verdade. Linka com a ordem mais
-- recente já associada ao plano, quando existir (só informativo, não afeta o cálculo).
-- Idempotente (ON CONFLICT DO NOTHING) -- seguro rodar de novo.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

INSERT INTO manutencao_ciclos (plano_id, data_prevista, ordem_id)
SELECT DISTINCT ON (p.id)
  p.id,
  pp.ultima_execucao,
  mp.id
FROM manutencao_planos p
JOIN manutencao_planos_preventivos pp ON pp.id = p.id
LEFT JOIN manutencao_programacao mp ON mp.plano_preventivo_id = p.id
WHERE pp.ultima_execucao IS NOT NULL
ORDER BY p.id, mp.created_at DESC NULLS LAST
ON CONFLICT (plano_id, data_prevista) DO NOTHING;
