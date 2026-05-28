// Serverless function: exporta catálogo de materiais como arquivo Excel

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Rate limit excedido. Tente em instantes.' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token não fornecido.' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: 'Token inválido.' });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !['Admin', 'Visualizador', 'Solicitante'].includes(profile.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }

  const { search, status } = req.body || {};

  let query = supabase
    .from('materials')
    .select('*, creator:profiles!materials_created_by_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search) {
    query = query.or(`codigo.ilike.%${search}%,descricao_breve.ilike.%${search}%,ncm.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Erro ao buscar dados.' });

  const rows = (data || []).map(r => ({
    'Código': r.codigo || '',
    'Descrição Breve': r.descricao_breve,
    'Descrição Detalhada': r.descricao_detalhada,
    'Unidade': r.unidade,
    'NCM': r.ncm || '',
    'Estoque Segurança': r.estoque_seguranca ? 'Sim' : 'Não',
    'Qtd. Estoque Segurança': r.qtd_estoque_seguranca || '',
    'Status': r.status,
    'Criado por': r.creator?.name || '',
    'Data Criação': r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Materiais');

  if (rows.length > 0) {
    const colWidths = Object.keys(rows[0]).map(key => {
      const maxData = Math.max(...rows.map(r => String(r[key] || '').length));
      return { wch: Math.max(key.length, maxData) + 2 };
    });
    worksheet['!cols'] = colWidths;
  }

  const today = new Date().toISOString().slice(0, 10);
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Catalogo_Materiais_${today}.xlsx"`);
  res.setHeader('Content-Length', buffer.length);
  return res.status(200).send(buffer);
}
