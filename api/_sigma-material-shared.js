// Módulo compartilhado — NÃO é uma rota (Vercel ignora arquivos com "_" na frente em
// api/). Busca/parse de baixo nível do endpoint "getProduto" do SIGMA (saldo/descrição de
// material), usado tanto por api/material-proxy.js (app autenticado) quanto por
// api/telegram-material-bot.js (bot público, sem login). Mesmo padrão já estabelecido pra
// a outra integração SIGMA deste repositório (ver api/_sigma-shared.js, usado por
// sigma-ordens-proxy.js/kanban-atividades-publico.js/indicadores-manutencao-publico.js) —
// extraído porque o fetch/parse aqui não depende do modelo de autenticação (isso continua
// separado em cada arquivo: material-proxy.js exige sessão Supabase + retry com backoff
// em 429; telegram-material-bot.js é público e não faz retry).

export const SIGMA_MATERIAL_URL_BASE = 'https://utepecem.xyz/sigma/api/getProduto';

export function montarUrlSigmaMaterial(codigo) {
  return `${SIGMA_MATERIAL_URL_BASE}?produto=${encodeURIComponent(codigo)}`;
}

export async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// A API do SIGMA às vezes retorna múltiplos JSONs concatenados numa resposta só (ex:
// saldo + produto) — extrai todos os objetos JSON válidos da string.
export function extrairJsonObjects(text) {
  const results = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    if (depth > 0 && quoted) {
      if (escaped) escaped = false;
      else if (text[i] === '\\') escaped = true;
      else if (text[i] === '"') quoted = false;
      continue;
    }
    if (depth > 0 && text[i] === '"') { quoted = true; continue; }
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(text.substring(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }
  return results;
}

// Entre os objetos JSON extraídos, acha o que tem os dados reais do produto — a API pode
// devolver "saldo" e "produto" como dois JSONs concatenados na mesma resposta, e só um
// deles tem os campos que interessam.
export function extrairProdutoValido(jsonObjects) {
  return jsonObjects.find(obj => obj.success === true && obj.data && (obj.data.id || obj.data.texto_breve));
}
