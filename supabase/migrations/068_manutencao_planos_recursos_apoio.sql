-- Migration: 068_manutencao_planos_recursos_apoio
-- Plano que sempre precisa de apoio de equipamento (Andaime, Munck, Guindaste... — as
-- opções de "Gerenciar Recursos", tabela de recursos especiais) — pedido do usuário:
-- já prever na programação quando o plano sair. "recursos_apoio" guarda essas opções,
-- texto livre separado por vírgula (mesmo padrão de equipamentos_relacionados e do
-- campo "recursos" da OS). Pré-preenche "Recursos" da Nova OS ao programar o plano e
-- aparece como aviso na lista de preventivas da semana.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_planos
  ADD COLUMN IF NOT EXISTS recursos_apoio TEXT;
