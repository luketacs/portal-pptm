-- Adiar preventiva pra próxima semana (só Admin). Pedido do usuário: "às vezes temos que
-- adiar uma ordem". Grava a ocorrência do plano que foi adiada e a nova data — a agenda
-- (agendaDosPlanos) mostra essa ocorrência na semana da nova data. Ao programar, o ciclo
-- continua sendo gravado na data ORIGINAL da ocorrência, então a sequência do plano não
-- anda. Adiar de novo só atualiza nova_data (UNIQUE plano + ocorrência).

BEGIN;

CREATE TABLE IF NOT EXISTS public.manutencao_adiamentos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id        uuid        NOT NULL REFERENCES public.manutencao_planos(id) ON DELETE CASCADE,
  data_ocorrencia date        NOT NULL,
  nova_data       date        NOT NULL CHECK (nova_data > data_ocorrencia),
  criado_por_id   uuid,
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plano_id, data_ocorrencia)
);
ALTER TABLE public.manutencao_adiamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_read ON public.manutencao_adiamentos;
DROP POLICY IF EXISTS portal_admin ON public.manutencao_adiamentos;
CREATE POLICY portal_read ON public.manutencao_adiamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY portal_admin ON public.manutencao_adiamentos FOR ALL TO authenticated
  USING (public.portal_role() = 'Admin') WITH CHECK (public.portal_role() = 'Admin');
COMMENT ON TABLE public.manutencao_adiamentos IS
  'Ocorrência de plano preventivo adiada (só Admin) — a programação mostra na semana de nova_data; o ciclo continua na data original.';

COMMIT;
