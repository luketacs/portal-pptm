-- Migration: 069_fundo_fixo_aprovacao_teams
-- Aprovação do Fundo Fixo pelo Teams (sem licença Premium). Quando a solicitação é
-- criada, o portal manda um card pro fluxo do Power Automate, que posta no chat do
-- gestor do setor (Operação → João Nunes; Manutenção e Infraestrutura → Italo Rosse).
-- Os botões Aprovar/Recusar do card abrem /publico/fundo-fixo/decisao?t=<token>, e a
-- decisão é gravada pela api/fundo-fixo-public-request com service_role. O Admin continua
-- podendo aprovar/recusar pelo portal; vale quem decidir primeiro.
--
-- teams_enviado_em: quando foi enviada pro Teams (NULL = não enviada: fluxo desligado,
--   setor sem gestor, ou falhou e pode ser reenviada).
-- teams_token_hash: sha256 do token do link (o token em si só existe no card).
-- teams_token_expira_em: depois disso o link não decide mais (fica com o Admin).
-- Passo a passo do fluxo: docs/FUNDO-FIXO-TEAMS.md
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS teams_enviado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teams_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS teams_token_expira_em TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS fundo_fixo_solicitacoes_teams_token_hash_key
  ON fundo_fixo_solicitacoes (teams_token_hash)
  WHERE teams_token_hash IS NOT NULL;
