-- Migration: 023_manutencao_apoio_cadastros
-- Cadastro de equipes/empresas e da escala de turno do Apoio/Operação — até aqui
-- viviam em public/equipes-apoio.json e public/escala-apoio.json (arquivos fixos no
-- código, exigindo deploy pra qualquer troca). Agora ficam no banco, editáveis pelo
-- Admin direto na tela de Programação do Apoio. RLS permissiva a nível SQL, mesmo
-- padrão do resto da Programação de Manutenção: quem pode editar de fato (só Admin)
-- é decidido no app.
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS manutencao_apoio_equipes (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  nome              TEXT          NOT NULL UNIQUE,   -- ex.: "OPERAÇÃO", "TOP ANDAIMES"
  criado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome   TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manutencao_apoio_escala (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  nome              TEXT          NOT NULL,
  equipe            TEXT          NOT NULL CHECK (equipe IN ('A', 'B', 'C', 'D')),
  criado_por_id     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_por_nome   TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manutencao_apoio_escala_equipe ON manutencao_apoio_escala (equipe);

ALTER TABLE manutencao_apoio_equipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE manutencao_apoio_escala  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_manutencao_apoio_equipes" ON manutencao_apoio_equipes
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_manutencao_apoio_equipes" ON manutencao_apoio_equipes
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_manutencao_apoio_equipes" ON manutencao_apoio_equipes
  FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_read_manutencao_apoio_escala" ON manutencao_apoio_escala
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert_manutencao_apoio_escala" ON manutencao_apoio_escala
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_manutencao_apoio_escala" ON manutencao_apoio_escala
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ── Dados iniciais (conferidos contra "PROGRAMAÇÃO APOIO JUL.xlsx") ────────────
-- Só popula se as tabelas ainda estiverem vazias — evita duplicar em caso de reexecução.

INSERT INTO manutencao_apoio_equipes (nome, criado_por_nome)
SELECT nome, 'Migration 023'
FROM (VALUES
  ('OPERAÇÃO'), ('BMS'), ('CORDEIRO'), ('DB'),
  ('FONTEBRÁS'), ('MUNCK USINA'), ('SERVPLEX'), ('TOP ANDAIMES')
) AS seed(nome)
WHERE NOT EXISTS (SELECT 1 FROM manutencao_apoio_equipes);

INSERT INTO manutencao_apoio_escala (nome, equipe, criado_por_nome)
SELECT nome, equipe, 'Migration 023'
FROM (VALUES
  ('Jerffesson Roger Silva de Oliveira', 'A'),
  ('Hilton do Nascimento', 'A'),
  ('Mauro Teixeira Dantas Junior', 'A'),
  ('Daniel Moura Oliveira (Brigadista MAN)', 'A'),
  ('Francisco Xavier Bruno Filho', 'A'),
  ('Raimundo Ronney da Rocha Vieira', 'B'),
  ('Carlos Augusto Tome Brasil', 'B'),
  ('Francisco William de Souza Marinho', 'B'),
  ('Francisco Alvemar Martins Rodrigues (Brigadista MAN)', 'B'),
  ('Antonio Nivaldo de Brito (Brigadista MAN)', 'B'),
  ('Anderson Felipe Lima do Monte', 'C'),
  ('Pascoal Cardoso', 'C'),
  ('Joaquim Ricarte de Albuquerque Neto', 'C'),
  ('Jose Vlaldenir Andrade Lemos (Brigadista MAN)', 'C'),
  ('Micael Ries Schmidt', 'C'),
  ('Francisco Eduardo Nobre', 'D'),
  ('Antonio Narcelio Sales de Souza', 'D'),
  ('Francisco Alexandre Gomes', 'D'),
  ('Antonio Jose Lima dos Santos (Brigadista MAN)', 'D'),
  ('Carlos Junior', 'D')
) AS seed(nome, equipe)
WHERE NOT EXISTS (SELECT 1 FROM manutencao_apoio_escala);
