-- Migration: 076_manutencao_programacao_atualizado_por
-- Quem alterou por último cada lançamento da Programação — usado no aviso "Esta tela
-- está desatualizada" (ver 075) pra dizer QUEM mexeu ("João Silva alterou a programação
-- desta semana"). Preenchido pelo banco, não pelo app: vale pra toda gravação, inclusive
-- as feitas pelos triggers da 057 na mesma sessão. Sem usuário logado (SQL Editor,
-- migration) fica NULL — a tela mostra "Outro usuário".
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

BEGIN;

ALTER TABLE public.manutencao_programacao
  ADD COLUMN IF NOT EXISTS atualizado_por_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atualizado_por_nome TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_em       TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.portal_marcar_alteracao_programacao() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.atualizado_por_id := auth.uid();
  NEW.atualizado_por_nome := (SELECT p.name FROM public.profiles p WHERE p.id = auth.uid());
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS portal_marcar_alteracao_programacao ON public.manutencao_programacao;
CREATE TRIGGER portal_marcar_alteracao_programacao BEFORE INSERT OR UPDATE ON public.manutencao_programacao
FOR EACH ROW EXECUTE FUNCTION public.portal_marcar_alteracao_programacao();

COMMIT;
