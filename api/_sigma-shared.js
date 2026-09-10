// Módulo compartilhado — NÃO é uma rota (Vercel ignora arquivos com "_" na frente em
// api/). Busca e cacheia (10min) os exports de OS/apontamentos do SIGMA, usados tanto
// pelo proxy autenticado da Programação (sigma-ordens-proxy.js) quanto pelo endpoint
// público do Kanban da Oficina (kanban-atividades-publico.js).
//
// As duas fontes são os mesmos links que a planilha "Fechamento Semanal.2.xlsx" usa
// via Dados Externos (Power Query) — achados em xl/connections.xml + a query M em
// customXml (Formulas/Section1.m). Endpoints públicos, sem token, mas cada um retorna
// um TSV de ~5-9MB com o histórico inteiro (~20-30 mil linhas) — por isso o cache em
// memória: sem ele, cada consulta custaria uma busca+parse de vários segundos. O cache
// não é compartilhado entre as duas functions na Vercel (cada uma roda isolada), só o
// código de buscar/parsear é que deixa de estar duplicado.
export const URL_OS = 'https://utepecem.com/sigma/export/?dados=os&empresa=PTPC';
export const URL_APONTAMENTOS = 'https://utepecem.com/sigma/export/?dados=apontamentos&empresa=PTPC';
export const REQUEST_TIMEOUT_MS = 25000;
export const CACHE_TTL_MS = 10 * 60 * 1000;

// Índices de coluna fixos, conferidos direto contra os dados reais (não dá pra confiar
// em casar o texto do cabeçalho — ele vem em Windows-1252 e alguns nomes têm acento/º).
// Export "os" (aspas por campo, resposta a exportação inteira do SIGMA):
export const OS_COL = {
  numeroOs: 1, areaManutencao: 11, naturezaManutencao: 14, kks: 16, bem: 17, descricao: 18, statusCodigo: 33,
};
// Export "apontamentos" (sem aspas):
export const APONT_COL = {
  executante: 4, areaManutencao: 6, statusOperacao: 8, data: 9, osProtheus: 20,
};

export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://portalpptm.com', 'https://www.portalpptm.com', 'https://portalpptm.vercel.app', 'http://localhost:4200', 'http://localhost:3000'];

// Status que significam "não é mais backlog" — já concluída, cancelada ou já
// executada (EXEC). Qualquer outro código (PEND, EXPA, etc.) ainda conta como
// pendência a programar.
export const STATUS_FORA_DO_BACKLOG = new Set(['CONC', 'CANC', 'EXEC']);

let cache = null; // { ts, osPorNumero: Map<string, {...}>, apontamentosPorOs: Map<string, Array<{...}>>, backlogPorArea }
let cachePromise = null;

export async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizarNumeroOs(v) {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s)) return s.padStart(6, '0');
  return s.toUpperCase();
}

// A "Área Manutenção" do SIGMA vem com abreviações inconsistentes (MEC/MECA, ELE/ELET,
// e outras) — mesmo critério (prefixo) já validado contra dados reais em
// src/utils/relatorio-apontamentos.ts pro relatório de Apontamentos.
export function normalizarAreaManutencao(v) {
  const s = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  if (s.startsWith('MEC')) return 'MECANICA';
  if (s.startsWith('ELE')) return 'ELETRICA';
  return s;
}

// Export "os": campos entre aspas, "" escapa uma aspa literal dentro do campo.
export function parseTsvComAspas(texto) {
  return texto.split(/\r?\n/).filter(l => l.length > 0).map(linha =>
    linha.split('\t').map(campo => {
      const v = campo.trim();
      if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/""/g, '"');
      return v;
    }),
  );
}

// Export "apontamentos": sem aspas nenhuma, só tab-separated cru.
export function parseTsvSemAspas(texto) {
  return texto.split(/\r?\n/).filter(l => l.length > 0).map(linha => linha.split('\t'));
}

export async function carregarDados() {
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
    lista.push({
      data,
      status: (row[APONT_COL.statusOperacao] || '').trim(),
      // Matrícula de quem apontou (coluna "Executante" do export) — precisa pra saber
      // SE FOI AQUELA PESSOA especificamente que apontou, não só "alguém" na OS (ver
      // uso em kanban-atividades-publico.js).
      executante: (row[APONT_COL.executante] || '').trim(),
    });
    apontamentosPorOs.set(numeroOs, lista);
  }

  return { ts: Date.now(), osPorNumero, apontamentosPorOs, backlogPorArea };
}

export async function obterCache() {
  const agora = Date.now();
  if (cache && (agora - cache.ts) < CACHE_TTL_MS) return cache;
  if (cachePromise) return cachePromise; // evita duas requisições concorrentes disparando o refresh junto
  cachePromise = carregarDados()
    .then(novoCache => { cache = novoCache; cachePromise = null; return cache; })
    .catch(err => { cachePromise = null; throw err; });
  return cachePromise;
}
