-- Migration: Adicionar coluna 'complementar' na tabela 'materials'
-- Execute este SQL no Supabase SQL Editor

ALTER TABLE materials ADD COLUMN IF NOT EXISTS complementar TEXT;

-- Comentário na coluna para documentação
COMMENT ON COLUMN materials.complementar IS 'Campo complementar exclusivo do Portal (máx 500 caracteres)';
