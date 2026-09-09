// Proxy para as exportações do SIGMA usadas pela Programação de Manutenção:
//   - Descrição automática ao digitar o número da OS
//   - Validação se a OS foi apontada (executada) dentro da semana programada
//   - Backlog: OS abertas (não concluídas/canceladas) de uma área, pra ajudar a montar
//     a semana em vez de digitar OS uma a uma (?backlog_area=ELETRICA|MECANICA)
//
// Busca/parse/cache do export do SIGMA em si vivem em _sigma-shared.js (compartilhado
// com o endpoint público do Kanban da Oficina, ver kanban-atividades-publico.js) — aqui
// fica só o que é específico desse proxy: exigir sessão válida e servir os dois formatos
// de consulta (numeros_os / backlog_area).
import { ALLOWED_ORIGINS, normalizarNumeroOs, obterCache } from './_sigma-shared.js';

async function getCallerUserId({ supabaseUrl, serviceRoleKey, accessToken }) {
  const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!resp.ok) return { ok: false };
  const user = await resp.json().catch(() => null);
  const id = user?.id || user?.user?.id;
  return id ? { ok: true, id } : { ok: false };
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[sigma-ordens-proxy] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
  }

  const authHeader = String(req.headers?.authorization || '');
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!accessToken) return res.status(401).json({ success: false, error: 'Não autenticado.' });

  const caller = await getCallerUserId({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY, accessToken });
  if (!caller.ok) return res.status(401).json({ success: false, error: 'Sessão inválida. Faça login novamente.' });

  try {
    const backlogArea = String(req.query?.backlog_area || '').trim().toUpperCase();
    if (backlogArea) {
      if (backlogArea !== 'ELETRICA' && backlogArea !== 'MECANICA') {
        return res.status(200).json({ success: false, error: 'backlog_area inválida.' });
      }
      const dados = await obterCache();
      const backlog = dados.backlogPorArea[backlogArea].slice(0, 300);
      return res.status(200).json({ success: true, backlog, atualizadoEm: dados.ts });
    }

    const rawNumeros = String(req.query?.numeros_os || '').trim();
    if (!rawNumeros) {
      return res.status(200).json({ success: false, error: 'numeros_os não informado.' });
    }
    const numeros = [...new Set(rawNumeros.split(',').map(normalizarNumeroOs).filter(Boolean))].slice(0, 200);

    const dados = await obterCache();

    const resultado = {};
    for (const numeroOs of numeros) {
      const os = dados.osPorNumero.get(numeroOs) ?? null;
      const apontamentos = dados.apontamentosPorOs.get(numeroOs) ?? [];
      resultado[numeroOs] = { os, apontamentos };
    }

    return res.status(200).json({ success: true, data: resultado, atualizadoEm: dados.ts });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(200).json({ success: false, error: 'Tempo limite consultando o SIGMA. Tente novamente em instantes.' });
    }
    console.error('[sigma-ordens-proxy] Erro:', error);
    return res.status(200).json({ success: false, error: `Erro ao consultar o SIGMA: ${error.message}` });
  }
}
