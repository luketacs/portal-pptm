// Bot de consulta de materiais via Telegram. Qualquer pessoa que converse com o bot
// manda um código (ex.: 5900010) e recebe a descrição curta, a detalhada e o saldo
// em estoque — sem precisar de login no Portal. Consulta a mesma API externa (SIGMA)
// usada por api/material-proxy.js, só que aqui sem exigir sessão Supabase, já que o
// bot é de uso aberto a qualquer um da empresa.
//
// Setup (fora deste código, feito uma vez):
//   1. Criar o bot no Telegram via @BotFather e pegar o token.
//   2. Configurar as env vars no Vercel: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
//      (um valor aleatório qualquer, só pra validar que o request veio do Telegram),
//      e MATERIAL_API_TOKEN (já deve existir, usado pelo material-proxy.js).
//   3. Depois do deploy, registrar o webhook chamando uma vez:
//      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<dominio>/api/telegram-material-bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>

const REQUEST_TIMEOUT_MS = 12000;

// Rate limit em memória por chat — reseta a cada cold start da função, então é só uma
// proteção leve contra abuso (mesmo padrão de api/fundo-fixo-public-request.js).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const rateLimitMap = new Map();

function checkRateLimit(chatId) {
  const now = Date.now();
  const entry = rateLimitMap.get(chatId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(chatId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// A API do SIGMA às vezes retorna múltiplos JSONs concatenados numa resposta só
// (ex: saldo + produto) — mesma extração usada em api/material-proxy.js.
function extrairJsonObjects(text) {
  const results = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(text.substring(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }
  return results;
}

async function consultarMaterial(codigo) {
  const API_TOKEN = process.env.MATERIAL_API_TOKEN;
  if (!API_TOKEN) return { success: false, error: 'MATERIAL_API_TOKEN não configurado no servidor.' };

  const url = `https://utepecem.xyz/sigma/api/getProduto?produto=${encodeURIComponent(codigo)}`;

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'X-API-Token': API_TOKEN, 'User-Agent': 'Portal-PPTM-TelegramBot/1.0' },
    }, REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') return { success: false, error: 'A consulta demorou demais. Tente de novo em instantes.' };
    return { success: false, error: 'Falha ao consultar a API de materiais.' };
  }

  if (response.status === 404) return { success: false, error: `Material não encontrado para o código ${codigo}.` };
  if (response.status === 429) return { success: false, error: 'Limite de consultas atingido. Aguarde alguns instantes.' };
  if (!response.ok) return { success: false, error: `API retornou status ${response.status}.` };

  const rawText = await response.text().catch(() => '');
  const jsonObjects = extrairJsonObjects(rawText);
  const validResult = jsonObjects.find(obj => obj.success === true && obj.data && (obj.data.id || obj.data.texto_breve));
  if (validResult) return validResult;

  try {
    return JSON.parse(rawText);
  } catch {
    return { success: false, error: 'Resposta inválida da API de materiais.' };
  }
}

function escapeMarkdown(text) {
  return String(text ?? '').replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Lista cada localização retornada pela API (não só uma) — cada linha mostra
// quantidade+unidade quando há saldo, ou ❌ quando não há.
function formatarLinhaEstoque(estoque, unidade) {
  const atual = Number(estoque.qAtual || 0);
  const empenhada = Number(estoque.qEmpenhada || 0);
  let valor;
  if (atual <= 0) {
    valor = '❌';
  } else if (empenhada > 0) {
    valor = `${estoque.qAtual} ${unidade} \\(${empenhada} comprometido\\)`.trim();
  } else {
    valor = `${estoque.qAtual} ${unidade}`.trim();
  }
  return `🏭 ${escapeMarkdown(estoque.empresa)} \\- ${escapeMarkdown(estoque.localizacao)}: ${valor}`;
}

function formatarResposta(codigo, data) {
  const estoques = Array.isArray(data.estoques) ? data.estoques : [];
  const estoqueTexto = estoques.length === 0
    ? 'Sem dados de estoque para esse código\\.'
    : estoques.map(e => formatarLinhaEstoque(e, data.unidade || '')).join('\n');

  // TODO: hoje não há fonte de dado acessível pra este valor por PPTM/EP
  // (só existe nas planilhas locais do bot de WhatsApp) — sempre ❌ por enquanto.
  const estoqueSegurancaTexto = ['🏭 *PPTM:* ❌', '🏭 *EP:* ❌'].join('\n');

  // Linha em branco entre cada bloco (mais respiro na leitura), mas cada lista
  // (localizações / estoque de segurança) fica compacta dentro do seu próprio bloco.
  const blocos = [
    '📦 *Produto Encontrado\\!*',
    `📌 *Código:* ${escapeMarkdown(codigo)}`,
    `📃 *Texto breve:* ${escapeMarkdown(data.texto_breve || '—')}`,
    `📝 *Descrição completa:* ${escapeMarkdown(data.texto_completo || data.texto_breve || '—')}`,
    `📍 *Estoque por Localização:*\n${estoqueTexto}`,
    `⚠️ *Estoque de Segurança:*\n${estoqueSegurancaTexto}`,
  ];
  return blocos.join('\n\n');
}

// parseMode: 'MarkdownV2' só pra formatarResposta(), que escapa tudo que é dado
// dinâmico via escapeMarkdown() — as demais mensagens (texto fixo, sem formatação)
// vão em texto puro, pra não depender de escapar tudo à mão certinho.
async function sendTelegramMessage(chatId, text, parseMode) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('[telegram-material-bot] TELEGRAM_BOT_TOKEN não configurado.');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}) }),
    });
  } catch (error) {
    console.error('[telegram-material-bot] Falha ao enviar mensagem:', error);
  }
}

const MENSAGEM_AJUDA = 'Olá! Manda o código de um material (ex.: 5900010) que eu respondo com a descrição e o saldo em estoque.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  // Confirma que o request veio do Telegram (secret configurado no setWebhook), não
  // de qualquer um que descubra a URL do endpoint.
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(401).json({ ok: false });
  }

  // O Telegram reenvia o update se não receber 200 rápido — por isso sempre respondemos
  // 200 no final, mesmo quando algo dá errado internamente, pra não entrar em loop.
  try {
    const update = req.body || {};
    const message = update.message;
    const chatId = message?.chat?.id;
    if (!chatId) return res.status(200).json({ ok: true });

    const text = String(message?.text || '').trim();

    if (!checkRateLimit(chatId)) {
      await sendTelegramMessage(chatId, 'Muitas consultas em pouco tempo. Aguarde um minuto e tente de novo.');
      return res.status(200).json({ ok: true });
    }

    if (!text || text === '/start' || text === '/ajuda' || text === '/help') {
      await sendTelegramMessage(chatId, MENSAGEM_AJUDA);
      return res.status(200).json({ ok: true });
    }

    const codigo = text.replace(/[^a-zA-Z0-9\-_.]/g, '');
    if (!codigo) {
      await sendTelegramMessage(chatId, 'Manda só o código do material (ex.: 5900010).');
      return res.status(200).json({ ok: true });
    }

    const result = await consultarMaterial(codigo);
    if (!result.success || !result.data) {
      await sendTelegramMessage(chatId, `❌ ${result.error || `Material não encontrado para o código ${codigo}.`}`);
      return res.status(200).json({ ok: true });
    }

    await sendTelegramMessage(chatId, formatarResposta(codigo, result.data), 'MarkdownV2');
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[telegram-material-bot] Erro:', error);
    return res.status(200).json({ ok: true });
  }
}
