-- Corrige o que a migration 058 deixou pela metade: ela moveu a data dos ciclos em
-- manutencao_ciclos (ciclo 2027 -> semana real da OS), mas NÃO mexeu na coluna
-- manutencao_programacao.ciclo_data_prevista — que desde a 057 é a fonte do ciclo (o
-- trigger portal_sincronizar_ciclo recria o ciclo a partir dela). A OS continuou dizendo
-- "cubro o ciclo de 2027"; na primeira atualização da OS (edição, status do SIGMA,
-- reprogramação...) o trigger gravou de novo o ciclo em 2027, e o plano voltou a ficar
-- escondido da programação até lá (painel Saúde dos planos: "Ciclo gravado à frente da OS").
--
-- Aqui o ajuste é feito na OS: ciclo_data_prevista passa a ser o 1º dia previsto da OS
-- (ou a segunda da semana), para toda OS de plano cujo ciclo esteja mais de 3 semanas à
-- frente da própria semana — mesma regra que o app passa a aplicar ao criar/editar OS
-- (cicloCoerenteComOrdem). Os triggers da 057 apagam o ciclo antigo e gravam o novo,
-- então a OS e manutencao_ciclos ficam consistentes.
--
-- Backup de antes: backup_manutencao_ciclos_20260925 (migration 062).

-- 1) Conferência antes (quantas OS e quais planos vão mudar):
SELECT p.codigo, p.nome, o.semana_inicio, o.ciclo_data_prevista AS ciclo_atual,
       COALESCE((SELECT min(d)::date FROM unnest(o.dias_previstos) d), o.semana_inicio) AS ciclo_novo,
       o.tecnico_nome
  FROM manutencao_programacao o
  JOIN manutencao_planos p ON p.id = o.plano_preventivo_id
 WHERE o.ciclo_data_prevista > o.semana_inicio + 21
 ORDER BY p.codigo, o.semana_inicio;

BEGIN;

UPDATE manutencao_programacao o
   SET ciclo_data_prevista = COALESCE((SELECT min(d)::date FROM unnest(o.dias_previstos) d), o.semana_inicio)
 WHERE o.plano_preventivo_id IS NOT NULL
   AND o.ciclo_data_prevista > o.semana_inicio + 21;

COMMIT;

-- 2) Conferência depois — as duas contagens devem ser 0:
SELECT
  (SELECT count(*) FROM manutencao_programacao
    WHERE ciclo_data_prevista > semana_inicio + 21)                         AS os_desalinhadas,
  (SELECT count(*) FROM manutencao_ciclos c JOIN manutencao_programacao o ON o.id = c.ordem_id
    WHERE c.data_prevista > o.semana_inicio + 21)                           AS ciclos_desalinhados;
