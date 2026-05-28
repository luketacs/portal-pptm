-- ============================================
-- Script para adicionar campo STATUS na tabela MATERIALS
-- ============================================

-- Adicionar coluna status à tabela materials
ALTER TABLE materials 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'liberado'));

-- Atualizar materiais existentes que não têm status
UPDATE materials 
SET status = 'pendente' 
WHERE status IS NULL;

-- Comentar a coluna para documentação
COMMENT ON COLUMN materials.status IS 'Status do material: pendente (aguardando aprovação) ou liberado (aprovado para uso). Apenas administradores podem alterar.';

-- Verificar os dados
SELECT id, codigo, descricao_breve, status, created_at 
FROM materials 
ORDER BY created_at DESC 
LIMIT 10;
