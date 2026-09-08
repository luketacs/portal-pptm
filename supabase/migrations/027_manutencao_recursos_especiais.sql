-- Migration: 027_manutencao_recursos_especiais
-- Cadastro dos "recursos especiais" que aparecem como sugestão no campo Recursos da
-- Programação (Elétrica/Mecânica) e que espelham automaticamente uma OS de Apoio
-- (ANDAIME, MUNCK/GUINDASTE por empresa, colaboradores da Fontebras...). Até aqui
-- viviam fixos no código (RECURSO_PARA_EMPRESA_APOIO), exigindo deploy pra cadastrar
-- qualquer recurso novo — já aconteceu duas vezes nesta mesma semana (Munck/Guindaste
-- e depois Fontebras). Agora ficam no banco, editáveis pelo Admin direto na tela.
-- RLS permissiva a nível SQL, mesmo padrão do resto da Programação de Manutenção:
-- quem pode editar de fato (só Admin) é decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_recursos_especiais (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  opcao             TEXT          NOT NULL UNIQUE, -- rótulo sugerido no campo Recursos (ex.: "MUNCK - DB GUINDASTES")
  empresa_apoio     TEXT          NOT NULL,        -- pra quem a OS de Apoio é espelhada (ex.: "DB GUINDASTES")
  criado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome   TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE manutencao_recursos_especiais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_manutencao_recursos_especiais" ON manutencao_recursos_especiais
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_manutencao_recursos_especiais" ON manutencao_recursos_especiais
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_manutencao_recursos_especiais" ON manutencao_recursos_especiais
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- Seed com os recursos já usados até aqui — evita perder o cadastro atual na primeira
-- execução após a migration. Só popula se a tabela ainda estiver vazia.
INSERT INTO manutencao_recursos_especiais (opcao, empresa_apoio, criado_por_nome)
SELECT opcao, empresa_apoio, 'Migration 027'
FROM (VALUES
  ('MUNCK - DB GUINDASTES', 'DB GUINDASTES'),
  ('MUNCK - CORDEIRO', 'CORDEIRO'),
  ('GUINDASTE - DB GUINDASTES', 'DB GUINDASTES'),
  ('GUINDASTE - CORDEIRO', 'CORDEIRO'),
  ('ANDAIME', 'TOP ANDAIMES'),
  ('ROMÁRIO (FONTEBRAS)', 'ROMÁRIO (FONTEBRAS)'),
  ('JÚLIO (FONTEBRAS)', 'JÚLIO (FONTEBRAS)'),
  ('FELIPE (FONTEBRAS)', 'FELIPE (FONTEBRAS)'),
  ('SÉRGIO (FONTEBRAS)', 'SÉRGIO (FONTEBRAS)')
) AS seed(opcao, empresa_apoio)
WHERE NOT EXISTS (SELECT 1 FROM manutencao_recursos_especiais);
