-- Backup dos planos e ciclos ANTES da revisão geral de planos (set/2026 em diante —
-- período longo, muitas alterações). Cópia completa, com data no nome, pra restaurar
-- um plano (ou todos) do jeito que estava se alguma alteração der errado.
--
-- As tabelas de backup NÃO são acessíveis pelo app: RLS ligado e nenhuma política — só
-- quem entra no SQL Editor do Supabase consegue ler (a API pública do Supabase expõe
-- toda tabela do schema public; sem RLS qualquer usuário logado leria o backup).
--
-- Restaurar UM plano (exemplo — troque o código):
--   UPDATE manutencao_planos p SET
--     nome = b.nome, equipamento = b.equipamento, tag_kks = b.tag_kks, area = b.area,
--     especialidade = b.especialidade, descricao = b.descricao, atividades = b.atividades,
--     periodicidade_valor = b.periodicidade_valor, periodicidade_unidade = b.periodicidade_unidade,
--     data_inicial = b.data_inicial, responsavel = b.responsavel, ativo = b.ativo
--   FROM backup_manutencao_planos_20260925 b
--   WHERE b.id = p.id AND p.codigo = 'PM-XXXX';
--   (rodar com a trigger portal_validar_reserva_plano desligada, igual à migration 058)

BEGIN;

CREATE TABLE IF NOT EXISTS backup_manutencao_planos_20260925 AS
  SELECT *, now() AS backup_em FROM manutencao_planos;

CREATE TABLE IF NOT EXISTS backup_manutencao_ciclos_20260925 AS
  SELECT *, now() AS backup_em FROM manutencao_ciclos;

ALTER TABLE backup_manutencao_planos_20260925 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_manutencao_ciclos_20260925 ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE backup_manutencao_planos_20260925 IS
  'Backup de manutencao_planos antes da revisão geral de planos (2026-09-25). Somente leitura, sem acesso pela API.';
COMMENT ON TABLE backup_manutencao_ciclos_20260925 IS
  'Backup de manutencao_ciclos antes da revisão geral de planos (2026-09-25). Somente leitura, sem acesso pela API.';

COMMIT;

-- Conferência: as contagens devem bater com as tabelas originais.
SELECT
  (SELECT count(*) FROM manutencao_planos)                 AS planos,
  (SELECT count(*) FROM backup_manutencao_planos_20260925) AS planos_backup,
  (SELECT count(*) FROM manutencao_ciclos)                 AS ciclos,
  (SELECT count(*) FROM backup_manutencao_ciclos_20260925) AS ciclos_backup;
