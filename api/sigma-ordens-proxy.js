// Proxy para as exportações do SIGMA usadas pela Programação de Manutenção:
//   - Descrição automática ao digitar o número da OS
//   - Validação se a OS foi apontada (executada) dentro da semana programada
//   - Backlog: OS abertas (não concluídas/canceladas) de uma área, pra ajudar a montar
//     a semana em vez de digitar OS uma a uma (?backlog_area=ELETRICA|MECANICA)
//
// As duas fontes são os mesmos links que a planilha "Fechamento Semanal.2.xlsx" usa
// via Dados Externos (Power Query) — achados em xl/connections.xml + a query M em
// customXml (Formulas/Section1.m). Endpoints públicos, sem token, mas cada um retorna
// um TSV de ~5-9MB com o histórico inteiro (~20-30 mil linhas) — por isso o cache em
// memória: sem ele, cada digitação de OS custaria uma busca+parse de vários segundos.
const URL_OS = 'https://utepecem.com/sigma/export/?dados=os&empresa=PTPC';
const URL_APONTAMENTOS = 'https://utepecem.com/sigma/export/?dados=apontamentos&empresa=PTPC';
const REQUEST_TIMEOUT_MS = 25000;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Índices de coluna fixos, conferidos direto contra os dados reais (não dá pra confiar
// em casar o texto do cabeçalho — ele vem em Windows-1252 e alguns nomes têm acento/º).
// Export "os" (aspas por campo, resposta a exportação inteira do SIGMA):
const OS_COL = {
  numeroOs: 1, areaManutencao: 11, naturezaManutencao: 14, kks: 16, bem: 17, descricao: 18, statusCodigo: 33,
};
// Export "apontamentos" (sem aspas):
const APONT_COL = {
  areaManutencao: 6, statusOperacao: 8, data: 9, osProtheus: 20,
};

let cache = null; // { ts, osPorNumero: Map<string, {...}>, apontamentosPorOs: Map<string, Array<{...}>> }
let cachePromise = null;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizarNumeroOs(v) {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s)) return s.padStart(6, '0');
  return s.toUpperCase();
}

// A "Área Manutenção" do SIGMA vem com abreviações inconsistentes (MEC/MECA, ELE/ELET,
// e outras) — mesmo critério (prefixo) já validado contra dados reais em
// src/utils/relatorio-apontamentos.ts pro relatório de Apontamentos.
function normalizarAreaManutencao(v) {
  const s = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  if (s.startsWith('MEC')) return 'MECANICA';
  if (s.startsWith('ELE')) return 'ELETRICA';
  return s;
}

// Status que significam "não é mais backlog" — já concluída ou cancelada. Qualquer
// outro código (PEND, EXPA, etc.) ainda conta como pendência a programar.
const STATUS_FORA_DO_BACKLOG = new Set(['CONC', 'CANC']);

// Export "os": campos entre aspas, "" escapa uma aspa literal dentro do campo.
function parseTsvComAspas(texto) {
  return texto.split(/\r?\n/).filter(l => l.length > 0).map(linha =>
    linha.split('\t').map(campo => {
      const v = campo.trim();
      if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/""/g, '"');
      return v;
    }),
  );
}

// Export "apontamentos": sem aspas nenhuma, só tab-separated cru.
function parseTsvSemAspas(texto) {
  return texto.split(/\r?\n/).filter(l => l.length > 0).map(linha => linha.split('\t'));
}

async function carregarDados() {
  const [respOs, respApont] = await Promise.all([
    fetchWithTimeout(URL_OS, { headers: { 'User-Agent': 'Portal-PPTM/1.0' } }, REQUEST_TIMEOUT_MS),
    fetchWithTimeout(URL_APONTAMENTOS, { headers: { 'User-Agent': 'Portal-PPTM/1.0' } }, REQUEST_TIMEOUT_MS),
  ]);
  if (!respOs.ok) throw new Error(`Export de OS do SIGMA retornou status ${respOs.status}`);
  if (!respApont.ok) throw new Error(`Export de apontamentos do SIGMA retornou status ${respApont.status}`);

  // Encoding=1252 no Power Query original — 'latin1' decodifica certo os acentos
  // porque coincide com windows-1252 na faixa usada por caracteres latinos/º.
  const [bufOs, bufApont] = await Promise.all([respOs.arrayBuffer(), respApont.arrayBuffer()]);
  const textoOs = Buffer.from(bufOs).toString('latin1');
  const textoApont = Buffer.from(bufApont).toString('latin1');

  const linhasOs = parseTsvComAspas(textoOs);
  const linhasApont = parseTsvSemAspas(textoApont);

  const osPorNumero = new Map();
  const backlogPorArea = { ELETRICA: [], MECANICA: [] };
  for (let i = 1; i < linhasOs.length; i++) {
    const row = linhasOs[i];
    const numeroOs = normalizarNumeroOs(row[OS_COL.numeroOs]);
    if (!numeroOs) continue;
    const statusCodigo = (row[OS_COL.statusCodigo] || '').toUpperCase();
    const info = {
      descricao: row[OS_COL.descricao] || '',
      equipamento: row[OS_COL.kks] || row[OS_COL.bem] || '',
      areaManutencao: row[OS_COL.areaManutencao] || '',
      statusCodigo,
      tipoServico: (row[OS_COL.naturezaManutencao] || '').toUpperCase(),
    };
    osPorNumero.set(numeroOs, info);

    const area = normalizarAreaManutencao(info.areaManutencao);
    if ((area === 'ELETRICA' || area === 'MECANICA') && !STATUS_FORA_DO_BACKLOG.has(statusCodigo)) {
      backlogPorArea[area].push({ numeroOs, ...info });
    }
  }
  // Mais recente primeiro — número de OS do Protheus é sequencial, então ordenar por
  // ele (desc) aproxima "mais recente" sem precisar de uma coluna de data específica.
  backlogPorArea.ELETRICA.sort((a, b) => b.numeroOs.localeCompare(a.numeroOs));
  backlogPorArea.MECANICA.sort((a, b) => b.numeroOs.localeCompare(a.numeroOs));

  const apontamentosPorOs = new Map();
  for (let i = 1; i < linhasApont.length; i++) {
    const row = linhasApont[i];
    const numeroOs = normalizarNumeroOs(row[APONT_COL.osProtheus]);
    if (!numeroOs) continue;
    const data = (row[APONT_COL.data] || '').trim();
    if (!data) continue;
    const lista = apontamentosPorOs.get(numeroOs) ?? [];
    lista.push({ data, status: (row[APONT_COL.statusOperacao] || '').trim() });
    apontamentosPorOs.set(numeroOs, lista);
  }

  return { ts: Date.now(), osPorNumero, apontamentosPorOs, backlogPorArea };
}

async function obterCache() {
  const agora = Date.now();
  if (cache && (agora - cache.ts) < CACHE_TTL_MS) return cache;
  if (cachePromise) return cachePromise; // evita duas requisições concorrentes disparando o refresh junto
  cachePromise = carregarDados()
    .then(novoCache => { cache = novoCache; cachePromise = null; return cache; })
    .catch(err => { cachePromise = null; throw err; });
  return cachePromise;
}

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://portalpptm.com', 'https://www.portalpptm.com', 'https://portalpptm.vercel.app', 'http://localhost:4200', 'http://localhost:3000'];

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
