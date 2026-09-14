-- Planos sem nenhum ciclo ainda tinham data_inicial = 2026-09-11 (dia em que a migration
-- 034 rodou, "começar do 0"), data que caiu dentro da semana 37 (07/09 a 13/09) — hoje já
-- fechada, junto com a semana 38 (14/09 a 20/09). Como a "próxima execução" de um plano sem
-- ciclo é a própria data_inicial (ver proximaExecucaoPlano em
-- src/utils/manutencao-planos.ts) e a sugestão só aparece dentro da janela exata da semana
-- selecionada (ver preventivaVencendo em src/utils/manutencao-preventivas.ts — não é
-- cumulativa), esses planos ficaram presos apontando pra uma janela que virou passado/
-- fechada: continuavam aparecendo como pendentes só quando alguém voltava a olhar a semana
-- 37 no filtro, mas nunca mais apareceriam em nenhuma semana atual ou futura, sem nunca
-- terem sido de fato programados.
--
-- Reprograma esses planos pra primeira semana aberta (39, 2026-09-21), voltando a aparecer
-- como sugestão normal dali pra frente.
UPDATE manutencao_planos
SET data_inicial = '2026-09-21'
WHERE ativo = true
  AND data_inicial <= '2026-09-13'
  AND NOT EXISTS (SELECT 1 FROM manutencao_ciclos c WHERE c.plano_id = manutencao_planos.id);
