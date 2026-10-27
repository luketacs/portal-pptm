-- Migration: 087_eletrica_motor_acionamento
-- Ensaios Elétricos — tipo de acionamento do motor (pedido do Lucas): partida direta,
-- inversor de frequência etc. Só motor usa; trafo fica null.
--
-- Opcional: os motores já cadastrados ficam sem acionamento até alguém editar.
--
-- Rodar depois da 082.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

ALTER TABLE public.eletrica_equipamentos
  ADD COLUMN IF NOT EXISTS tipo_acionamento TEXT;

ALTER TABLE public.eletrica_equipamentos DROP CONSTRAINT IF EXISTS eletrica_equipamentos_tipo_acionamento_check;
ALTER TABLE public.eletrica_equipamentos ADD CONSTRAINT eletrica_equipamentos_tipo_acionamento_check
  CHECK (tipo_acionamento IS NULL OR tipo_acionamento IN
    ('partida_direta', 'inversor', 'soft_starter', 'estrela_triangulo', 'compensadora'));

COMMIT;
