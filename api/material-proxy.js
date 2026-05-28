const REQUEST_TIMEOUT_MS = 12000;
const MAX_RATE_LIMIT_RETRIES = 0;
const BACKOFF_BASE_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(value) {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) return null;

  const diffMs = asDate.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 1000);
}

function parseJsonLenient(rawText) {
  const text = String(rawText ?? '')
    .replace(/^\uFEFF/, '')
    .trim();

  if (!text) {
    return { ok: false, value: null };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const firstObjectStart = text.indexOf('{');
    const lastObjectEnd = text.lastIndexOf('}');
    if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
      const objectSlice = text.slice(firstObjectStart, lastObjectEnd + 1);
      try {
        return { ok: true, value: JSON.parse(objectSlice) };
      } catch {}
    }

    const firstArrayStart = text.indexOf('[');
    const lastArrayEnd = text.lastIndexOf(']');
    if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
      const arraySlice = text.slice(firstArrayStart, lastArrayEnd + 1);
      try {
        return { ok: true, value: JSON.parse(arraySlice) };
      } catch {}
    }

    return { ok: false, value: null };
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRateLimitBackoff(url, options) {
  let lastResponse = null;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(url, options, REQUEST_TIMEOUT_MS);
    lastResponse = response;

    if (response.status !== 429) {
      return response;
    }

    if (attempt === MAX_RATE_LIMIT_RETRIES) {
      return response;
    }

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader);
    const fallbackBackoffMs = BACKOFF_BASE_MS * (attempt + 1);
    const waitMs = retryAfterSeconds !== null
      ? Math.max(retryAfterSeconds * 1000, 500)
      : fallbackBackoffMs;

    await sleep(waitMs);
  }

  if (lastResponse) return lastResponse;
  throw new Error('Falha ao obter resposta da API externa.');
}

// Proxy serverless para contornar CORS da API externa
export default async function handler(req, res) {
  // Verificação de origem
  const origin = req.headers?.origin || '';
  const referer = req.headers?.referer || '';
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['https://portalpptm.com', 'https://www.portalpptm.com', 'https://portalpptm.vercel.app', 'http://localhost:4200', 'http://localhost:3000'];
  const hasValidOrigin = !origin || allowedOrigins.some(o => origin.startsWith(o));
  const hasValidReferer = !referer || allowedOrigins.some(o => referer.startsWith(o));
  if (!hasValidOrigin && !hasValidReferer) {
    return res.status(403).json({ success: false, error: 'Origem não autorizada' });
  }

  try {
    const rawCode = req.query?.code ?? req.query?.produto;
    const code = String(rawCode || '').trim().replace(/[^a-zA-Z0-9\-_.]/g, '');

    // API_TOKEN deve estar em variaveis de ambiente do Vercel
    const API_TOKEN = process.env.MATERIAL_API_TOKEN;

    if (!API_TOKEN) {
      return res.status(200).json({
        success: false,
        error: 'MATERIAL_API_TOKEN nao definido. Contate o administrador.',
      });
    }

    if (!code) {
      return res.status(200).json({
        success: false,
        error: 'Codigo do material nao informado.',
      });
    }

    const url = `https://utepecem.com/sigma/api/getProduto?produto=${encodeURIComponent(code)}`;

    const response = await fetchWithRateLimitBackoff(url, {
      method: 'GET',
      headers: {
        'X-API-Token': API_TOKEN,
        'User-Agent': 'Portal-PPTM/1.0',
      },
    });

    if (response.status === 429) {
      return res.status(200).json({
        success: false,
        error: 'API retornou status 429 (limite de consultas). Aguarde alguns instantes e tente novamente.',
        code: 'RATE_LIMIT',
      });
    }

    if (response.status === 404) {
      return res.status(200).json({
        success: false,
        error: 'Material não encontrado na API de saldo para o código informado.',
        code: 'NOT_FOUND',
      });
    }

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      const parsed = parseJsonLenient(rawText);
      const errorData = parsed.ok ? parsed.value : { raw: rawText.slice(0, 300) };
      return res.status(200).json({
        success: false,
        error: `API retornou status ${response.status}`,
        details: errorData,
      });
    }

    const rawText = await response.text().catch(() => '');
    const parsed = parseJsonLenient(rawText);
    if (!parsed.ok) {
      return res.status(200).json({
        success: false,
        error: 'API externa retornou resposta invalida para JSON.',
        code: 'INVALID_JSON',
      });
    }

    const data = parsed.value;
    return res.status(200).json(data);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(200).json({
        success: false,
        error: 'Tempo limite na API de saldo. Tente novamente em alguns instantes.',
        code: 'UPSTREAM_TIMEOUT',
      });
    }

    return res.status(200).json({
      success: false,
      error: `Erro ao consultar material: ${error.message}`,
      type: error.constructor?.name || 'Error',
    });
  }
}


