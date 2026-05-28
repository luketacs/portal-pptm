-- Migration: 004_materials_files
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- Adicionar colunas de arquivo na tabela materials
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS photo_url    TEXT,
  ADD COLUMN IF NOT EXISTS datasheet_url TEXT;

-- ============================================================
-- STORAGE: execute os passos abaixo no Supabase Dashboard
-- Storage > New Bucket
-- ============================================================
--
-- Bucket 1: material-photos
--   Name: material-photos
--   Public: true
--   Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
--   Max file size: 5 MB
--
-- Bucket 2: material-datasheets
--   Name: material-datasheets
--   Public: true
--   Allowed MIME types: application/pdf
--   Max file size: 20 MB
--
-- Depois crie as policies de acesso para cada bucket:
--
-- Policy: Allow authenticated users to upload (INSERT)
--   Target: Authenticated users
--   Allowed operation: INSERT
--   Policy expression: auth.uid() IS NOT NULL
--
-- Policy: Allow public read (SELECT)
--   Target: Public
--   Allowed operation: SELECT
--   Policy expression: true
--
-- Policy: Allow authenticated to delete their own uploads (DELETE)
--   Target: Authenticated users
--   Allowed operation: DELETE
--   Policy expression: auth.uid() IS NOT NULL
-- ============================================================
