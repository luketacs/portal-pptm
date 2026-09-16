-- Contagem de "pessoas vendo agora" no link público do Acompanhamento de Indicadores
-- (pedido do usuário: divulgado num monitor do setor, quer saber quantas abas estão
-- abertas nesse momento). Cada aba gera um sessao_id aleatório ao carregar a página e
-- reaproveita o próprio poll que já existe (a cada ~3min, ver
-- api/indicadores-manutencao-publico.js) pra "dar sinal de vida" — sem requisição
-- extra nenhuma. Uma linha por aba/sessão, não por pessoa (a mesma pessoa com 2 abas
-- conta 2). Nunca acessada direto pelo navegador — só pelo endpoint público, com a
-- service_role key (que ignora RLS), então RLS fica ativado sem nenhuma policy (nega
-- tudo por padrão pra quem não for a service_role).
CREATE TABLE IF NOT EXISTS manutencao_indicadores_presenca (
  sessao_id  TEXT         PRIMARY KEY,
  visto_em   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE manutencao_indicadores_presenca ENABLE ROW LEVEL SECURITY;
