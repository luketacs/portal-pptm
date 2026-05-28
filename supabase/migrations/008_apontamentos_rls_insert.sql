-- Migration: 008_apontamentos_rls_insert
-- Permite que Admin insira/delete apontamentos diretamente (import client-side)
-- Execute no Supabase SQL Editor

CREATE POLICY "admin_insert_apontamentos" ON apontamentos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );

CREATE POLICY "admin_delete_apontamentos" ON apontamentos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );

CREATE POLICY "admin_insert_ap_imp" ON apontamentos_importacoes
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );
