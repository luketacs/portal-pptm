-- Migration: 031_manutencao_semanas_fechadas
-- Trava uma semana da Programação depois que o admin fecha ela (ver botão "Fechar
-- programação da semana") -- enquanto fechada, só Admin consegue criar/editar/excluir
-- lançamento nela (visualizar continua liberado pra todo mundo, e não é por área: o
-- fechamento manda as 3 planilhas -- Elétrica/Mecânica/Apoio -- juntas, então trava as
-- 3 de uma vez). Uma linha = uma semana fechada; apagar a linha reabre.
-- RLS permissiva a nível SQL, mesmo padrão do resto da Programação de Manutenção (ver
-- 029_manutencao_parada_planta.sql): só Admin vê/altera de fato -- decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_semanas_fechadas (
  semana_inicio     DATE          PRIMARY KEY,   -- segunda-feira da semana (mesmo formato de manutencao_programacao.semana_inicio)
  fechado_por_id    UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  fechado_por_nome  TEXT          NOT NULL,
  fechado_em        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE manutencao_semanas_fechadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_semanas_fechadas" ON manutencao_semanas_fechadas
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_semanas_fechadas" ON manutencao_semanas_fechadas
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_semanas_fechadas" ON manutencao_semanas_fechadas
  FOR DELETE USING (auth.uid() IS NOT NULL);
