-- Permissões de purchase_requests (SCs). A tabela foi criada pelo painel e acumulou 9
-- policies permissivas — como elas somam com OU, "Allow update requests" (true/true)
-- deixava qualquer logado editar qualquer SC, e a condicional ainda usava o status
-- 'Pendente de Aprovação', que o app não grava ('Pendente'). Consolida em 4, só para
-- authenticated. get_user_role() (sem argumento, STABLE) dentro de (select ...) roda uma
-- vez por consulta em vez de uma vez por linha. Idempotente: em 2026-10-23 as 4 policies
-- já tinham sido criadas à mão no SQL Editor; rodar isto deixa o banco igual ao repo.

BEGIN;

DROP POLICY IF EXISTS "Admin can delete requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Allow authenticated users to read requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Allow conditional update of requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Allow insert for requester or admin" ON public.purchase_requests;
DROP POLICY IF EXISTS "Allow read requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Allow update requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Allow user to create requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Authenticated users can insert requests" ON public.purchase_requests;
DROP POLICY IF EXISTS "Users can create own requests" ON public.purchase_requests;
DROP POLICY IF EXISTS pr_select ON public.purchase_requests;
DROP POLICY IF EXISTS pr_insert ON public.purchase_requests;
DROP POLICY IF EXISTS pr_update ON public.purchase_requests;
DROP POLICY IF EXISTS pr_delete ON public.purchase_requests;

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

-- Leitura continua aberta a quem está logado; "Minhas Solicitações" é filtro do app.
CREATE POLICY pr_select ON public.purchase_requests FOR SELECT TO authenticated
  USING (true);

CREATE POLICY pr_insert ON public.purchase_requests FOR INSERT TO authenticated
  WITH CHECK (requester_id = (select auth.uid()) OR (select public.get_user_role()) = 'Admin');

-- Admin edita tudo; Solicitante só a própria SC enquanto Pendente (canEditRequestInList).
CREATE POLICY pr_update ON public.purchase_requests FOR UPDATE TO authenticated
  USING      ((select public.get_user_role()) = 'Admin'
              OR (requester_id = (select auth.uid()) AND status = 'Pendente'))
  WITH CHECK ((select public.get_user_role()) = 'Admin'
              OR (requester_id = (select auth.uid()) AND status = 'Pendente'));

CREATE POLICY pr_delete ON public.purchase_requests FOR DELETE TO authenticated
  USING ((select public.get_user_role()) = 'Admin');

-- A versão com argumento estava VOLATILE: o Postgres não reaproveita o resultado.
ALTER FUNCTION public.get_user_role(uuid) STABLE;

-- Mesma ordem da carga do app (request.service: requestdate.desc,id.desc).
CREATE INDEX IF NOT EXISTS idx_purchase_requests_requestdate_id
  ON public.purchase_requests (requestdate DESC, id DESC);

COMMIT;
