-- Migration: 016_almox_metas_saida
-- Meta mensal de retirada de materiais (valor em R$ que o almoxarifado precisa
-- atingir de saída por mês), para comparar com o realizado na tela
-- "Saídas por Período". Editável só pelo Admin (aplicado na camada do app,
-- mesmo padrão das demais tabelas deste projeto).
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS almox_metas_saida (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  mes_referencia      TEXT          NOT NULL UNIQUE,  -- 'YYYY-MM'
  valor_meta          DECIMAL(12,2) NOT NULL DEFAULT 0,
  atualizado_por_id   UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  atualizado_por_nome TEXT,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE almox_metas_saida ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_almox_metas_saida"   ON almox_metas_saida FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_almox_metas_saida" ON almox_metas_saida FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_update_almox_metas_saida" ON almox_metas_saida FOR UPDATE USING (auth.uid() IS NOT NULL);
