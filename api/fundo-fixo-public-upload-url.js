// Serverless function: gera uma signed upload URL para o anexo de orçamento do
// formulário público do Fundo Fixo (sem exigir login). O upload do arquivo em si
// acontece direto do navegador pro Supabase Storage usando essa URL assinada —
// não passa pelo corpo desta função, então não esbarra no limite de payload do Vercel.
// O token assinado autoriza o upload sozinho, então a política do bucket continua
// só permitindo INSERT autenticado — ninguém anônimo ganha acesso de escrita direta.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const BUCKET = 'fundo-fixo-anexos';
const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[fundo-fixo-public-upload-url] Missing env vars');
    return res.status(500).json({ success: false, error: 'Configuração do servidor incompleta.' });
  }

  const contentType = String(req.body?.contentType || '');
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return res.status(400).json({ success: false, error: 'Tipo de arquivo não permitido. Use PDF, JPG, PNG ou WEBP.' });
  }

  const path = `publico/${randomUUID()}.${ext}`;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    console.error('[fundo-fixo-public-upload-url] Error:', error.message);
    return res.status(500).json({ success: false, error: 'Erro ao preparar upload do anexo.' });
  }

  return res.status(200).json({ success: true, path: data.path, token: data.token });
}
