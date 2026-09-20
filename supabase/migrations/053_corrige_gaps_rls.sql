-- Migration: 053_corrige_gaps_rls
-- Auditoria de RLS (2026-09-20) encontrou várias tabelas com política de RLS incompleta —
-- SELECT/INSERT existem, mas UPDATE e/ou DELETE faltam, mesmo quando o código da aplicação
-- de fato tenta usar esses comandos. Esse gap já causou 2 bugs silenciosos de produção
-- (manutencao_ciclos travava planos preventivos em "pendente" pra sempre — commits
-- 27797bb/11ed5f3/f4bbf43): quando falta política, o Postgres/PostgREST bloqueia a operação
-- sem erro visível pro usuário, e sem a política de UPDATE, ATÉ o "insert ... on conflict do
-- update" (upsert) para de funcionar, não só um UPDATE direto.
--
-- Cada tabela abaixo foi conferida contra o código de verdade (src/services/*.ts) antes de
-- entrar aqui — só ganham política nova as que o app realmente tenta escrever (insert/update/
-- delete/upsert client-side). Tabelas cujas escritas só acontecem via service_role
-- (api/import-almox.js, api/indicadores-manutencao-publico.js) foram DELIBERADAMENTE
-- deixadas de fora — RLS não afeta a service_role key, então não têm gap real. audit_logs
-- também foi deixada de fora de propósito: um log de auditoria deve ser imutável, não faz
-- sentido nunca ter política de UPDATE/DELETE nele.

-- ═══════════════════════════════════════════════════════════════════════════════════
-- CRÍTICO — bug já confirmado em produção
-- ═══════════════════════════════════════════════════════════════════════════════════

-- manutencao_ciclos: registrarCiclo() faz upsert (precisa de UPDATE pro "on conflict do
-- update" funcionar) e recalcularCiclo() faz update() direto (linha 329-331 do service) —
-- os dois ficavam bloqueados em silêncio sem essa política.
CREATE POLICY "auth_update_ciclos" ON manutencao_ciclos
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_ciclos" ON manutencao_ciclos
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRECAUÇÃO — sem chamada de UPDATE/DELETE hoje, mas mesmo padrão de risco (insert/delete
-- já existem, então a tabela É gerenciada pelo usuário autenticado; fechar o gap agora
-- evita o mesmo bug silencioso se um "editar" for adicionado no futuro)
-- ═══════════════════════════════════════════════════════════════════════════════════

CREATE POLICY "auth_update_apontamentos" ON apontamentos
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_ap_imp" ON apontamentos_importacoes
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_ap_imp" ON apontamentos_importacoes
  FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_manutencao_apoio_equipes" ON manutencao_apoio_equipes
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_manutencao_apoio_escala" ON manutencao_apoio_escala
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_manutencao_atestados" ON manutencao_atestados
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_manutencao_ferias" ON manutencao_ferias
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_delete_indicadores_manuais" ON manutencao_indicadores_manuais
  FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_delete_parada_planta" ON manutencao_parada_planta
  FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_manutencao_recursos_especiais" ON manutencao_recursos_especiais
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_update_semanas_fechadas" ON manutencao_semanas_fechadas
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth_delete_almox_metas_saida" ON almox_metas_saida
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- Conferir depois de rodar (não deve sobrar nenhuma tabela "gerenciada pelo usuário" sem
-- as 4 políticas, exceto as documentadas acima como intencionalmente fora):
-- SELECT tablename, cmd, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename, cmd;
-- ═══════════════════════════════════════════════════════════════════════════════════
