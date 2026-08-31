-- Migration: 019_fundo_fixo_pagamento_dividido
-- Permite dividir o pagamento de uma compra entre duas formas de pagamento
-- (ex.: parte no cartão, parte em dinheiro do caixa/reembolso). forma_pagamento +
-- valor_final continuam sendo a parte principal; as colunas novas guardam a
-- segunda parte, quando existir -- ficam NULL pra toda compra não dividida.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

ALTER TABLE fundo_fixo_solicitacoes
  ADD COLUMN IF NOT EXISTS forma_pagamento_secundaria TEXT,
  ADD COLUMN IF NOT EXISTS valor_final_secundario DECIMAL(12,2);
