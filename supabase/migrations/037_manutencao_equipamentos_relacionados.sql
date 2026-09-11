-- Migration: 037_manutencao_equipamentos_relacionados
-- Alguns testes envolvem mais de um equipamento ao mesmo tempo (ex.: teste do sistema
-- de carvão que precisa do stacker E das esteiras relacionadas rodando juntos) -- o
-- Quadro de LOTO só olhava o campo "equipamento" (singular) da ordem, então não dava
-- pra marcar mais de um equipamento com o mesmo status de uma vez.
-- "equipamentos_relacionados" guarda os equipamentos ADICIONAIS (além do campo
-- "equipamento" principal), texto livre separado por vírgula -- mesmo padrão já usado
-- pelo campo "recursos" (lista em chips no front, string única no banco, sem precisar
-- de TEXT[] nem tabela à parte). No plano, funciona como valor padrão que pré-preenche
-- a Nova OS ao programar (ver equipamentos_relacionados em manutencao_planos).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE manutencao_planos
  ADD COLUMN IF NOT EXISTS equipamentos_relacionados TEXT;

ALTER TABLE manutencao_programacao
  ADD COLUMN IF NOT EXISTS equipamentos_relacionados TEXT;
