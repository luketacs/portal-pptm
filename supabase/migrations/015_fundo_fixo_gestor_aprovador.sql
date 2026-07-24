-- Migration: 015_fundo_fixo_gestor_aprovador
-- Registra qual gestor (fora do portal) é o responsável por aquela solicitação,
-- só para aparecer em listas/relatórios — a aprovação de fato no sistema continua
-- sendo feita só pelo Admin do portal por enquanto. É texto livre (não referencia
-- profiles) porque nem todo gestor tem usuário no portal (ex.: João Nunes).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS gestor_aprovador TEXT;
