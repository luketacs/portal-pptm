// Função serverless para resetar senha de usuário com segurança
// Usa service_role_key no servidor (NUNCA no frontend)

const MAX_FIELD_LENGTH = 200;

// Rate limiting simples em memória (por IP, por minuto)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

function isStrongPassword(pwd) {
  if (typeof pwd !== 'string') return false;
  return pwd.length >= 8 &&
    /[A-Z]/.test(pwd) &&
    /[a-z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[^A-Za-z0-9]/.test(pwd);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function fetchJsonSafe(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

async function getCallerUserId({ supabaseUrl, serviceRoleKey, accessToken }) {
  const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) {
    const body = await fetchJsonSafe(resp);
    return { ok: false, error: body?.msg || body?.message || 'Token inválido' };
  }

  const user = await resp.json().catch(() => null);
  const id = user?.id || user?.user?.id;
  if (!id) return { ok: false, error: 'Token válido, mas usuário não identificado.' };
  return { ok: true, id };
}

async function getProfileRole({ supabaseUrl, serviceRoleKey, userId }) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) {
    const body = await fetchJsonSafe(resp);
    return { ok: false, error: body?.message || `Erro ao consultar perfil (HTTP ${resp.status})` };
  }

  const rows = await resp.json().catch(() => []);
  const role = Array.isArray(rows) ? rows?.[0]?.role : rows?.role;
  return { ok: true, role };
}

export default async function handler(req, res) {
  // Apenas POST é permitido
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

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

  // Rate limiting
  const clientIp = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em 1 minuto.' });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[Reset Password] Missing env vars');
      return res.status(500).json({
        success: false,
        error: 'Configuração do servidor incompleta. Contate o administrador.',
      });
    }

    const authHeader = String(req.headers?.authorization || '');
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (!accessToken) {
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }

    const { userId, newPassword } = req.body || {};
    const targetUserId = sanitizeString(userId);
    const password = sanitizeString(newPassword) || 'Pptm@123';

    if (!isUuid(targetUserId)) {
      return res.status(400).json({ success: false, error: 'userId inválido.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula, número e símbolo.',
      });
    }

    // Verificar usuário chamador (token) e papel (Admin) no profiles
    const caller = await getCallerUserId({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      accessToken,
    });

    if (!caller.ok) {
      return res.status(401).json({ success: false, error: 'Sessão inválida. Faça login novamente.' });
    }

    const roleResult = await getProfileRole({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      userId: caller.id,
    });

    if (!roleResult.ok) {
      console.error('[Reset Password] Failed to load caller role:', roleResult.error);
      return res.status(500).json({ success: false, error: 'Erro ao validar permissões.' });
    }

    if (roleResult.role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Permissão negada.' });
    }

    // Atualiza a senha pelo Admin API (GoTrue)
    const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(targetUserId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        password,
        email_confirm: true,
      }),
    });

    const updateBody = await fetchJsonSafe(updateResponse);
    if (!updateResponse.ok) {
      console.error('[Reset Password] Admin update failed', { status: updateResponse.status, updateBody });
      return res.status(200).json({
        success: false,
        error: updateBody?.msg || updateBody?.message || `Erro ao resetar senha (HTTP ${updateResponse.status})`,
      });
    }

    // Força o usuário a trocar senha no próximo login (flag na tabela profiles)
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(targetUserId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ must_change_password: true }),
    }).catch(() => null);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Reset Password] Unexpected error:', error?.message);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}

