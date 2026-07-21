// Função serverless para criar usuários com segurança
// A service_role_key fica protegida no servidor

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const VALID_ROLES = ['Admin', 'Solicitante', 'Visualizador'];
const MAX_FIELD_LENGTH = 200;

// Rate limiting simples em memória (por IP, por minuto)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

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
  return pwd.length >= 8 &&
    /[A-Z]/.test(pwd) &&
    /[a-z]/.test(pwd) &&
    /[0-9]/.test(pwd) &&
    /[^A-Za-z0-9]/.test(pwd);
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

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://portalpptm.com', 'https://www.portalpptm.com', 'https://portalpptm.vercel.app', 'http://localhost:4200', 'http://localhost:3000'];

export default async function handler(req, res) {
  const origin = req.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Apenas POST é permitido
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  // Rate limiting
  const clientIp = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em 1 minuto.' });
  }

  try {
    // Pega as credenciais do ambiente
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[Create User] Missing env vars');
      return res.status(500).json({
        success: false,
        error: 'Configuração do servidor incompleta. Contate o administrador.'
      });
    }

    // Verificação de autenticação e permissão — apenas Admin autenticado pode criar usuários
    const authHeader = String(req.headers?.authorization || '');
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (!accessToken) {
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }

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
      console.error('[Create User] Failed to load caller role:', roleResult.error);
      return res.status(500).json({ success: false, error: 'Erro ao validar permissões.' });
    }
    if (roleResult.role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Permissão negada.' });
    }

    const { email, password, name, role, department, position } = req.body;

    // Validações básicas
    if (!email || !password || !name || !role) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: email, password, name, role'
      });
    }

    // Validação de formato de email
    const sanitizedEmail = sanitizeString(email).toLowerCase();
    if (!EMAIL_REGEX.test(sanitizedEmail)) {
      return res.status(400).json({ success: false, error: 'Formato de e-mail inválido.' });
    }

    // Validação de força de senha
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula, número e símbolo.'
      });
    }

    // Validação de role
    const sanitizedRole = sanitizeString(role);
    if (!VALID_ROLES.includes(sanitizedRole)) {
      return res.status(400).json({ success: false, error: 'Perfil de acesso inválido.' });
    }

    // Sanitizar demais campos
    const sanitizedName = sanitizeString(name);
    const sanitizedDepartment = sanitizeString(department || '');
    const sanitizedPosition = sanitizeString(position || '');

    console.log('[Create User] Creating new user');

    // Cria o usuário usando a Admin API
    const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        email: sanitizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: sanitizedName,
          role: sanitizedRole,
          department: sanitizedDepartment,
          position: sanitizedPosition
        }
      })
    });

    const createData = await createResponse.json();

    if (!createResponse.ok) {
      console.error('[Create User] Error creating user, status:', createResponse.status);
      return res.status(200).json({ 
        success: false, 
        error: createData.msg || createData.message || 'Erro ao criar usuário'
      });
    }

    // O Supabase pode retornar o usuário diretamente ou dentro de uma propriedade 'user'
    const userId = createData.id || createData.user?.id;
    
    if (!userId) {
      console.error('[Create User] Invalid response - missing user ID');
      return res.status(200).json({ 
        success: false, 
        error: 'Resposta inválida do servidor ao criar usuário (ID não encontrado)'
      });
    }

    console.log('[Create User] User created successfully');

    // Aguarda um pouco para o trigger criar o perfil
    await new Promise(resolve => setTimeout(resolve, 500));

    // Atualiza/cria o perfil do usuário
    const profileData = {
      id: userId,
      name: sanitizedName,
      email: sanitizedEmail,
      role: sanitizedRole,
      department: sanitizedDepartment,
      position: sanitizedPosition,
      must_change_password: true
    };

    // Tenta UPDATE primeiro (caso o trigger já tenha criado)
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, 
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          name: sanitizedName,
          email: sanitizedEmail,
          role: sanitizedRole,
          department: sanitizedDepartment,
          position: sanitizedPosition,
          must_change_password: true
        })
      }
    );

    // Se UPDATE falhar, tenta INSERT
    if (!updateResponse.ok) {
      const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify([profileData])
      });

      if (!insertResponse.ok) {
        const insertError = await insertResponse.json().catch(() => ({}));
        console.error('[Create User] Profile insert error');
        return res.status(200).json({ 
          success: false, 
          error: 'Usuário criado mas erro ao criar perfil'
        });
      }
    }

    console.log('[Create User] Profile created/updated successfully');

    return res.status(200).json({ 
      success: true,
      userId: userId
    });

  } catch (error) {
    console.error('[Create User] Unexpected error:', error?.message);
    return res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor'
    });
  }
}
