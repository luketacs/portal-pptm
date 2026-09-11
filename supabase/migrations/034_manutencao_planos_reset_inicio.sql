-- Migration: 034_manutencao_planos_reset_inicio
-- Ajuste combinado com o usuário: os planos migrados do SIGMA não devem carregar
-- histórico de execução antigo -- começam do zero. O "start" de cada plano é a semana
-- em que ele for de fato programado pela primeira vez através do sistema novo (mesmo
-- mecanismo de fila semanal por especialidade -- ~20-25 preventivas/semana, priorizando
-- ciclo mais longo -- que já existe no painel "Preventivas da semana"/"Atrasadas").
--
-- Desfaz dois passos anteriores que não fazem mais sentido com essa decisão:
-- 1) a migration 033 tinha criado um ciclo de "abertura" por plano usando a
--    ultima_execucao antiga -- isso reintroduzia histórico velho. Remove esses ciclos
--    (limpa a tabela inteira -- nesse momento ainda não há programação real feita pelo
--    sistema novo pra perder).
-- 2) a migration 032 tinha jogado ultima_execucao (quando existia) direto em
--    data_inicial -- reseta pra hoje em todos os planos vindos do SIGMA (identificados
--    por ainda terem uma linha correspondente em manutencao_planos_preventivos), sem
--    mexer em planos cadastrados manualmente depois (que já têm o data_inicial que a
--    pessoa escolheu de propósito).
--
-- Resultado: todo plano migrado passa a contar sua periodicidade a partir de hoje, cai
-- na fila normal de sugestão (sem "vencido" fantasma por causa de data antiga), e ganha
-- seu histórico de verdade só quando alguém clicar em "Programar" pela primeira vez.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

TRUNCATE manutencao_ciclos;

UPDATE manutencao_planos
SET data_inicial = CURRENT_DATE
WHERE id IN (SELECT id FROM manutencao_planos_preventivos);
