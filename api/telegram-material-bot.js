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

// Orçamento pensado pra caber com folga num maxDuration de 15s (ver vercel.json):
// pior caso é REQUEST_TIMEOUT_MS (consulta ao SIGMA) + até 2x TELEGRAM_SEND_TIMEOUT_MS
// (envio original + 1 retry em texto puro se o MarkdownV2 falhar).
const REQUEST_TIMEOUT_MS = 8000;
const TELEGRAM_SEND_TIMEOUT_MS = 8000;

// Rate limit em memória por chat — reseta a cada cold start da função (e não é
// compartilhado entre instâncias concorrentes), então é só uma proteção leve contra
// abuso (mesmo padrão de api/fundo-fixo-public-request.js).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const rateLimitMap = new Map();
const MAX_RATE_LIMIT_ENTRIES = 1000; // limite pra não crescer sem fim numa instância de longa duração

function checkRateLimit(chatId) {
  const now = Date.now();
  const entry = rateLimitMap.get(chatId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(chatId, { windowStart: now, count: 1 });
    if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
      rateLimitMap.delete(rateLimitMap.keys().next().value);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// Dedup de update_id — o Telegram reenvia o mesmo update se não receber 200 rápido
// (ex.: função demorou demais e a Vercel matou a execução no meio). Sem isso, um
// reenvio processa tudo de novo e manda a resposta duplicada pro usuário. Só protege
// contra reenvio pousando na MESMA instância (memória não é compartilhada entre
// instâncias concorrentes), mas cobre o caso mais comum.
const MAX_PROCESSED_UPDATES = 500;
const processedUpdateIds = new Set();

function jaProcessado(updateId) {
  if (updateId === undefined || updateId === null) return false; // sem update_id, não dá pra deduplicar
  if (processedUpdateIds.has(updateId)) return true;
  processedUpdateIds.add(updateId);
  if (processedUpdateIds.size > MAX_PROCESSED_UPDATES) {
    processedUpdateIds.delete(processedUpdateIds.values().next().value);
  }
  return false;
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

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// Corta mensagens longas demais pro limite do Telegram (ex.: material com descrição
// extensa + muitas localizações de estoque). O aviso não usa nenhum caractere
// reservado do MarkdownV2 (sem colchetes/parênteses/pontuação), pra funcionar igual
// em texto puro e não precisar escapar nada. Remove uma barra de escape solta que
// possa sobrar bem no corte, pra não quebrar o MarkdownV2 (\ sem o caractere escapado).
function truncarParaTelegram(text) {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return text;
  const aviso = '\n\n⚠️ Mensagem truncada — resposta muito longa';
  let cortado = text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - aviso.length);
  if (cortado.endsWith('\\')) cortado = cortado.slice(0, -1);
  return cortado + aviso;
}

// parseMode: 'MarkdownV2' só pra formatarResposta(), que escapa tudo que é dado
// dinâmico via escapeMarkdown() — as demais mensagens (texto fixo, sem formatação)
// vão em texto puro, pra não depender de escapar tudo à mão certinho.
//
// Sempre confere a resposta do Telegram: se a API recusar (texto grande demais,
// entidade MarkdownV2 mal formada etc.), o fetch NÃO lança exceção — sem checar
// `ok` explicitamente, o bot fica mudo sem deixar rastro nenhum do motivo. Se a
// falha foi por causa do parse_mode, tenta reenviar uma vez em texto puro, pra o
// usuário receber alguma resposta mesmo com um bug de escaping.
async function sendTelegramMessage(chatId, text, parseMode, replyMarkup) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('[telegram-material-bot] TELEGRAM_BOT_TOKEN não configurado.');
    return;
  }

  const safeText = truncarParaTelegram(text);
  const payload = {
    chat_id: chatId,
    text: safeText,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  let result;
  try {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, TELEGRAM_SEND_TIMEOUT_MS);
    result = await response.json().catch(() => null);
  } catch (error) {
    console.error('[telegram-material-bot] Falha ao enviar mensagem:', error?.message || error);
    return;
  }

  if (result?.ok) return;

  console.error('[telegram-material-bot] Telegram recusou a mensagem:', result?.description || 'sem descrição na resposta');

  if (parseMode) {
    await sendTelegramMessage(chatId, text, undefined, replyMarkup);
  }
}

// Edita uma mensagem já enviada (usado pelo teclado numérico inline, pra atualizar o
// progresso do código e depois mostrar o resultado sem criar mensagem nova a cada
// toque). Mesmo padrão de fallback de sendTelegramMessage: se falhar por causa do
// parse_mode, tenta de novo em texto puro.
async function editTelegramMessage(chatId, messageId, text, parseMode, replyMarkup) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.error('[telegram-material-bot] TELEGRAM_BOT_TOKEN não configurado.');
    return;
  }

  const safeText = truncarParaTelegram(text);
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: safeText,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  let result;
  try {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, TELEGRAM_SEND_TIMEOUT_MS);
    result = await response.json().catch(() => null);
  } catch (error) {
    console.error('[telegram-material-bot] Falha ao editar mensagem:', error?.message || error);
    return;
  }

  if (result?.ok) return;

  console.error('[telegram-material-bot] Telegram recusou a edição:', result?.description || 'sem descrição na resposta');

  if (parseMode) {
    await editTelegramMessage(chatId, messageId, text, undefined, replyMarkup);
  }
}

// Fecha o "carregando" do botão tocado — obrigatório responder todo callback_query,
// senão o cliente do Telegram fica com o spinner do botão girando até dar timeout.
async function answerCallbackQuery(callbackQueryId, text) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) return;
  try {
    await fetchWithTimeout(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    }, TELEGRAM_SEND_TIMEOUT_MS);
  } catch (error) {
    console.error('[telegram-material-bot] Falha ao responder callback_query:', error?.message || error);
  }
}

// Botões embaixo da mensagem de material encontrado: copiar código (copy_text) e
// começar uma nova busca (volta a mostrar o teclado numérico na mesma mensagem).
function tecladoResultado(codigo) {
  return {
    inline_keyboard: [
      [{ text: '📋 Copiar código', copy_text: { text: codigo } }],
      [{ text: '🔎 Nova busca', callback_data: 'nova' }],
    ],
  };
}

const TAMANHO_CODIGO = 8;
const MENSAGEM_AJUDA = 'Olá! Toque nos números abaixo pra digitar o código do material (8 dígitos) — ou digite/cole o código direto. Eu respondo com a descrição e o saldo em estoque.';

// Teclado numérico via INLINE keyboard (botões presos a UMA mensagem, diferente do
// ReplyKeyboardMarkup que fica solto na tela). Cada toque dispara um callback_query —
// não manda nenhuma mensagem nova pro chat — e o bot só edita essa mesma mensagem pra
// mostrar o progresso, então nada aparece até o código completar os 8 dígitos de fato.
function tecladoNumericoInline() {
  const num = d => ({ text: d, callback_data: `num:${d}` });
  return {
    inline_keyboard: [
      [num('1'), num('2'), num('3')],
      [num('4'), num('5'), num('6')],
      [num('7'), num('8'), num('9')],
      [{ text: '⌫ Apagar', callback_data: 'apagar' }, num('0'), { text: '🔄 Limpar', callback_data: 'limpar' }],
    ],
  };
}

function textoPrompt(buffer) {
  return `Toque nos números pra digitar o código do material:\n\nCódigo: ${buffer.padEnd(TAMANHO_CODIGO, '_').split('').join(' ')}`;
}

// Código sendo digitado por chat via teclado numérico — um dígito por toque, até
// completar TAMANHO_CODIGO. Mesma limitação de memória por instância que
// rateLimitMap/processedUpdateIds (reseta a cada cold start, não é compartilhado entre
// instâncias concorrentes): pior caso é o usuário ter que digitar de novo, sem problema.
const MAX_CODIGO_BUFFERS = 500;
const codigoBuffers = new Map();

function getCodigoBuffer(chatId) {
  return codigoBuffers.get(chatId) || '';
}

function setCodigoBuffer(chatId, valor) {
  codigoBuffers.set(chatId, valor);
  if (codigoBuffers.size > MAX_CODIGO_BUFFERS) {
    codigoBuffers.delete(codigoBuffers.keys().next().value);
  }
}

// Trata um toque no teclado numérico inline. Não manda mensagem nova nenhuma — só edita
// a própria mensagem do teclado pra refletir o progresso, e só quando o código completa
// os 8 dígitos é que a edição vira o resultado da busca.
async function tratarCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data || '';

  if (!chatId || !messageId) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (!checkRateLimit(chatId)) {
    await answerCallbackQuery(callbackQuery.id, 'Muitas consultas em pouco tempo. Aguarde um minuto.');
    return;
  }

  if (data === 'nova') {
    setCodigoBuffer(chatId, '');
    await answerCallbackQuery(callbackQuery.id);
    await editTelegramMessage(chatId, messageId, textoPrompt(''), undefined, tecladoNumericoInline());
    return;
  }

  if (data === 'limpar') {
    setCodigoBuffer(chatId, '');
    await answerCallbackQuery(callbackQuery.id);
    await editTelegramMessage(chatId, messageId, textoPrompt(''), undefined, tecladoNumericoInline());
    return;
  }

  if (data === 'apagar') {
    const buffer = getCodigoBuffer(chatId).slice(0, -1);
    setCodigoBuffer(chatId, buffer);
    await answerCallbackQuery(callbackQuery.id);
    await editTelegramMessage(chatId, messageId, textoPrompt(buffer), undefined, tecladoNumericoInline());
    return;
  }

  const digito = /^num:([0-9])$/.exec(data)?.[1];
  if (!digito) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const buffer = getCodigoBuffer(chatId) + digito;
  if (buffer.length < TAMANHO_CODIGO) {
    setCodigoBuffer(chatId, buffer);
    await answerCallbackQuery(callbackQuery.id);
    await editTelegramMessage(chatId, messageId, textoPrompt(buffer), undefined, tecladoNumericoInline());
    return;
  }

  // Completou os 8 dígitos — busca e edita a mensagem pra mostrar o resultado.
  setCodigoBuffer(chatId, '');
  await answerCallbackQuery(callbackQuery.id);

  const codigo = buffer;
  const result = await consultarMaterial(codigo);
  if (!result.success || !result.data) {
    await editTelegramMessage(
      chatId, messageId, `❌ ${result.error || `Material não encontrado para o código ${codigo}.`}`,
      undefined, { inline_keyboard: [[{ text: '🔎 Tentar de novo', callback_data: 'nova' }]] },
    );
    return;
  }

  await editTelegramMessage(chatId, messageId, formatarResposta(codigo, result.data), 'MarkdownV2', tecladoResultado(codigo));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  // Confirma que o request veio do Telegram (secret configurado no setWebhook), não
  // de qualquer um que descubra a URL do endpoint.
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(401).json({ ok: false });
  }

  // O Telegram reenvia o update se não receber 200 rápido — por isso sempre respondemos
  // 200 no final, mesmo quando algo dá errado internamente, pra não entrar em loop. E
  // ignoramos update_id já visto, caso o reenvio aconteça mesmo assim (função lenta,
  // hiccup de rede), pra não mandar a mesma resposta duplicada.
  try {
    const update = req.body || {};
    if (jaProcessado(update.update_id)) {
      return res.status(200).json({ ok: true });
    }

    if (update.callback_query) {
      await tratarCallbackQuery(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    const message = update.message;
    const chatId = message?.chat?.id;
    if (!chatId) return res.status(200).json({ ok: true });

    const text = String(message?.text || '').trim();

    if (!checkRateLimit(chatId)) {
      await sendTelegramMessage(chatId, 'Muitas consultas em pouco tempo. Aguarde um minuto e tente de novo.');
      return res.status(200).json({ ok: true });
    }

    if (!text || text === '/start' || text === '/ajuda' || text === '/help') {
      setCodigoBuffer(chatId, '');
      await sendTelegramMessage(chatId, MENSAGEM_AJUDA, undefined, tecladoNumericoInline());
      return res.status(200).json({ ok: true });
    }

    // Código completo digitado/colado de uma vez, sem usar o teclado numérico.
    const codigo = text.replace(/[^a-zA-Z0-9\-_.]/g, '');
    if (codigo.length !== TAMANHO_CODIGO) {
      await sendTelegramMessage(chatId, `O código do material deve ter exatamente ${TAMANHO_CODIGO} caracteres (ex.: 59093681).`, undefined, tecladoNumericoInline());
      return res.status(200).json({ ok: true });
    }

    const result = await consultarMaterial(codigo);
    if (!result.success || !result.data) {
      await sendTelegramMessage(chatId, `❌ ${result.error || `Material não encontrado para o código ${codigo}.`}`, undefined, tecladoNumericoInline());
      return res.status(200).json({ ok: true });
    }

    await sendTelegramMessage(chatId, formatarResposta(codigo, result.data), 'MarkdownV2', tecladoResultado(codigo));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[telegram-material-bot] Erro:', error);
    return res.status(200).json({ ok: true });
  }
}
