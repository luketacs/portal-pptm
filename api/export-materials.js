// Serverless function: exporta catálogo de materiais como arquivo Excel

import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';
import { createRateLimiter } from './_rate-limit-shared.js';
import { resolverUsuarioAutenticado } from './_auth-shared.js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const checkRateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const auth = await resolverUsuarioAutenticado(req, supabase);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!['Admin', 'Visualizador', 'Solicitante'].includes(auth.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }

  const { search, status } = req.body || {};

  function buildQuery() {
    let q = supabase
      .from('materials')
      .select('*, creator:profiles!materials_created_by_fkey(name)')
      .order('created_at', { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);
    if (search) {
      q = q.or(`codigo.ilike.%${search}%,descricao_breve.ilike.%${search}%,ncm.ilike.%${search}%`);
    }
    return q;
  }

  // Sem paginar, o PostgREST corta em 1000 linhas por padrão — busca página a página.
  const PAGE_SIZE = 1000;
  let data = [];
  let from = 0;
  while (true) {
    const { data: page, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) return res.status(500).json({ error: 'Erro ao buscar dados.' });
    data = data.concat(page ?? []);
    if (!page || page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

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
