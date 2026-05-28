-- Migration: 001_add_indexes
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- purchase_requests: índice GIN para busca no JSONB history
CREATE INDEX IF NOT EXISTS idx_purchase_requests_history
  ON purchase_requests USING GIN (history);

-- purchase_requests: filtros e ordenação mais comuns
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status
  ON purchase_requests (status);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_requester_id
  ON purchase_requests (requester_id);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_requestdate
  ON purchase_requests (requestdate DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_material_type
  ON purchase_requests (material_type);

-- materials: busca por código e filtro de status
CREATE INDEX IF NOT EXISTS idx_materials_status
  ON materials (status);

CREATE INDEX IF NOT EXISTS idx_materials_codigo
  ON materials (codigo);

-- notifications: leitura por usuário e status de lida
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read
  ON notifications (user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);
